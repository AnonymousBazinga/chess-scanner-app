#!/usr/bin/env bash
# Downloads the model files the app bundles but the repo doesn't commit:
#   - Stockfish 17 NNUE networks (ChessKitEngine)
#   - ChessQueries Lite int8 ONNX board recognizer (PolyForm Noncommercial 1.0.0)
# Run before `xcodegen generate` / building.
set -euo pipefail

RES="$(cd "$(dirname "$0")/.." && pwd)/ChessScanner/Resources"
mkdir -p "$RES/NNUE" "$RES/Models"

sha256() { shasum -a 256 "$1" 2>/dev/null | cut -c1-64 || sha256sum "$1" | cut -c1-64; }

fetch() { # url dest
  if [ ! -f "$2" ]; then
    echo "Downloading $(basename "$2")"
    curl -fsSL --retry 3 -o "$2.tmp" "$1"
    mv "$2.tmp" "$2"
  fi
}

for net in nn-1111cefa1111.nnue nn-37f18f62d772.nnue; do
  fetch "https://tests.stockfishchess.org/api/nn/$net" "$RES/NNUE/$net"
  # Stockfish names each network after the first 12 hex digits of its SHA-256.
  if [ "$(sha256 "$RES/NNUE/$net" | cut -c1-12)" != "${net:3:12}" ]; then
    echo "Checksum mismatch for $net" >&2; rm -f "$RES/NNUE/$net"; exit 1
  fi
done

# Pinned to the last upstream commit that ships this ONNX export (later commits
# removed it); it's the exact file the benchmark in README.md measured.
MODEL="$RES/Models/chessquerieslite-vits-644-int8.onnx"
fetch "https://huggingface.co/joelseytre/chessqueries/resolve/5d29dfc5b289a31c80018154c797ebe4f0713321/chessquerieslite-vits-644-int8.onnx" "$MODEL"
if [ "$(sha256 "$MODEL")" != "1c7b2968263b9a51b4405f4cad8228a81283fdc458031f13f0c53fa2c147c402" ]; then
  echo "Checksum mismatch for $(basename "$MODEL")" >&2; rm -f "$MODEL"; exit 1
fi

ls -lh "$RES/NNUE" "$RES/Models"
