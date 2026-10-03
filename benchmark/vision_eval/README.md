> Release packaging (2026-10-02): the structured recognizer is deployed in
> the Vercel app. See [release validation](../../web/DEPLOYMENT.md) for verified release status and
> hosted precision-parity checks. Historical local-only results below are preserved.

# Two-image scanner evaluation — October 2, 2026

## Later six-photo audit: earlier LLM conclusions were too broad

The user challenged whether Inkling and Gemini had been tested correctly. The
new report is `web/qa/out/vision-evaluation-20261002/llm-audit/index.html`
(served at <http://127.0.0.1:8767/llm-audit/>), with a permanent Fenify column,
all six photos, partial references, selectable actual model outputs, raw
responses and explicit incomplete/error states. `audit_report.py` rebuilds it.
Historical artifacts and prototype behavior are preserved. No replacement was
deployed, and none of the new candidates reliably solves all six photos.

### What the audit corrected

- Inkling previously rejected the plain API evaluation client. That was not an
  accuracy result. `inkling_audit.py` now invokes the actual installed Claude
  Code client using OpenRouter's documented integration, with tools disabled,
  no repository context, no persistent session, and all model roles pinned to
  `thinkingmachines/inkling:free`. A first run emitted tool-protocol text;
  replacing the coding system prompt with a transcription prompt produced six
  actual image answers. Three had invalid row lengths and were not repaired.
  The three valid boards had 38, 18 and 20 confirmed mismatches on photos 2, 4
  and 6 respectively. OpenRouter key usage remained 0 before/after every run.
  Claude Code's local cost estimate uses an unknown model cost basis and is
  **not a provider charge**.
- `gemini_audit.py` uses temperature 1, explicit high thinking and high media
  resolution, 32,768 output tokens, unchanged image bytes and photo-relative
  row/column coordinates. It records hashes, endpoint, settings, visible answer
  and usage. Google recommends default temperature 1 for Gemini 3; default image
  resolution was already approximately high, so this is not evidence that the
  earlier images were severely downsampled. Earlier successful Flash Preview
  calls already used substantial thinking; they were not all Lite/no-thinking.
- Both current Interactions and generateContent endpoints were checked. Newer
  Flash 3.8/3.6/3.5 requests returned capacity errors. 2.5 Pro returned unavailable
  for new users; 3.1 Pro returned a free quota limit of zero. Pro quality remains
  unmeasured. Its AI Studio browser upload is awaiting the separate copyright/
  terms acknowledgement confirmation; no billing was enabled.
- Fixed display rotations now separate orientation-only disagreement from actual
  square/type errors for photo-relative outputs. These are view transforms, not
  an automatic orientation success. Original raw placements remain available.

This round made 57 Google requests: 46 HTTP 200 responses, eight capacity errors,
one zero-free-quota error, one unavailable-model error and one timeout. An HTTP
200 crop response is not necessarily a complete or correct board.

### Geometry and object isolation experiments

CameraChessWeb's LeYOLO models were downloaded from the author's public links.
Source commit: `6410b636a5a20cf81987eb2151ede6664a0c4b07`, AGPL-3.0. Weight hashes
are recorded in `leyolo-image*.json`. The port in `leyolo_audit.py` tests the
detectors, not the author's full live-game tracker. Its published upright-piece
base rule can fail on overhead/sideways pieces.

The corner detector returned 48–49 intersections on every photo.
`grid_normalize.py` fits an automatic projective grid with 48–49 inliers and
median reprojection errors of 0.22–1.60 pixels. This is grid-fitting consistency,
not proof of piece-recognition accuracy. It rejects insufficient/inconsistent
lattices and currently requires separable image rows/columns. Manual corners
never enter this fitter or the automatic object-classification experiment.

`normalized_models.py` saved 162 fixed Fenify/V4 predictions: original, automatic
crop and automatic rectification, four rotations, plus Fenify rotation averages.
Cropping/rectification is not uniformly beneficial. Rotation averaging badly
regresses on the angled photo. Near-1.0 per-square probabilities coexist with
large errors, so these are not trustworthy confidence estimates on these images.

`geometry_audit.py` separately tests manually marked full grids on all six and
64 explicitly outlined target-square panels on photo 2. The latter still makes
22 errors; the whole marked grid makes 34. These are diagnostics, not automated
pipeline scores. `detection_crops.py` instead classifies *automatically detected
object boxes*, without square labels or supplied identities, then maps the
published base estimate through the automatic grid.

| Photo | Fenify alone, display rotation accounted for | Gemini Lite whole | Automatic object crops + Gemini Lite |
|---|---:|---:|---:|
| 1 Getty | 0 occupancy; identities unverified | 16 occupancy | 9 occupancy |
| 2 Angled carved | 4 | 21 | 6 (4 missing objects) |
| 3 Yellow/black | ≥14 | ≥8 | ≥15; incomplete classification |
| 4 Sparse Alamy | 22 | 15 | 1 (white king read as queen) |
| 5 Tiny Shutterstock | ≥8 | ≥11 | ≥1; 19 types unverified |
| 6 Warm shadows | ≥8 | ≥27 | ≥16; incomplete classification |

Except photo 1, these are confirmed square mismatches. ≥ explicitly indicates
partial type labels. Whole Flash Preview produced one valid rerun (photo 2, 13
errors), four capacity errors and one timeout. Object crops improve some photos
substantially, but do not establish a usable scanner.

`aligned_consensus.py` fixes the conceptual coordinate mismatch in an isolated
candidate, but color-centroid orientation is unreliable for scattered pieces.
`evidence_select.py` uses an independent detector to align/select whole-board
proposals, without reference labels or per-photo branches. Its frozen rule
scores missing detected objects, color conflicts and unsupported occupied cells.
It still has 0 occupancy / 5 / ≥5 / 1 / ≥1 / ≥9 errors. Neither candidate is
integrated into the running hybrid or recommended as a replacement.

Four executable coordinate regression checks pass: projective recovery with a
missing intersection, rejection of insufficient geometry, rotation preserving
piece identity, and detector-based proposal alignment. These check code, not
model accuracy. Run:

```sh
/tmp/chess-vision-eval-venv/bin/python -m unittest discover \
  -s benchmark/vision_eval -p test_geometry_audit.py -v
```

All six photos are now development examples. Future selection/training changes
need new, fully labelled test boards; selecting the best variant per photo using
these references would be oracle selection, not measured automatic performance.

Primary references: [Google Gemini 3 settings](https://ai.google.dev/gemini-api/docs/gemini-3),
[media resolution](https://ai.google.dev/gemini-api/docs/media-resolution),
[OpenRouter client integration](https://openrouter.ai/docs/cookbook/coding-agents/claude-code-integration),
[CameraChessWeb](https://github.com/Pbatch/CameraChessWeb).

## Subsequent four-photo test: hybrid does not generalize

The user supplied four new photos after the two-image development evaluation.
All four were run through the unchanged hybrid, followed by separately saved
manual-rotation diagnostics. The raw hybrid failed all four. Its new visual
audit is `web/qa/out/vision-evaluation-20261002/new-batch-review/index.html`, with
`overview.png` for a static side-by-side view and `results.json` for predictions
and explicitly partial manual references. Rebuild with `batch_visual.py`.

The viewer defaults to untouched uploads and can switch to rotation-assisted
runs or any component model. Red indicates a verified disagreement, including
orientation. Amber indicates an unverified identity. No output is repaired for
display. Reference positions use the stated comparison orientation, regardless
of the board's printed labels. Scores with partial labels are lower bounds on
total piece errors, not full-board accuracy.

Two problems invalidate the earlier prototype as a general solution: components
can disagree about board orientation, and Fenify's occupancy can be much worse
than another component's. For the yellow/black photo, rotating the *original
Fenify output grid* 90 degrees changes its occupancy disagreement from 30 squares
to zero; the other component already inferred a different frame. On the sparse
Alamy photo, V4 alone gets all 11 occupied squares and makes one identity error
(bishop read as queen); the hybrid makes 26 confirmed square errors. Manual input
rotation does not reliably fix the combination.

These findings supersede any recommendation to use the hybrid generally. The
earlier exact result on image 2 is preserved below as a development-set result.
No recognition code or voting rules were changed during this new test batch.

**Follow-up outcome:** the new local hybrid reads image 2 exactly: **0 wrong
squares**, versus Fenify's 4 and the deployed Lite reference's 16. Its image-1
occupancy is correct, but full piece identities remain unverified. This is a
small diagnostic, not an estimate of general accuracy. The hosted site has not
been deployed or changed. The existing UI now supports a local experimental
backend through an explicit loopback-only opt-in.

## Working local prototype

`hybrid.py` runs Fenify, ChessQueries ViT-L and ChessQ Lite V4 on arbitrary photos.
It retains Fenify's occupancy and takes a nonempty majority vote for each piece
identity. A tie retains Fenify. Every model disagreement is included in the API
response; agreement is not a calibrated confidence score. Inference imports no
benchmark scoring functions, reference labels, saved predictions or sample hashes.

Start the server from the repository root, using the existing evaluation runtime:

```sh
/tmp/chess-vision-eval-venv/bin/python benchmark/vision_eval/serve_hybrid.py \
  --source /tmp/chess-vision-chessqueries \
  --vitl /tmp/chess-vision-weights/chessqueries-vitl-644-safetensors-fp16-r1.safetensors \
  --v4 /tmp/chess-vision-weights/cq-vit-s-644-v4-seed2-safetensors-fp16-r2.safetensors
```

Open <http://127.0.0.1:8766/?scanner=hybrid>. The server is running after this
evaluation. These `/tmp` dependencies are evaluation caches; preserve them or
recreate the pinned source/weights described in `provenance.json` if the system
cleans them. All paths are configurable. The three models total about 0.9 GB on
disk. They run in Python on this computer, with no API key and no external image
upload. The server binds to loopback and rejects foreign Host/Origin headers.
This is a development server, not a production deployment target.

Fresh endpoint inference used both original images, brightness ×0.9 and ×1.1,
and an 80% resize. Image 2 was exact in all four cases. Image 1 gave the same
prediction and zero occupancy errors in all four. These transformations are
stability checks on the same development examples, not independent test boards.
CPU inference took 10.6–31.3 seconds in this run. The real website Photos upload,
64-square editor result and Stockfish analysis were verified for image 2.
Invalid image bytes returned 400; a foreign Origin returned 403.

Follow-up artifacts live in `web/qa/out/vision-evaluation-20261002/followup/`:
`comparison.html`, `summary.json`, `hybrid-fresh-validation.json`, raw direct
provider responses, crop inputs and refinement outputs. The original report and
its outcomes below are preserved.

## Google, Moondream and refinement follow-up

| Approach | Image 1 | Image 2 wrong squares |
|---|---|---:|
| Fenify fixed 12-view averaging | 0 occupancy errors | 2 |
| Three-model hybrid | 0 occupancy errors | **0** |
| Gemini 3.1 Flash Lite, whole photo | 7 occupancy errors | 33 |
| Gemini 3.1 Flash Lite + Fenify occupancy | 0 occupancy errors | 10 |
| Gemini 3 Flash Preview, whole photo | HTTP 503 | 14 |
| Gemini 3 Flash Preview + Fenify occupancy | HTTP 503 | 6 |
| Gemini 3.1 Flash Lite, manually located crop sheets | One batch 503; incomplete | 4 |
| Moondream 3.1 / 3 Preview, whole photo and occupancy prompts | No valid board | No valid board |

Twenty Google direct requests produced six valid predictions and fourteen HTTP
errors. The free project was verified in AI Studio. Gemini 3.8/3.7 Flash returned
capacity errors; 2.5 Flash returned model-unavailable errors. Eight additional
crop-sheet requests used manually marked board corners; seven succeeded and one
returned 503. Manual geometry must not be presented as automatic recognition.

Moondream used an existing account with $5 in included credits and auto top-up
disabled. No credits were purchased. Both cloud models were tested with whole
photos and Fenify-supplied occupancy (eight responses, none a valid board).
Further tests used two simple reasoning-enabled FEN requests, two caption sanity
checks, two native detection calls and 59 individual-piece crop calls. Native
detection returned 14 and 26 boxes, versus 27 and 32 occupied squares. Only 21/27
and 22/32 crop answers unambiguously supplied both color and type under the fixed
parser; several accepted answers were visibly wrong. Neither crop sequence
produced a complete board. Ambiguous colors were not silently repaired.

`direct_vision.py`, `moondream_focused.py` and `gemini_crops.py` accept keys through
hidden terminal input. Credentials are never saved in scripts or artifacts.
`refine_fenify.py` records the fixed augmentation and voting rules. A separate
32-piece inventory constraint made image 2 worse (five errors); its diagnostic
output is retained and the rule is not used in the prototype.

The older local Moondream2 weights were downloaded as a fallback, but were not
run; no quality claim is made for that model. Cloud results above refer to the
explicit 3.1 and 3 Preview model IDs.

Primary provider references: [Moondream API](https://docs.moondream.ai/api/),
[Moondream reasoning](https://docs.moondream.ai/reasoning/),
[Google free-tier pricing](https://ai.google.dev/gemini-api/docs/pricing).

## Original evaluation (preserved)

At the end of the initial round, no tested replacement reliably solved both
supplied examples. No prototype integration had been made at that point.

The referenced Codex chat could not be read through the chat tool. Its local
`web/qa/out/accuracy-investigation/` artifacts preserved the previous findings and
both original JPEGs embedded in `model-comparison.html`. The temporary upload
paths had disappeared. The recovered image dimensions match the earlier report.

## Results

| Specialized model | Image 1: occupied/empty errors | Image 2: wrong squares |
|---|---:|---:|
| Fenify-3D, reproduced | 0 | 4 |
| ChessQ Lite V4, newer release | 23 | 3 |
| ChessQueries ViT-L | 24 | 2 |
| ChessQueries ViT-B | 27 | 10 |
| ChessCog, modern runtime compatibility adjustments | Board not located | 26 |
| Deployed ChessQueries Lite INT8, previous reference run | 25 | 16 |
| ChessReD ResNeXt, previous run | 28 | 39 |

**Image 1 has no verified full piece-type labels.** Zero occupancy errors does
not mean the board was correctly transcribed. Image 2 uses the previous manual
piece-placement reference, visually rechecked in this evaluation:

`r2q1rk1/pbp2pbp/1pn1pnp1/3p4/4P3/1PNP1NP1/PBP2PBP/R2Q1RK1`

ViT-L's image-2 errors were a nonexistent white pawn at c4 and a white bishop
instead of a pawn at c2. V4's errors were an extra pawn at c4, extra knight at
f4, and bishop instead of pawn at d3. Fenify's four were a7, g7, h7, h2.

Eight general-purpose, zero-token-price vision endpoints were attempted on
both images. The live catalog was saved. There were 38 total requests across
explicitly recorded protocol changes, not 38 independent accuracy trials:

- **Inkling / Inkling Small:** both requests per endpoint rejected with 403;
  the free tier requires an approved agentic harness. No recognition score.
- **Qwen3.8 27B:** shared upstream rate limits on three attempts and output-budget
  exhaustion without a visible board on one. No valid prediction.
- **Gemma 4 26B A4B / Gemma 4 31B:** shared upstream rate limits on all four
  attempts per model. No recognition score.
- **Nemotron 3 Nano Omni:** one capacity error and three stalled requests.
  Stalled runners were terminated after several minutes. No recognition score.
- **Space Bunny Alpha:** ten attempts across FEN/grid/structured-grid settings;
  two valid boards. Image 1 had 3 occupancy errors; image 2 had 16 wrong squares.
  Remaining responses were empty, malformed, or rejected an unsupported
  reasoning-disable setting. Even JSON-schema requests required local validation.
- **Dots3-Note Preview:** eight attempts; three valid boards. Image 1 occupancy
  errors were 0 with low reasoning and 20 with reasoning disabled. Image 2 had
  33 wrong squares with reasoning disabled. Other attempts exhausted the output
  budget. Correct occupancy did not establish correct piece identities.

Five of the 38 requests produced valid board strings, 13 failed to produce a
valid board, 17 returned HTTP errors, and 3 were cancelled. **All returned cost
fields were zero.** Cancelled requests have no returned usage record. Paid
fallbacks were prevented by a zero maximum prompt/completion price.

## Interpretation

The larger ViT-L and newer V4 help on image 2 but regress sharply relative to
Fenify on image 1. The free LLM endpoints provide no evidence of a reliable
replacement here; rate-limit and access failures must not be treated as measured
recognition quality. A single high average square confidence also does not
establish correctness, as the previous investigation showed.

Keep the scanner decision open. Before choosing or training a replacement,
complete image-1 piece labels and expand the fixed evaluation set across board
styles, camera angles, lighting, occlusion and phone screenshots. Score exact
piece placement as well as correction count, valid-response rate and latency.
These two examples alone cannot validate a general replacement or an ensemble.

## Artifacts and reproduction

Local artifacts are in `web/qa/out/vision-evaluation-20261002/` (Git-ignored):

- `comparison.html`: photo/prediction viewer with error-square overlays and all
  failed attempts; filter by image or valid responses.
- `images/`: recovered JPEGs; image hashes are attached to scored outputs.
- `responses/`: visible API responses, request settings, scores, usage, failures.
- `local-*.json`, `all-results.json`: specialized results and combined records.
- `model-catalog.json`, `manifests/`, `provenance.json`, `environment.txt`:
  catalog snapshot, pinned weight hashes, source revisions and experiment setup.
- `chesscog-compatibility.patch`: NumPy scalar-return and scikit-learn argument
  compatibility changes. Official pickle weights were loaded explicitly with
  `weights_only=False`. This was a modern compatibility run, not the historical
  author's exact pinned environment.

No credentials are embedded in scripts or artifacts. Set `OPENROUTER_API_KEY`
through your environment, then run from the repository root:

```sh
python benchmark/vision_eval/run_openrouter.py
python benchmark/vision_eval/run_openrouter.py --start-trial 2 --reasoning low --max-tokens 16384
python benchmark/vision_eval/run_local.py fenify --label fenify-3D
python benchmark/vision_eval/run_local.py chessqueries --source /path/to/chessqueries --checkpoint /path/to/weights.safetensors --label 'ChessQueries ViT-L'
python benchmark/vision_eval/report.py
```

An existing response file is reused; use a fresh output directory or unused
trial numbers for new API runs. Images must be present under the selected output
directory. Local runners use the fixed default artifact directory. Fresh model
catalogs may differ from this snapshot. The HTTP runner now uses a subprocess
with a hard 240-second deadline because socket timeouts did not bound the three
stalled requests in the original run. This deadline repair was syntax-checked;
no extra paid or free requests were issued to validate it.

Scoring checks cover an exact reference, a single piece-identity error without
an occupancy error, grid-to-FEN conversion, and invalid rank rejection. Local
models used CPU FP32 arithmetic with hash-verified FP16 distribution weights
where applicable; timings exclude model loading and are not production benchmarks.

## Primary sources

- [ChessQueries paper weights and official inference](https://huggingface.co/joelseytre/chessqueries)
- [ChessQ Lite V4 release](https://huggingface.co/joelseytre/chessq-lite)
- [ChessCog official repository](https://github.com/georg-wolflein/chesscog)
- [Fenify-3D official repository](https://github.com/notnil/fenify-3D)
- [Inkling free-endpoint access conditions](https://openrouter.ai/thinkingmachines/inkling:free)
- [OpenRouter live model catalog](https://openrouter.ai/api/v1/models)

ChessQueries/V4 weights use the PolyForm Noncommercial license. Commercial
deployment requires resolving the license separately; this evaluation does not
change those terms.

## Structured visual decoder, October 2 follow-up

The user asked for creative chess priors, per-piece diagnosis, and improvement
beyond the six development photographs. `chess_constraints.py` and
`structured_recognizer.py` implement a new image-only local recognizer:

- Fenify in four input rotations, ChessQ V4 in four rotations, ViT-L once.
- Independent LeYOLO piece and grid detections align model outputs and weight
  architecture-level evidence. Correlated rotations are not separate votes.
- Small object-identity contributions supplement whole-board predictions.
- Joint integer optimization requires one king per color, nonadjacent kings,
  at most 16 pieces and eight pawns per color, and no back-rank pawns. Extra
  queens, rooks, bishops and knights are supported using a promotion budget;
  excess original inventory carries a soft cost, not a fixed starting layout.
- Occupancy is locked where a feasible assignment exists. If not, inference
  relaxes that lock; review signals expose model disagreement. This is not a
  complete legality/reachability solver. Assumes an ordinary complete chess
  position; puzzle setups missing kings need manual editing.
- The selected V4 model's coordinate frame is restored before returning FEN.
  Turn/castling history remain default editor values, not recognition claims.

Actual local API errors on development photos 1–6: **0, 0, 2, 1, 2, 4** versus
Fenify alone **0, 4, 14, 22, 8, 8**. These are **confirmed disagreements**, not
complete accuracy: photo 1 has occupancy-only truth and photos 3/5/6 have some
unverified identities. Fully labeled photo 2 is exact; photo 4 still has Bc7→q.
Inference took 4.2–5.8 seconds locally. No production deployment.

Before scoring new images, decoder v2 was saved and SHA256-frozen in
`chess-priors/freeze.json`. Twenty-four unique CVChess positions were randomly
selected with seed 20261002; no labels enter inference. The frozen decoder
matched 24/24 allowing a whole-board rotation; Fenify 0/24; V4 alone 24/24;
ViT-L 21/24. Five decoder outputs initially had only a frame-rotation error.
The generic inverse-alignment handoff fixes that. Twelve further positions,
with seed 20261003 and disjoint positions, tested the actual API and image resize:
12/12 matched directly, without selecting a rotation from ground truth.

Limit: CVChess is a single benchmark with repeated views/sets. We sampled unique
positions, not independent chess-set designs. V4's training overlap with CVChess
is unverified; these are held out from our decoder development, not a claim
that the pretrained model never saw this data. V4's perfect result means this
batch does not show an incremental constraint benefit over V4. Our six difficult
photos show why V4 alone is insufficient (e.g. Getty occupancy and the tiny image).

Additional experiments retained separately:
- `single_piece_audit.py`: 24 deterministic tight detected-object crops, one
  crop per Gemini Flash Lite request, high thinking/detail, temperature 1.
  10/15 exactly labeled mapped objects matched; nine other identities remain
  unverified. Requests/answers and rate-limit retries retained. No entire-board
  or square coordinates were supplied. This does not support making Gemini
  the primary classifier.
- `appearance_audit.py` + `appearance_refinement.py`: within-photo DINO nearest
  neighbors share type evidence at cosine > .88. No gain on five photos and an
  infeasible occupancy-locked board on the sixth. Not integrated.
- `rfdetr_audit.py`: the Reddit practitioner's RF-DETR Small checkpoint ran on
  all six photos; detected 21/27/19/12/26/23 objects versus 27/32/32/11/20/27
  reference occupancy. Retained object overlays; not integrated.

Visual review: http://127.0.0.1:8767/chess-priors/
Local existing UI: http://127.0.0.1:8768/?scanner=structured
Run: `/tmp/chess-vision-eval-venv/bin/python benchmark/vision_eval/serve_structured.py`.
This uses existing experimental weights/source in `/tmp/chess-vision-weights`
and `/tmp/chess-vision-chessqueries`; model paths can be passed as CLI arguments.
Eight focused geometry/constraint tests pass, including promotions, occupancy,
nonadjacent kings and inverse orientation. Actual upload API also tested on all
six supplied photos and twelve additional positions.

Research directly informing this experiment:
- Practitioner discussion and linked physical-board detector:
  https://www.reddit.com/r/computervision/comments/1j38isb/
  https://github.com/siromermer/Dynamic-Chess-Board-Piece-Extraction
- Restricted-set classification with chess priors, Kuncheva & Constance (2018):
  https://lucykuncheva.co.uk/papers/lkjcprl18.pdf
- ChessQueries implementation and CVChess annotation provenance:
  https://github.com/JSeytre/chessqueries

Third-party restrictions remain: ChessQueries code/weights are noncommercial;
LeYOLO preprocessing derives from AGPL-3.0 CameraChessWeb. This is a local
research prototype, not approval to commercially deploy those dependencies.

A fairness check also fed Fenify automatically cropped boards on the ten held-out
images where the lattice detector succeeded. It still matched 0/10 boards;
per-image errors are retained in `chess-priors/fenify-auto-crop-check.json`.
The other fourteen lattice failures were not silently excluded from the main
24-board test: the new recognizer used its documented V4/constraint fallback.
The twelve additional API tests gave Fenify 0/12 exact even after best rotation.

Browser verification uploaded the angled wooden photograph through the actual
Photos control and read all 64 editor square attributes: they match the full
manual reference. The comparison gallery loads its images, tab controls work,
and its browser console reports no errors.

Single-piece detail ablation: repeated the same 24 crops enlarged to 512px
(Lanczos, no invented detail), retaining the same prompt/model/settings. All 24
received answers; 10/15 exactly labeled mapped objects matched, the same total
as native crops (23 answers, one timeout). Enlargement changed individual
answers in both directions. `upscaled_piece_audit.py` and
`chess-priors/upscaled-single-summary.json` preserve both responses. This isolates
native crop size as insufficient to explain Gemini's errors; it does not prove
other VLMs or better visual classification cannot help.

Constraint ablation (same frozen visual fusion, only remove joint decoding):
confirmed errors were 0/1/2/1/1/4 versus 0/0/2/1/2/4 with constraints.
Thus the constraints fix the fully labeled angled wooden board but introduce
one additional confirmed error on the tiny partially labeled board. Total
confirmed error is nine either way. **Most of the improvement over Fenify comes
from alignment, per-image model weighting and detector evidence; these tests do
not establish a net accuracy gain from chess constraints alone.** Preserve this
finding rather than attributing the whole 56→9 reduction to chess rules.
Raw ablation: `chess-priors/constraint-ablation.json`.

## New supplied Alamy 3DAG7N3 photo

The unchanged frozen structured recognizer exactly matched the full manually
transcribed 32-piece position in 4.946 seconds. The reference was recorded before
inference. It excluded the two spare pieces on the tabletop. Fenify alone,
rotated only for comparison, made 10 square errors (two spurious occupied
squares), predicting 34 pieces. Raw input hash, complete API responses, manual
reference, score details and visual output are saved in
`web/qa/out/vision-evaluation-20261002/new-image-7/`. The decoder SHA256 still
matches the frozen version; this photo caused no inference-code changes.

Visual comparison: http://127.0.0.1:8767/new-image-7/
