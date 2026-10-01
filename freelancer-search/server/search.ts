// The search pipeline: plan -> retrieve a broad candidate pool -> fetch work history for the
// most promising -> rank. Results stream to the browser as each stage finishes, so the list
// is usable within a second or two and re-sorts as Claude's judgments arrive.

import { createHash } from "node:crypto";
import type { Freelancer, Ranking, SearchEvent, SearchRequest, SearchSpec } from "../shared/types.ts";
import { aiEnabled, aiPlan, aiRank } from "./ai.ts";
import { enrich, searchDirectory } from "./freelancer.ts";
import { keywordPlan, keywordRank } from "./keyword.ts";
import { TtlCache, mapLimit } from "./util.ts";

const PER_QUERY = 100;
const ENRICH_LIMIT = Number(process.env.ENRICH_LIMIT ?? 80);
const AI_RANK_LIMIT = Number(process.env.AI_RANK_LIMIT ?? 40);
const AI_BATCH = 5;
const AI_CONCURRENCY = 8;

const rankCache = new TtlCache<Ranking>(6 * 60 * 60_000, 20_000);

function specKey(spec: SearchSpec) {
  const material = JSON.stringify([spec.brief, spec.criteria.map((c) => [c.id, c.label, c.description, c.weight])]);
  return createHash("sha1").update(material).digest("hex").slice(0, 16);
}

export function passesFilters(f: Freelancer, spec: SearchSpec) {
  const { minRating, minReviews, minRate, maxRate } = spec.filters;
  if (minRating != null && (f.rating ?? 0) < minRating) return false;
  if (minReviews != null && f.reviews < minReviews) return false;
  if (minRate != null && (f.hourlyRate == null || f.hourlyRate < minRate)) return false;
  if (maxRate != null && (f.hourlyRate == null || f.hourlyRate > maxRate)) return false;
  return true;
}

function withoutWork(f: Freelancer): Freelancer {
  return { ...f, work: [] };
}

