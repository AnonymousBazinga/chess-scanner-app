# Hosted structured scanner — 2026-10-02

Status: preview model validation passed; production promotion pending.

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

Production URL and browser verification will be recorded after promotion.
