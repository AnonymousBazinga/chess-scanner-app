# Chess Scanner web

Production: https://chess-scanner-app.vercel.app

The Vercel scanner uses the structured Python recognizer: Fenify-3D, ChessQ Lite
V4, ChessQueries ViT-L, LeYOLO piece/grid detection and joint chess constraints.
The browser sends a resized photo to `/api/recognize`. The API processes it in
memory without saving it. Stockfish and the position editor remain in the browser.
GitHub Pages retains the previous browser-only recognizer as a static demo.

The models do not infer move history. Review the pieces, orientation, side to move
before analysis. Castling history cannot be recovered from a photo; the existing
editor infers castling rights from king/rook home squares. This is an experimental recognizer, not a
promise of exact recognition on every chess set.

## Deploy

Deploy from this `web/` directory to the existing personal Vercel workspace:

```sh
npx vercel@62.1.0 link --yes --project chess-scanner-app --scope anonymousbazingas-projects
npx vercel@62.1.0 --prod --scope anonymousbazingas-projects
```

The project needs Fluid compute and `VERCEL_SUPPORT_LARGE_FUNCTIONS=1` in both
Preview and Production. The build installs CPU-only Python requirements, downloads
pinned model assets and verifies SHA256 hashes from `scanner_backend/models.json`.
Only an explicit static-file allowlist is published; model weights, Python source,
tests and benchmark photos are not public static assets. Model assets are bundled
inside the function, so cold requests do not download weights from third parties.

All networks compute in FP32. ViT-L stores inactive encoder blocks in the
checkpoint’s original FP16 format and expands only the active block, then restores
its original tensors. Meta-device loading avoids duplicate initial allocations. Requests are serialized per instance to bound memory. Uploads
are limited to 4 MB / 16 megapixels and resized to at most 2048 pixels per edge.
The function has a 300-second timeout. No vision API keys are required.

## Development and tests

Use Python 3.12 on Linux with `requirements.txt`. On macOS use the same versions
of torch/torchvision without the `+cpu` suffix. Prepare assets with
`python3 scripts/build.py`. For a local API, serve `api.recognize.handler` with
Python's `HTTPServer`; serve the static frontend through Vercel dev or a proxy.

From the repository root:

```sh
PYTHONPATH=web python3 -m unittest discover -s web/tests
python3 -m unittest discover -s benchmark/vision_eval -p 'test*.py'
```

The original local prototype is preserved in `benchmark/vision_eval/` for
reproducibility. Its `serve_structured.py` defaults to the original temporary
model paths; provide `--source` and `--weights` for another installation.
The evaluation README records historical experiments, partial reference labels,
held-out tests and their limitations. Hosted release evidence belongs in
`DEPLOYMENT.md` alongside this file.

## Licenses and source

See `licenses/` and `scanner_backend/vendor/README.md`. ChessQueries code and
weights are PolyForm Noncommercial 1.0.0; this personal app is noncommercial.
Fenify is MIT. The CameraChessWeb-derived preprocessing is AGPL-3.0; corresponding
source is available in this repository and linked from the app's About panel.
These notices do not relicense noncommercial model weights as AGPL.
