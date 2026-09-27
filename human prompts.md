# Human Prompts

The prompts I wrote while building Chess Scanner (Jan 31 – Feb 1, 2026).

The full Claude Code session logs from this build no longer exist on disk. The prompts below were recovered from Cursor, where they had been attached as terminal snippets or typed into a Cursor chat.

## 1. Original build prompt (Claude Code, Jan 31, 2026)

> Create a new directory called "Chess Scanner". Create a Swift UI iOS app where you can take a picture of a physical board or a 2D board (like a screenshot) with chess pieces and it gets put into a board with an eval bar and the top engine lines which you can do analysis with (like it is using a stockfish engine).
>
> Take your time and think deeply to figure out a perfect UI and implementation of this app. It needs to work perfectly and smoothly

## 2. Follow-up questions (Cursor chat "Chess scanner preview status")

- **Jan 31, 2026:** is the chess scanner done? How can i preview it?
- **Jan 31, 2026:** how does it work? Does it use AI to scan the baord?
- **Jan 31, 2026:** What is the Approx elo of this engine?
- **Jan 31, 2026:** Can you do research to find a good model that can take a real life chess board image and then convert it into online format?
- **Feb 1, 2026:** What is CoreML in Swift Apps?

After the model research, the board-recognition model came from [notnil/fenify-3D](https://github.com/notnil/fenify-3D) (MIT). The full fenify-3D folder (weights, training notebook, inference code) is in `fenify-3D/`. It was converted to Core ML with `fenify-3D/convert_to_coreml.py` and bundled as `ChessScanner/Resources/FenifyChessRecognizer.mlpackage`.
