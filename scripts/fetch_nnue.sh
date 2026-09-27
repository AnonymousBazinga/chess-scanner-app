#!/usr/bin/env bash
# Downloads the Stockfish 17 networks ChessKitEngine needs into the app bundle.
# They are too large to commit; run this before `xcodegen generate` / building.
set -euo pipefail

DEST="$(cd "$(dirname "$0")/.." && pwd)/ChessScanner/Resources/NNUE"
mkdir -p "$DEST"

for net in nn-1111cefa1111.nnue nn-37f18f62d772.nnue; do
  if [ ! -f "$DEST/$net" ]; then
    echo "Downloading $net"
    curl -fsSL --retry 3 -o "$DEST/$net.tmp" "https://tests.stockfishchess.org/api/nn/$net"
    mv "$DEST/$net.tmp" "$DEST/$net"
  fi
  # Stockfish names each network after the first 12 hex digits of its SHA-256.
  expected="${net:3:12}"
  actual="$(shasum -a 256 "$DEST/$net" 2>/dev/null || sha256sum "$DEST/$net")"
  if [ "${actual:0:12}" != "$expected" ]; then
    echo "Checksum mismatch for $net" >&2
    rm -f "$DEST/$net"
    exit 1
  fi
done
ls -lh "$DEST"
