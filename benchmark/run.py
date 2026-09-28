"""Compare chess recognizers on a random sample of ChessReD test photos.

Models:
  - fenify-3D (the app's current model; never trained on ChessReD)
  - ChessReD baseline ResNeXt-101 (Masouris & van Gemert, trained on ChessReD train)
  - ChessQueries Lite ViT-S int8 ONNX (Seytre 2026, trained on ChessReD/ChessCog/SLCC train)

Each model gets the preprocessing from its own reference code. Outputs a
results table, per-image predictions, and side-by-side comparison sheets.
"""
import argparse
import io
import json
import random
import time
from pathlib import Path

import chess
import chess.svg
import cairosvg
import numpy as np
import onnxruntime as ort
import torch
import torchvision
from PIL import Image, ImageDraw, ImageFont
from remotezip import RemoteZip

ROOT = Path(__file__).resolve().parent.parent
PIECES = ".PNBRQKpnbrqk"  # class order shared by fenify and ChessQueries
FILES = "abcdefgh"


def fen_index(square: str) -> int:
    """Index in FEN order (a8=0 ... h1=63)."""
    return 8 * (8 - int(square[1])) + FILES.index(square[0])


def to_placement(board: list[str]) -> str:
    rows = []
    for r in range(8):
        row, empty = "", 0
        for c in board[r * 8:(r + 1) * 8]:
            if c == ".":
                empty += 1
            else:
                row += (str(empty) if empty else "") + c
                empty = 0
        rows.append(row + (str(empty) if empty else ""))
    return "/".join(rows)


# ---------------------------------------------------------------- models

class Fenify:
    name = "fenify-3D"

    def __init__(self):
        self.model = torch.jit.load(str(ROOT / "fenify-3D/model.pt"), map_location="cpu").eval()
        self.mean = torch.tensor([0.485, 0.456, 0.406]).view(3, 1, 1)
        self.std = torch.tensor([0.229, 0.224, 0.225]).view(3, 1, 1)

    def predict(self, img: Image.Image) -> list[str]:
        # prediction.py: Resize((400, 400)), RGB, ToTensor, ImageNet normalize
        x = torchvision.transforms.functional.to_tensor(img.convert("RGB").resize((400, 400), Image.BILINEAR))
        x = ((x - self.mean) / self.std).unsqueeze(0)
        with torch.no_grad():
            probs = self.model(x).reshape(64, 13)
        classes = probs.argmax(1).tolist()  # index = rank*8+file, a1=0
        board = ["."] * 64
        for sq, cls in enumerate(classes):
            rank, file = divmod(sq, 8)
            board[8 * (7 - rank) + file] = PIECES[cls]
        return board


class ChessReDBaseline:
    name = "ChessReD ResNeXt"

    def __init__(self, ckpt: Path, category_chars: list[str]):
        backbone = torchvision.models.resnext101_32x8d(weights=None)
        self.features = torch.nn.Sequential(*list(backbone.children())[:-1])
        self.classifier = torch.nn.Linear(backbone.fc.in_features, 64 * 13)
        state = torch.load(ckpt, map_location="cpu", weights_only=False)
        state = state.get("state_dict", state)
        self.features.load_state_dict({k[len("feature_extractor."):]: v for k, v in state.items()
                                       if k.startswith("feature_extractor.")})
        self.classifier.load_state_dict({k[len("classifier."):]: v for k, v in state.items()
                                         if k.startswith("classifier.")})
        self.features.eval()
        self.classifier.eval()
        self.chars = category_chars  # category id -> piece char
        self.mean = torch.tensor([0.47225544, 0.51124555, 0.55296206]).view(3, 1, 1)
        self.std = torch.tensor([0.27787283, 0.27054584, 0.27802786]).view(3, 1, 1)

    def predict(self, img: Image.Image) -> list[str]:
        # train.py: Resize(1024) (shorter side), ToTensor, dataset mean/std normalize
        x = torchvision.transforms.functional.to_tensor(img.convert("RGB"))
        x = torchvision.transforms.functional.resize(x, 1024, antialias=True)
        x = ((x - self.mean) / self.std).unsqueeze(0)
        with torch.no_grad():
            logits = self.classifier(self.features(x).flatten(1)).reshape(64, 13)
        return [self.chars[c] for c in logits.argmax(1).tolist()]  # already FEN order


