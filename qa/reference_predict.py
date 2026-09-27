"""Reference board predictions for the UI-test fixtures.

Runs the bundled Core ML model with fenify's reference preprocessing
(resize to 400x400, RGB, ImageNet normalization) and writes
{fixture: fen} JSON, which the UI tests compare against the app's scan.
Requires macOS (Core ML) with coremltools, pillow and numpy.
"""
import json
import sys
from pathlib import Path

import coremltools as ct
import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
MODEL = ROOT / "ChessScanner/Resources/FenifyChessRecognizer.mlpackage"
FIXTURES = ROOT / "ChessScannerUITests/Fixtures"
PIECES = ".PNBRQKpnbrqk"
MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


def preprocess(path):
    img = Image.open(path).convert("RGB").resize((400, 400), Image.BILINEAR)
    x = (np.asarray(img, dtype=np.float32) / 255.0 - MEAN) / STD
    return x.transpose(2, 0, 1)[None].astype(np.float32)


def to_fen(classes):
    board = classes.reshape(8, 8)  # board[rank][file], rank 0 = rank 1
    ranks = []
    for rank in range(7, -1, -1):
        row, empty = "", 0
        for file in range(8):
            c = PIECES[board[rank][file]]
            if c == ".":
                empty += 1
            else:
                row += (str(empty) if empty else "") + c
                empty = 0
        ranks.append(row + (str(empty) if empty else ""))
    return "/".join(ranks) + " w - - 0 1"


def main():
    model = ct.models.MLModel(str(MODEL), compute_units=ct.ComputeUnit.CPU_ONLY)
    results = {}
    for path in sorted(FIXTURES.glob("*.png")) + sorted(FIXTURES.glob("*.jpg")):
        probs = model.predict({"input_image": preprocess(path)})["output"].reshape(64, 13)
        results[path.name] = to_fen(probs.argmax(axis=1))
        confidence = probs.max(axis=1)
        print(f"{path.name}: {results[path.name]}  (min square confidence {confidence.min():.2f})")
    out = FIXTURES / "expected.json"
    out.write_text(json.dumps(results, indent=2) + "\n")
    print(f"Wrote {out}")
    return 0 if results else 1


if __name__ == "__main__":
    sys.exit(main())
