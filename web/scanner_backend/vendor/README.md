# ChessQueries inference subset

Copied from https://github.com/JSeytre/chessqueries at
`7347c8477433878dcba9b6bfc683d69b90656d16`.
Copyright Joël Seytre. PolyForm Noncommercial 1.0.0; see
`web/licenses/ChessQueries.txt` in this repository.

Only core chess types, the model architecture and base class are included.
`models/__init__.py` is reduced to avoid importing training/LLM modules.
The separate `scanner_backend/model.py` loads identical tensor names on the
meta device, eliminating duplicate model allocations during cold starts.
