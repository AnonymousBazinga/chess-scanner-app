# Structured visual recognizer

Photo → piece/grid detectors → aligned model probabilities → chess constraints
→ canonical placement → editable FEN.

The runtime reads only image pixels and pinned model weights. There are no sample
names, known positions, benchmark references, API credentials or LLM calls.

When no usable grid objects exist, only the V4 fallback runs; Fenify and ViT-L
load lazily when needed. Rotation searches stop at an exact-zero geometry score,
the proven lower bound, preserving the original first-minimum tie rule. Grid
fitting returns coordinates without rendering an unused rectified image.

The decoder selects one rotation per model using independent occupied-square and
piece-color evidence, mixes probabilities, adds modest detector identity evidence,
then solves a constrained assignment. It enforces necessary chess conditions
(king counts, nonadjacent kings, pawn ranks, piece inventory with promotions).
These rules cannot prove a position is legal or recover its move history.

Licenses: `vision_geometry.py` is derived from Pbatch/CameraChessWeb at
`6410b636a5a20cf81987eb2151ede6664a0c4b07` and is AGPL-3.0, with the full license at
`../licenses/CameraChessWeb.txt`. The bundled LeYOLO ONNX files came from that
project's published piece/grid model links; hashes are in `models.json`.
ChessQueries model code/weights remain PolyForm Noncommercial 1.0.0; Fenify is MIT.
The recognizer and integration source are available at:
https://github.com/AnonymousBazinga/chess-scanner-app/tree/web-version/web

The [pruning audit](../../benchmark/simplify/README.md) records 67-image full-response
parity and the regressions caused by rejected whole-layer removals.
