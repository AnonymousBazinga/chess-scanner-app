# Chess Scanner

An iOS app that turns a photo of a chess board into a position you can analyze with Stockfish.

1. **Scan**: take a photo of a physical board (or pick one from Photos). The on-device
   [fenify-3D](fenify-3D/) Core ML model reads the pieces.
2. **Review**: fix any misread squares in the editor. Pick a piece from the palette and tap
   squares, drag pieces to move them (or off the board to remove them), and set the side to
   move and castling rights. Illegal positions are flagged before analysis.
3. **Analyze**: Stockfish 17 runs on device with an evaluation bar, the top three lines, a
   best-move arrow, and a playable board.

## Building

```sh
scripts/fetch_nnue.sh   # Stockfish 17 networks (~75 MB, not committed)
xcodegen generate       # optional: the committed project is generated from project.yml
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

## Credits

- Board recognition: [notnil/fenify-3D](https://github.com/notnil/fenify-3D) (MIT)
- Engine: Stockfish 17 via [chesskit-engine](https://github.com/chesskit-app/chesskit-engine)
- Pieces: Colin M.L. Burnett's set, as used by Lichess (GPLv2+ / BSD)
