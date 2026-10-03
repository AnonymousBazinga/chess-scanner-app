# Hosted structured scanner — 2026-10-02

Status: live on https://chess-scanner-app.vercel.app. The initial release is recorded
below; the later simplification release is documented at the end.

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

## Conservative pruning release

Runtime source: `a6e208e6edbd84c4f9c1e0172142e115366dab4e` (stage one: `98fe3a4`).
Deployment: `dpl_HFTWFrwPQmHA1err7SYDAQVjqxeF`.
Deployment URL: https://chess-scanner-1rzzqod3a-anonymousbazingas-projects.vercel.app

Skipped unused fallback model views and piece detection, removed an unused
rectified image, loaded ensemble models on demand, and stopped rotation searches
only at the exact-zero lower bound. The three model architectures, geometry
thresholds, fusion weights and chess constraints remain unchanged.

- Stage one matched all response fields except elapsed time on 43/43 images.
- Combined changes matched 67/67 full responses, including 24 newly reserved
  distinct positions. Neural passes fell from 603 to 296 on this batch.
- Whole-layer ablations caused new errors and were rejected.
- 15 runtime tests and 8 historical regression tests passed.
- Built with `--prod --skip-domain`, checked three paths on the deployment URL,
  then promoted that same deployment to the production domains. The public URL
  continued serving the prior revision until promotion.
- Hosted fallback: 2.190 s inference; shortened rotation case: 22.384 s; full
  nine-view case: 24.498 s. All three preserved FEN, photo-frame placement,
  orientation and review squares relative to baseline inference on identical
  upload bytes. These are three spot checks, not a hosted latency distribution.

The public API also returned HTTP 200 for the fallback image after promotion,
with the expected placement/review squares and the new runtime revision.

[Pruning protocol and limitations](../benchmark/simplify/README.md),
[per-board evidence](../benchmark/simplify/results.json), and
[hosted verification](../benchmark/simplify/hosted.json). The reference labels
remain incomplete for four diagnostic photos; both versions retain the same
nine confirmed diagnostic errors and one error among the 24 reserved boards.
