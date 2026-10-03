# Web changelog

## 2026-10-02

- Use the structured recognition service on Vercel, combining three board models,
  automatic piece/grid geometry and chess constraints.
- Keep the existing scanner/editor/Stockfish flow and show uncertain squares for review.
- Process uploaded photos in memory; correct the privacy text for server inference.
- Fit full-precision computation within the free hosting memory limit by expanding
  only the active ViT-L block; pin and verify all model assets during build.
