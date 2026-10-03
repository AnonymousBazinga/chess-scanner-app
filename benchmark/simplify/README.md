# Conservative scanner pruning — 2026-10-02

Stage one is commit `98fe3a4`; stage two builds on it.

The retained changes reproduce every prediction response field except elapsed
seconds on **67/67 images**. Neural forward passes fall from **603 to 296** (50.9%)
in this batch. This is less inference work, not a 50.9% latency claim or a smaller
model download. All three board architectures remain necessary in the tested
pipeline. This pass does not claim a globally minimal implementation.

## Changes retained

1. Fit the grid without rendering an unused 800×800 warped photo. Detect pieces
   only if the grid fit succeeds. Without usable objects, run only `v4_0`, the
   sole view consumed by the existing fallback. Load Fenify and ViT-L only on
   requests that use the ensemble. This stage preserved 43/43 full responses.
2. Stop each model's rotation search at **exactly zero** geometry cost. Every
   penalty is nonnegative and the original selector keeps the first tied
   minimum. Therefore no later view can replace a zero-cost winner. There is no
   confidence threshold, tolerance, image-specific rule or label-based shortcut.
   The combined stages preserved 67/67 full responses, including component
   selection/weights, orientation, decoder metadata and review squares.

The API already serializes recognition within each instance. Lazy model loading
uses that same lock. ViT-L's FP32 computation / FP16 inactive storage remains
unchanged; removing it while keeping ViT-L would compromise the hosting memory
budget. No chess rules, fusion weights, geometry thresholds or model weights changed.

## What the removals revealed

Single-factor ablations on seven diagnostic photos and the previous 36 CVChess
positions were checked against both baseline output and reference labels. The
baseline in the independent ablation harness reproduced all 43 runtime boards.
“New errors” below were correct in the original output; fixing a different square
never cancels that regression. Full per-board results are in [results.json](results.json).

| Removal | Identical boards / 43 | Newly wrong squares | Fixed squares |
|---|---:|---:|---:|
| ViT-L | 40 | 8 | 1 |
| Fenify | 38 | 27 | 3 |
| All models except V4 + constraints | 39 | 50 | 3 |
| Chess constraints | 37 | 6 | 4 |
| Detector identity evidence | 39 | 3 | 2 |
| Geometry weighting (equal weights instead) | 39 | 16 | 3 |
| Frame alignment search | 32 | 403 | 1 |
| All but the first Fenify rotation | 40 | 3 | 3 |
| All but the first V4 rotation | 41 | 30 | 2 |
| Inventory penalty | 41 | 2 | 1 |
| Occupancy lock | 41 | 2 | 0 |
| Second pawn-axis decode | 34 | 33 | 3 |
| Rotations after an exact-zero winner | 43 | 0 | 0 |

This explains why overall averages were misleading. Keeping only one Fenify
rotation leaves the total confirmed error count unchanged, but swaps three
correct squares for three different fixes. Removing constraints also fixes some
mistakes, yet loses the correct black bishop on b4 and rook on h1 in photo 7.
Removing ViT-L causes a regression on a CVChess position as well as on diagnostic
photos; its benefit is not restricted to the original small examples.

The architectures make complementary errors. V4 alone handles most CVChess photos
well but is substantially worse on the unusual sets. Geometry aligns those
architectures into a common coordinate system and prevents incompatible boards
from being blended. The chess prior and detector identity evidence help some
squares and hurt others; deleting either globally fails the no-regression goal.
A future conditional replacement needs new evidence and separate validation.

## Evaluation boundary

- Baseline source: `6778e53`; file hashes and input hashes are preserved in results.
- Discovery: 7 diagnostic images + 36 previously evaluated distinct CVChess positions.
- Validation: 24 additional positions, disjoint by full piece-placement FEN from
  all prior 36. Reserved with seed `20261004` before choosing the retained cuts.
- Native output orientation is compared directly; no rotation is chosen using truth.
- Four diagnostic photos have partial piece-identity labels. Their confirmed-error
  counts are lower bounds, not fully labeled accuracy estimates.
- Both baseline and candidate have nine confirmed errors across the diagnostics.
  Both match 36/36 prior CVChess boards and 23/24 reserved boards. One existing
  wrong square remains in the reserved batch. Exact parity preserves mistakes too.
- Training overlap with CVChess is unverified. These are useful regression checks,
  not proof of accuracy on all sets or independent model generalization.
- 32/67 inputs use the one-view fallback. Six of seven diagnostic photos still
  require nine views; the sparse fourth photo drops to six. The 51% reduction is
  specific to this mixed batch, not a promise for each upload.
- All 15 runtime/API/storage/pruning tests and 8 historical geometry/decoder tests pass.

## Warm timing check

Three paired rounds on six fixed images, four CPU threads, with no concurrent
inference jobs: the three fallback cases fell from median 5.25–5.57 seconds to
0.49–0.52 seconds. The sparse diagnostic photo fell from 6.49 to 3.99 seconds.
The nine-view seventh photo changed from 5.05 to 5.34 seconds (about 6% slower
in this small timing run). There is no general speedup claim for images that
still need all nine views. Full medians and the method are recorded in results.

## Reproduce

Use the Python environment and model assets described in `../../web/README.md`.
The existing image manifests and inputs live in ignored
`web/qa/out/vision-evaluation-20261002/`; benchmark photos are not deployed or
committed. These scripts are offline evaluation utilities, never runtime imports.

1. Extract the baseline `web/scanner_backend` package from commit `6778e53` into a
   separate directory. Set `SCANNER_SOURCE` to its parent `web` directory when
   running `collect.py`; it records nine-view posteriors and freezes source hashes.
   The current production weights are reused. Do not collect a baseline with the
   pruned runtime, which intentionally no longer evaluates every view.
2. Run `reserve.py CATALOG_JSON CVCHESS_LABELS_JSON` to reproduce the reservation
   and download images through gdown. The catalog maps image paths to Drive IDs;
   labels come from the upstream ChessQueries CVChess resource. Existing frozen
   manifests cannot be overwritten with a different selection.
3. Run `collect.py --reserved` with that same `SCANNER_SOURCE`. Run `ablate.py`
   without it to reproduce the 43-board single-factor comparison.
4. Run `compare.py step1` against the stage-one code, then `compare.py step2
   --reserved` against the combined code. Source-stage replay evidence is retained
   in the local output; the final code includes both stages.
5. Run `timing.py BASELINE_BACKEND_DIRECTORY` without other inference jobs for
   paired warm timings (three rounds, alternating order, six fixed cases).
6. Run `evidence.py` and `report.py` to export compact results and the interactive
   side-by-side board report. Serve the generated `simplification/review/` folder.

The visual report shows every original user photo, original output and selected
ablation output. Gold borders mark changed squares; red dots mark confirmed errors.