class ChessQueriesLite:
    name = "ChessQueries Lite"

    def __init__(self, onnx_path: Path):
        self.session = ort.InferenceSession(str(onnx_path), providers=["CPUExecutionProvider"])
        self.input = self.session.get_inputs()[0].name
        self.mean = np.array([0.485, 0.456, 0.406], dtype=np.float32).reshape(3, 1, 1)
        self.std = np.array([0.229, 0.224, 0.225], dtype=np.float32).reshape(3, 1, 1)

    def predict(self, img: Image.Image) -> list[str]:
        # Plain 644x644 resize, [0,1], ImageNet normalize, CHW
        arr = np.asarray(img.convert("RGB").resize((644, 644), Image.BILINEAR), dtype=np.float32) / 255
        x = ((arr.transpose(2, 0, 1) - self.mean) / self.std)[None].astype(np.float32)
        logits = self.session.run(None, {self.input: x})[0].reshape(64, 13)
        return [PIECES[c] for c in logits.argmax(1)]  # FEN order


# ---------------------------------------------------------------- rendering

def board_png(board: list[str], truth: list[str] | None, size: int) -> Image.Image:
    b = chess.Board(to_placement(board) + " w - - 0 1")
    fill = {}
    if truth:
        for i in range(64):
            if board[i] != truth[i]:
                sq = chess.square(i % 8, 7 - i // 8)
                fill[sq] = "#e5534b"
    svg = chess.svg.board(b, size=size, coordinates=False, fill=fill,
                          colors={"square light": "#ebecd0", "square dark": "#739552"})
    return Image.open(io.BytesIO(cairosvg.svg2png(bytestring=svg.encode()))).convert("RGB")


def comparison_sheet(rows, out: Path):
    size = 220
    header = 36
    cols = ["Photo", "Ground truth"] + [name for name in rows[0]["preds"]]
    sheet = Image.new("RGB", (len(cols) * (size + 10) + 10, header + len(rows) * (size + 34) + 10), (22, 21, 18))
    d = ImageDraw.Draw(sheet)
    try:
        font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", 15)
        small = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 13)
    except OSError:
        font = small = ImageFont.load_default()
    for c, title in enumerate(cols):
        d.text((10 + c * (size + 10), 10), title, fill=(243, 242, 239), font=font)
    for r, row in enumerate(rows):
        y = header + r * (size + 34)
        photo = row["image"].copy()
        photo.thumbnail((size, size))
        sheet.paste(photo, (10, y))
        sheet.paste(board_png(row["truth"], None, size), (10 + (size + 10), y))
        for c, (name, pred) in enumerate(row["preds"].items(), start=2):
            sheet.paste(board_png(pred, row["truth"], size), (10 + c * (size + 10), y))
            wrong = sum(a != b for a, b in zip(pred, row["truth"]))
            d.text((10 + c * (size + 10), y + size + 6), f"{wrong} wrong squares",
                   fill=(129, 182, 76) if wrong == 0 else (229, 83, 75), font=small)
        d.text((10, y + size + 6), row["id"], fill=(168, 165, 160), font=small)
    sheet.save(out, quality=88)


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--annotations", type=Path, required=True)
    ap.add_argument("--images-url", required=True)
    ap.add_argument("--baseline-ckpt", type=Path, required=True)
    ap.add_argument("--cq-onnx", type=Path, required=True)
    ap.add_argument("--samples", type=int, default=100)
    ap.add_argument("--seed", type=int, default=2026)
    ap.add_argument("--out", type=Path, required=True)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    ann = json.loads(args.annotations.read_text())
    chars = {}
    for cat in ann["categories"]:
        name = cat["name"]
        if name == "empty":
            chars[cat["id"]] = "."
        else:
            color, piece = name.split("-")
            ch = {"pawn": "p", "knight": "n", "bishop": "b", "rook": "r", "queen": "q", "king": "k"}[piece]
            chars[cat["id"]] = ch.upper() if color == "white" else ch
    category_chars = [chars[i] for i in range(13)]

    images = {img["id"]: img for img in ann["images"]}
    truth = {}
    for p in ann["annotations"]["pieces"]:
        truth.setdefault(p["image_id"], ["."] * 64)[fen_index(p["chessboard_position"])] = chars[p["category_id"]]

    test_ids = list(ann["splits"]["test"]["image_ids"])
    rng = random.Random(args.seed)
    sample = rng.sample(test_ids, min(args.samples, len(test_ids)))
    print(f"ChessReD test split: {len(test_ids)} images; sampling {len(sample)} (seed {args.seed})")

    models = [Fenify(), ChessReDBaseline(args.baseline_ckpt, category_chars), ChessQueriesLite(args.cq_onnx)]
    stats = {m.name: {"wrong": [], "time": []} for m in models}
    fenify_rot_wrong = []
    rows = []

    with RemoteZip(args.images_url) as zf:
        names = {Path(n).name: n for n in zf.namelist()}
        for k, image_id in enumerate(sample):
            meta = images[image_id]
            member = names[Path(meta["path"]).name]
            img = Image.open(io.BytesIO(zf.read(member)))
            img.load()
            gt = truth.get(image_id, ["."] * 64)
            preds = {}
            for m in models:
                t = time.perf_counter()
                pred = m.predict(img)
                stats[m.name]["time"].append(time.perf_counter() - t)
                stats[m.name]["wrong"].append(sum(a != b for a, b in zip(pred, gt)))
                preds[m.name] = pred
            # fenify assumes White at the bottom of the photo; also score its best
            # rotation as a generous upper bound for photos taken from other sides.
            grid = np.array(preds["fenify-3D"]).reshape(8, 8)
            fenify_rot_wrong.append(min(
                sum(a != b for a, b in zip(np.rot90(grid, k).flatten().tolist(), gt)) for k in range(4)))
            rows.append({"id": Path(meta["path"]).stem, "image": img.convert("RGB"), "truth": gt, "preds": preds})
            print(f"[{k + 1}/{len(sample)}] {Path(meta['path']).name}: " +
                  ", ".join(f"{n}={stats[n]['wrong'][-1]}" for n in stats))

    def summarize(wrong, times=None):
        w = np.array(wrong)
        out = {
            "square_accuracy": float(1 - w.mean() / 64),
            "mean_wrong_squares": float(w.mean()),
            "boards_perfect": float((w == 0).mean()),
            "boards_le1_error": float((w <= 1).mean()),
        }
        if times is not None:
            out["sec_per_image_cpu"] = float(np.mean(times))
        return out

    results = {name: summarize(s["wrong"], s["time"]) for name, s in stats.items()}
    results["fenify-3D (best rotation, upper bound)"] = summarize(fenify_rot_wrong)
    (args.out / "results.json").write_text(json.dumps(
        {"samples": len(sample), "seed": args.seed, "results": results}, indent=2))

    lines = [f"ChessReD test split, {len(sample)} random photos (seed {args.seed})", "",
             f"{'Model':42} {'Square acc':>10} {'Wrong/board':>12} {'Perfect':>8} {'<=1 err':>8} {'s/img':>6}"]
    for name, r in results.items():
        lines.append(f"{name:42} {r['square_accuracy']*100:9.2f}% {r['mean_wrong_squares']:12.2f} "
                     f"{r['boards_perfect']*100:7.1f}% {r['boards_le1_error']*100:7.1f}% "
                     f"{r.get('sec_per_image_cpu', float('nan')):6.2f}")
    table = "\n".join(lines)
    print("\n" + table)
    (args.out / "results.txt").write_text(table + "\n")

    with open(args.out / "predictions.csv", "w") as f:
        f.write("image," + ",".join(stats) + ",truth\n")
        for row in rows:
            f.write(row["id"] + "," + ",".join(to_placement(p) for p in row["preds"].values()) +
                    "," + to_placement(row["truth"]) + "\n")

    for i in range(0, min(len(rows), 24), 6):
        comparison_sheet(rows[i:i + 6], args.out / f"samples-{i // 6 + 1}.jpg")

    # The app's own test photo (no ground truth): what each model reads.
    photo = Image.open(ROOT / "fenify-3D/readme-assets/prediction_example.png")
    preds = {m.name: m.predict(photo) for m in models}
    comparison_sheet([{"id": "app test photo (no ground truth)", "image": photo.convert("RGB"),
                       "truth": preds["ChessQueries Lite"], "preds": preds}], args.out / "app-test-photo.jpg")


if __name__ == "__main__":
    main()
