# Hosted structured scanner — 2026-10-02

Status: live on https://chess-scanner-app.vercel.app; production browser upload verified.

The runtime is isolated from benchmark references and provider credentials. The
five model assets are pinned by SHA256 in `scanner_backend/models.json`. The
upstream ChessQueries inference subset is pinned by commit in its vendor README.

The frozen experimental decoder remains in `benchmark/vision_eval/` unchanged.
Hosted packaging computes in FP32, with inactive ViT-L blocks kept in their
original checkpoint FP16 storage format. It avoids duplicate model allocations
during loading, caps uploads and serializes inference per instance. A generic missing-grid fallback now retries without an infeasible
occupancy lock; the historical frozen results are not rewritten.

Validation completed so far:

- 9 production API/decoder/storage tests: image validation, memory-bounded resolution,
  origin/media/size rejection, concurrent-request rejection, successful model
  dispatch, infeasible occupancy fallback, and block storage restoration even on failure.
- 8 original geometry/chess-constraint regression tests.
- JavaScript module syntax checks and whitespace checks.
- Independent release review; identified issues fixed and tested.
- Local packaging checks matched all seven original prototype placements
  ([saved parity results](tests/release-parity.json)); this checks packaging consistency,
  not correctness of every prediction.
- The packaged runtime also returned 12/12 exact placements on the previously used
  CVChess confirmation positions after 2048-pixel upload preprocessing
  ([saved confirmation results](tests/confirmation-parity.json)). These repeat known
  evaluation positions, rather than adding a new independent accuracy sample.

The original six diagnostic photos include four with only partial reference
labels. Their confirmed errors fell from 56 with Fenify to 9 with the structured
pipeline. Visual fusion without chess constraints also totaled 9: constraints
helped one photo and hurt another. The seventh, subsequently supplied photo
matched all 32 pieces in the local prototype. Separate CVChess tests returned
24/24 exact up to rotation, then 12/12 with native output orientation after the
frame-handling fix. Model training overlap with CVChess is unverified; this does
not establish universal reliability or independent generalization.

Hosted preview evidence:

- Preview: https://chess-scanner-gd409eu4j-anonymousbazingas-projects.vercel.app
- Deployment ID: `dpl_EL4Zb9YABYkh8UbmxfckvvVMxep8`.
- Latest photo (7): exact placement; 27.844 s inference / 39.033 s cold HTTP request.
- Three further sequential requests (photos 2, 5, 7) all returned HTTP 200 and
  matched original prototype placements. Inference took 25.9–35.2 s; total command
  time including CLI/auth/network was 43.0–54.8 s.
- These are parity checks, not claims that every original prediction is correct.
  [Saved preview responses](tests/preview-results.json) preserve the returned placements.
- The earlier all-FP16 compute deployment took 130.5 s for photo 7 and was rejected.
  Block-wise FP32 computation preserves original checkpoint values and is faster.

Production verification:

- URL: https://chess-scanner-app.vercel.app
- Deployment: `dpl_GcjJQfz9eyQjak1XKTcivcVvUGpu`.
- Runtime source: `1e554b38a605af034a3bd294f0d6d8cff02b188b`; the public API reports
  that exact revision and `structured-visual-v2`.
- Uploaded the seventh supplied image through the production Photos control.
  Read back the rendered board from the DOM: 64 squares, 32 pieces, zero differences
  against the independently recorded reference. Analyze opened the matching FEN.
- A screenshot is retained locally in ignored QA output at
  `qa/out/production-scanner-20261002.jpg`.
- Stockfish reached depth 22 and displayed three analysis lines; browser console
  had no errors. Screenshot: `qa/out/production-analysis-20261002.jpg`.
- A second production API scan (photo 2) returned the exact reference position,
  HTTP 200, 27.375 s inference / 37.644 s HTTP time, with the correct source revision
  ([saved response](tests/production-api.json)).
- [Browser verification record](tests/production-browser.json).
- No paid hosting plan or vision API service was added.

