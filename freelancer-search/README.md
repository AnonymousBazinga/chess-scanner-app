# Talent Scout: AI-ranked freelancer search

An Upwork-style freelancer search where the list is sorted by how closely each person's **actual past
work** matches your project, not by keyword hits or platform promotion. You describe the project in a
chat (or paste a whole job post), and a full results list on the right re-sorts as you refine:
"Add Scrapy", "More from Spain", "Higher job success".

Data comes from the free, public [Freelancer.com API](https://developers.freelancer.com) (no key needed).
Ranking uses Claude when `ANTHROPIC_API_KEY` is set, and falls back to keyword matching otherwise.

## How a search works

```
chat message ──► planner ──► spec: queries · filters · weighted criteria   (shown as editable chips)
                                  │
                                  ▼
                   Freelancer.com directory, one call per query (≤100 each)
                                  │  merge, dedupe, apply rate/rating filters
                                  ▼
                   candidate pool (typically 150–300)  ──► keyword pass, list appears
                                  │
                                  ▼
                   top 80: fetch client reviews (project title + review) and portfolio
                                  │                                        ──► keyword pass on work history
                                  ▼
                   top 40: Claude reads profile + work history, judges each
                   criterion strong / partial / none with quoted evidence  ──► list re-sorts batch by batch
```

- **Planner** (`server/ai.ts`): turns the conversation plus the current spec into an updated spec: 2–5
  directory queries, location/rate/rating filters, a one-paragraph brief, and 3–6 weighted criteria that
  separate a great fit from a generic one (for example "Delivered production ETL in Python" rather than
  "knows Python"). It also suggests follow-up refinements. Each turn edits the spec, so refinements are
  cumulative.
- **Ranker** (`server/ai.ts`): batches of 5 candidates, 8 batches in parallel. The prompt tells Claude
  to treat delivered client work as strong evidence and skill lists as weak (many profiles list 300+
  skills). Score = 80% relevance (weighted criteria + overall fit) + 20% track record (rating shrunk
  toward 4.0 for few reviews, volume, completion rate).
- **Keyword ranking** (`server/keyword.ts`): the same criteria matched against profile text and work
  history, with client reviews weighted above portfolio and self-description. It gives the first
  ordering within a second or two and decides who gets the expensive AI pass.
- **Caching**: directory pages (30 min), work histories (6 h) and Claude's judgments (6 h, keyed by
  brief + criteria) are cached in memory. Edits that leave the brief and criteria alone (filter
  chips, location, rate) reuse the judgments for anyone already scored.

You can edit the spec without chatting: remove a filter or query, click a criterion's bars to cycle
its weight (nice to have → important → must have), or add a criterion. The ☆ button keeps people in a
shortlist (stored in the browser) across searches.

## Running it

Requires Node 22+.

```sh
cd freelancer-search
npm install
cp .env.example .env    # add ANTHROPIC_API_KEY for AI ranking (optional)
npm run dev             # http://localhost:5173 (API on :8787)
```

Production: `npm run build && npm start` serves the built UI and the API on one port (`PORT`, default
8787).

Checks: `npm test` (planner, ranking and filter logic, with Claude stubbed) and `npm run typecheck`.

### Settings (`.env`)

| Variable | Default | |
|---|---|---|
| `ANTHROPIC_API_KEY` | none | Enables Claude planning and ranking. Without it, everything runs on keywords. |
| `CLAUDE_MODEL` | `claude-opus-5-5` | `claude-sonnet-5-5` costs about half as much. |
| `PLAN_EFFORT` / `RANK_EFFORT` | `medium` / `low` | Claude's effort level for each job. |
| `AI_RANK_LIMIT` | `40` | Candidates Claude reviews per search. This is the main cost lever. |
| `ENRICH_LIMIT` | `80` | Candidates whose work history is fetched. |

**Cost**: a fresh search sends roughly 70–80k input tokens and 15–20k output tokens to Claude (planner
plus 8 ranking batches). On Opus 5.5 that is on the order of $0.50–$0.70; this is an estimate from
prompt sizes, not a measurement. Refinements that only change filters mostly hit the cache.

## Limits

- **Freelancer.com, not Upwork.** Upwork's API needs an approved developer application and doesn't offer
  open talent search, so this uses Freelancer.com, whose directory, reviews and portfolios are public.
  Other sources can be added by producing the same `Freelancer` shape (`shared/types.ts`).
- The directory search is keyword based, so the pool depends on the planner's queries. The planner
  writes several synonyms per search to widen it.
- Only the top 80 get their work history read and the top 40 are judged by Claude; the rest stay in the
  list, sorted by keyword match, and you can open their profiles.
- Freelancer.com allows 1,000 API requests a minute per IP. A fresh search uses about 90.
