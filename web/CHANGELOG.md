# Web changelog

## 2026-10-02

- Skip unused fallback models and piece detection, load ensemble models on demand,
  remove an unused board warp, and stop rotations at an exact-zero geometry score.
  All 67 replayed responses remain identical apart from elapsed time; 603 neural
  passes become 296 in this batch. Preserve layers whose removal caused regressions.

- Use the structured recognition service on Vercel, combining three board models,
  automatic piece/grid geometry and chess constraints.
- Keep the existing scanner/editor/Stockfish flow and show uncertain squares for review.
- Process uploaded photos in memory; correct the privacy text for server inference.
- Fit full-precision computation within the free hosting memory limit by expanding
  only the active ViT-L block; pin and verify all model assets during build.
