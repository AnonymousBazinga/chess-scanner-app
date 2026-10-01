# Talent Scout: agentic freelancer search

Upwork-style freelancer search where an AI agent does the part you'd otherwise do by hand: reading
every candidate's past client work and judging whether they have really done your kind of project
before. You describe the job in a chat (or paste the whole job post). The agent searches, screens and
investigates, and the results list on the right is ranked by proven experience in your niche. The
list is the main output: you still browse many candidates, sorted, with the evidence on each card.

Candidates come from the free, public [Freelancer.com API](https://developers.freelancer.com) (no
key needed). The agent runs on the [Pi agent harness](https://github.com/earendil-works/pi)
(`@earendil-works/pi-agent-core`), and every candidate is screened by
[Jev](https://docs.typesafe.ai) (TypeSafe).

## How a search works

```
you ──► agent loop (Pi + GPT-5.5)
          │  set_search_criteria   brief + 3-6 weighted criteria about demonstrated work, plus filters
          │  search_freelancers ×N different phrasings, tool names, adjacent niches, page 2 where useful
          │                        → a pool of a few hundred candidates
          │  screen_candidates     fetch each candidate's client reviews + portfolio, then Jev scores
          │                        every criterion (calibrated probabilities)  → the list sorts live
          │  inspect_freelancer    read the top ~10-15 in full: every client project and review
          │  github_lookup         find and verify their GitHub, read repos and languages
          │  fetch_page            read a site or project they mention
          │  record_assessment     verdict + score + per-criterion evidence  → their card updates
          │  …repeat: search new angles if strong matches are thin, inspect more
          ▼
        short reply naming the standouts, and suggested refinements
```

- **Agent** (`server/agent.ts`, `server/runner.ts`): a Pi `Agent` with the nine tools above. Tool
  calls run in parallel (for example, five profiles inspected at once). Each step streams to the chat
  as an activity log; the model's reasoning summaries appear there too. A message sent while the agent
  works steers it (`agent.steer`) instead of waiting. Rate limits and transient model errors resume the
  same turn with backoff. Anything else ends the turn with a visible error.
- **Jev screening** (`server/jev.ts`): one request per candidate. The state is their profile and
  numbered work history. The questions are one Score per criterion (no evidence → claimed only →
  related work → delivered for clients), a yes/no on "would a recruiter shortlist them", and a Choice
  of their most relevant past project. The score is 85% relevance and 15% track record.
- **Agent verdicts** replace Jev's score for the people it read in depth. Cards say which one you're
  looking at ("Reviewed by the agent" or "Screened by Jev · 82% confident").
- **Context**: every turn resends the conversation, so old tool output is trimmed once it's stale.
  A profile dossier stays in context until the agent has recorded a verdict on that person.

Refining is a conversation. "Add Scrapy" adds a criterion, re-screens and searches for it; "More from
Spain" changes the filter. The standard filters (location, hourly rate, rating, review count) are also
plain controls above the list and apply instantly. Click a criterion's bars to change its weight, or
add or remove criteria; the pool is re-screened by Jev and the agent is told what you changed. The
bookmark keeps people in **Saved** across searches.

## Running it

Requires Node 22+.

```sh
cd freelancer-search
npm install
cp .env.example .env   # fill in the keys
npm run dev            # http://localhost:5173 (API on :8787)
```

Production: `npm run build && npm start` serves the UI and API on one port (`PORT`, default 8787).

Checks: `npm test` (the agent loop on Pi's scripted faux provider with Freelancer.com and Jev stubbed,
retry behaviour, context trimming, Jev scoring) and `npm run typecheck`.

### Settings (`.env`)

| Variable | | |
|---|---|---|
| `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_BASE_URL` | required | The agent's model. |
| `TYPESAFE_API_KEY` | required | Jev screening. |
| `LLM_PROVIDER`, `LLM_MODEL` | `azure-openai-responses`, `gpt-5.5` | Any provider and model Pi supports, e.g. `anthropic` + `claude-opus-5-5` with `ANTHROPIC_API_KEY`. |
| `AGENT_THINKING` | `medium` | Reasoning effort per agent turn. |
| `GITHUB_API_TOKEN` | optional | GitHub allows 60 unauthenticated requests an hour (10 searches a minute). |

Missing required keys show a setup screen. There is no non-AI fallback.

**Time and cost.** A first search takes about 2–3 minutes: a dozen or so model turns, 300–500 Jev
screenings, and 10–20 profiles read in depth. Jev is billed on input tokens only, at about $0.04 per
million, so screening 500 profiles costs a few cents. The agent's model is the main cost. With
GPT-5.5 a first search uses on the order of a few hundred thousand input tokens; check your Azure
pricing. Refinements reuse the pool and cost less.

## Limits

- **Freelancer.com, not Upwork.** Upwork's API needs an approved application and has no open talent
  search. Another source can be added by producing the same `Freelancer` shape (`shared/types.ts`).
- **External profiles.** Freelancer.com strips links from profiles, so "GitHub" in a bio has to be
  looked up by name, and the agent only counts an account once it has matched name, location or
  projects. LinkedIn pages generally can't be fetched without logging in.
- **Rate limits.** Your Azure deployment's tokens-per-minute limit is the usual bottleneck: the agent
  pauses and resumes when it's hit. Freelancer.com allows 1,000 requests a minute; screening fetches
  one review list per candidate.
- Sessions live in server memory and expire after two idle hours.