export async function runSearch(req: SearchRequest, emit: (e: SearchEvent) => void, signal: AbortSignal) {
  const ai = aiEnabled();
  let spec = req.spec;

  if (req.replan) {
    const last = [...req.messages].reverse().find((m) => m.role === "user");
    if (!last) throw new Error("No message to plan from.");
    emit({ type: "status", stage: "planning", message: ai ? "Reading your request…" : "Parsing your request…" });
    let planned: { spec: SearchSpec; reply: string; suggestions: string[] };
    if (ai) {
      try {
        planned = await aiPlan(req.messages, spec);
      } catch (err) {
        console.error("planner failed:", err);
        planned = keywordPlan(last.content, spec);
        planned.reply = `Claude couldn't plan this search (${(err as Error).message}), so I fell back to keywords. ${planned.reply}`;
      }
    } else {
      planned = keywordPlan(last.content, spec);
    }
    spec = planned.spec;
    emit({ type: "plan", spec, reply: planned.reply, suggestions: planned.suggestions, ai });
  }
  if (!spec || (!spec.queries.length && !spec.criteria.length)) {
    emit({ type: "pool", freelancers: [], totalMatches: 0 });
    emit({ type: "status", stage: "done", message: "Describe who you're looking for to start." });
    return;
  }
  if (signal.aborted) return;

  // 1. Retrieval: every query against the directory, merged. Freelancers matched by several
  //    queries are more likely on target, which the keyword pass uses as a tie-breaker.
  const queries = spec.queries.length ? spec.queries : spec.criteria.slice(0, 3).map((c) => c.label);
  emit({ type: "status", stage: "retrieving", message: `Searching Freelancer.com for ${queries.map((q) => `"${q}"`).join(", ")}…` });
  const pages = await Promise.all(
    queries.map((q) =>
      searchDirectory(q, spec.filters, PER_QUERY).catch((err: Error) => {
        console.error(`directory query "${q}" failed:`, err.message);
        return null;
      }),
    ),
  );
  if (pages.every((p) => p === null)) throw new Error("Freelancer.com didn't respond. Try again in a moment.");
  const pool = new Map<number, Freelancer>();
  const queryHits = new Map<number, number>();
  for (const page of pages) {
    for (const f of page?.users ?? []) {
      if (!passesFilters(f, spec)) continue;
      if (!pool.has(f.id)) pool.set(f.id, f);
      queryHits.set(f.id, (queryHits.get(f.id) ?? 0) + 1);
    }
  }
  const totalMatches = Math.max(0, ...pages.map((p) => p?.total ?? 0));
  const candidates = [...pool.values()];
  emit({ type: "pool", freelancers: candidates.map(withoutWork), totalMatches });
  if (!candidates.length) {
    emit({ type: "status", stage: "done", message: "No freelancers matched. Try loosening the location or rate filters." });
    return;
  }

  const rankings = new Map<number, Ranking>();
  const keywordPass = (list: Freelancer[]) => {
    const out: Record<number, Ranking> = {};
    for (const f of list) {
      const r = keywordRank(f, spec);
      r.score = Math.min(100, r.score + 2 * ((queryHits.get(f.id) ?? 1) - 1));
      rankings.set(f.id, r);
      out[f.id] = r;
    }
    emit({ type: "rankings", rankings: out });
  };
  keywordPass(candidates);
  if (signal.aborted) return;

  // 2. Work history for the most promising candidates (cached, so refinements are fast).
  const byScore = () => [...candidates].sort((a, b) => rankings.get(b.id)!.score - rankings.get(a.id)!.score);
  const toEnrich = byScore().slice(0, ENRICH_LIMIT);
  emit({ type: "status", stage: "enriching", message: `Reading past client work for the top ${toEnrich.length} of ${candidates.length}…` });
  await enrich(toEnrich);
  if (signal.aborted) return;
  const work: Record<number, Freelancer["work"]> = {};
  for (const f of toEnrich) work[f.id] = f.work;
  emit({ type: "work", work });
  keywordPass(toEnrich);

  if (!ai || !spec.criteria.length) {
    emit({ type: "status", stage: "done", message: `Ranked ${candidates.length} freelancers by keyword match to past work.` });
    return;
  }

  // 3. Claude reads the top candidates' profiles and work history against the criteria.
  const toRank = byScore()
    .filter((f) => f.enriched)
    .slice(0, AI_RANK_LIMIT);
  const key = specKey(spec);
  const cached: Record<number, Ranking> = {};
  const pending: Freelancer[] = [];
  for (const f of toRank) {
    const hit = rankCache.get(`${key}:${f.id}`);
    if (hit) cached[f.id] = hit;
    else pending.push(f);
  }
  if (Object.keys(cached).length) emit({ type: "rankings", rankings: cached });

  let done = toRank.length - pending.length;
  let failures = 0;
  const progress = () =>
    emit({ type: "status", stage: "ranking", message: `Claude is reviewing work histories… ${done}/${toRank.length}` });
  progress();
  const batches: Freelancer[][] = [];
  for (let i = 0; i < pending.length; i += AI_BATCH) batches.push(pending.slice(i, i + AI_BATCH));
  await mapLimit(batches, AI_CONCURRENCY, async (batch) => {
    if (signal.aborted) return;
    try {
      const scored = await aiRank(spec, batch);
      const out: Record<number, Ranking> = {};
      for (const [id, r] of scored) {
        rankCache.set(`${key}:${id}`, r);
        out[id] = r;
      }
      if (!signal.aborted) emit({ type: "rankings", rankings: out });
    } catch (err) {
      failures++;
      console.error("ranking batch failed:", err);
    }
    done += batch.length;
    if (!signal.aborted) progress();
  });
  if (signal.aborted) return;

  const note = failures ? ` (${failures} batch${failures > 1 ? "es" : ""} failed and kept keyword scores)` : "";
  emit({
    type: "status",
    stage: "done",
    message: `Claude ranked the top ${toRank.length} of ${candidates.length} freelancers${note}.`,
  });
}
