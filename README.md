# Chess Scanner

An iOS app that turns a photo of a chess board into a position you can analyze with Stockfish.

1. **Scan**: take a photo of a physical board (or pick one from Photos). The on-device
   [ChessQueries Lite](https://github.com/JSeytre/chessqueries) model (ViT-S, int8 ONNX, run
   with ONNX Runtime) reads the pieces from the whole photo, no cropping needed. Squares it is
   unsure about are outlined in the editor.
2. **Review**: fix any misread squares in the editor. Pick a piece from the palette and tap
   squares, drag pieces to move them (or off the board to remove them), and set the side to
   move and castling rights. Illegal positions are flagged before analysis.
3. **Analyze**: Stockfish 17 runs on device with an evaluation bar, the top three lines, a
   best-move arrow, and a playable board.

## Building

```sh
scripts/fetch_models.sh # Stockfish networks + ChessQueries Lite model (~110 MB, not committed)
xcodegen generate       # regenerate the project from project.yml
open ChessScanner.xcodeproj
```

Requires Xcode 16+ and iOS 17+. `project.yml` is the source of truth for the project;
regenerate with [XcodeGen](https://github.com/yonaskolb/XcodeGen) after adding files.

## QA

`ChessScannerUITests` drives the app end to end in the simulator: scan a board photo, check
the recognized position against the reference model, fix it in the editor, analyze with
Stockfish, reopen from history, plus palette editing, drag moves, illegal-move rejection,
promotion and the Photos picker. Every step attaches a screenshot.

The [`iOS QA`](.github/workflows/ios-qa.yml) workflow runs this on a macOS runner for every
push. It also computes reference predictions (`qa/reference_predict.py`) and publishes
screenshots and results to the `refs/qa/latest` git ref (not a branch):

```sh
git fetch origin refs/qa/latest && git archive FETCH_HEAD | tar -x -C qa-results
```

## Recognition accuracy

`benchmark/run.py` compares recognizers on real phone photos of physical boards: ChessReD's
test split (same collection ChessReD/ChessQueries trained on, different photos) and CVChess,
a board, set and room none of the models trained on. Each model gets the preprocessing from its
own reference code.

| Model | ChessReD test (100 photos): wrong squares / board, boards exactly right | CVChess unseen (all 352 for ChessQueries, 100 for others): wrong squares / board, boards exactly right |
|---|---|---|
| fenify-3D (previous) | 38.2 · 0% | 34.9 · 0% |
| ChessReD ResNeXt baseline | 3.2 · 21% | 10.3 · 0% |
| **ChessQueries Lite (current)** | **0.05 · 95%** | **1.3 · 60%** (80% with at most one wrong square) |

## License note

ChessQueries' model weights are licensed **PolyForm Noncommercial 1.0.0**: this app may not
be sold, carry ads or in-app purchases, or be used commercially while it ships that model.

## Credits

- Board recognition: [ChessQueries](https://github.com/JSeytre/chessqueries) by Joël Seytre
  (PolyForm Noncommercial 1.0.0); previously [notnil/fenify-3D](https://github.com/notnil/fenify-3D) (MIT)
- Engine: Stockfish 17 via [chesskit-engine](https://github.com/chesskit-app/chesskit-engine)
- Pieces: Colin M.L. Burnett's set, as used by Lichess (GPLv2+ / BSD)
