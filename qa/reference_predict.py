"""Reference board predictions for the UI-test fixtures.

Runs the app's recognizer model (ChessQueries Lite ONNX) with its reference
preprocessing (plain resize to 644x644, RGB, ImageNet normalization) and writes
{fixture: fen} JSON, which the UI tests compare against the app's scan.
Requires onnxruntime, pillow and numpy.
"""
import json
import sys
from pathlib import Path

import numpy as np
import onnxruntime as ort
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MODEL = ROOT / "ChessScanner/Resources/Models/chessquerieslite-vits-644-int8.onnx"
FIXTURES = ROOT / "ChessScannerUITests/Fixtures"
PIECES = ".PNBRQKpnbrqk"
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def preprocess(path):
    img = Image.open(path).convert("RGB").resize((644, 644), Image.BILINEAR)
    x = (np.asarray(img, dtype=np.float32) / 255.0 - MEAN) / STD
    return x.transpose(2, 0, 1)[None].astype(np.float32)


def to_fen(classes):
    ranks = []
    for r in range(8):  # FEN order: a8..h8 first
        row, empty = "", 0
        for c in classes[r * 8:(r + 1) * 8]:
            ch = PIECES[c]
            if ch == ".":
                empty += 1
            else:
                row += (str(empty) if empty else "") + ch
                empty = 0
        ranks.append(row + (str(empty) if empty else ""))
    return "/".join(ranks) + " w - - 0 1"


def main():
    session = ort.InferenceSession(str(MODEL), providers=["CPUExecutionProvider"])
    name = session.get_inputs()[0].name
    results = {}
    for path in sorted(FIXTURES.glob("*.png")) + sorted(FIXTURES.glob("*.jpg")):
        logits = session.run(None, {name: preprocess(path)})[0].reshape(64, 13)
        probs = np.exp(logits - logits.max(1, keepdims=True))
        probs /= probs.sum(1, keepdims=True)
        results[path.name] = to_fen(probs.argmax(1).tolist())
        print(f"{path.name}: {results[path.name]}  (min square confidence {probs.max(1).min():.2f})")
    out = FIXTURES / "expected.json"
    out.write_text(json.dumps(results, indent=2) + "\n")
    print(f"Wrote {out}")
    return 0 if results else 1


if __name__ == "__main__":
    sys.exit(main())
