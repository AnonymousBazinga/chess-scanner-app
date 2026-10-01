// One chat = one session: the candidate pool, Jev's screening results, the agent's assessments,
// the current spec and filters. Every change is broadcast to the browser as a ServerEvent.

import { randomUUID } from "node:crypto";
import { emptyFilters, passesFilters, type Filters, type Freelancer, type Ranking, type ServerEvent, type Spec } from "../shared/types.ts";
import { enrich } from "./freelancer.ts";
import { screen } from "./jev.ts";
import { mapLimit } from "./util.ts";

export class Session {
  readonly id = randomUUID();
  lastActive = Date.now();
  pool = new Map<number, Freelancer>();
  spec: Spec = { brief: "", criteria: [] };
  filters: Filters = emptyFilters();
  suggestions: string[] = [];
  /** Jev results for the current spec. Cleared when the spec changes. */
  screened = new Map<number, Ranking>();
  /** Verdicts the agent recorded after reading a profile. Cleared when the spec changes. */
  assessed = new Map<number, Ranking>();
  private specVersion = 0;
  private listeners = new Set<(e: ServerEvent) => void>();
  private screening: Promise<unknown> = Promise.resolve();

  subscribe(fn: (e: ServerEvent) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  emit(e: ServerEvent) {
    this.lastActive = Date.now();
    for (const fn of this.listeners) fn(e);
  }

  /** Everything a newly connected browser needs to render the current state. */
  snapshot(): ServerEvent[] {
    const all = [...this.pool.values()];
    const work: Record<number, Freelancer["work"]> = {};
    for (const f of all) if (f.enriched) work[f.id] = f.work;
    return [
      { type: "spec", spec: this.spec },
      { type: "filters", filters: this.filters },
      { type: "suggestions", suggestions: this.suggestions },
      { type: "pool", freelancers: all.map((f) => ({ ...f, work: [] })) },
      { type: "work", work },
      { type: "rankings", rankings: Object.fromEntries(all.map((f) => [f.id, this.ranking(f.id)]).filter(([, r]) => r)) },
    ];
  }

  ranking(id: number): Ranking | undefined {
    return this.assessed.get(id) ?? this.screened.get(id);
  }

  /** Candidates that pass the active filters, best first. */
  ranked(): { f: Freelancer; r: Ranking | undefined }[] {
    return [...this.pool.values()]
      .filter((f) => passesFilters(f, this.filters))
      .map((f) => ({ f, r: this.ranking(f.id) }))
      .sort((a, b) => (b.r?.score ?? -1) - (a.r?.score ?? -1));
  }

  addToPool(list: Freelancer[]) {
    const added = list.filter((f) => !this.pool.has(f.id));
    for (const f of added) this.pool.set(f.id, f);
    if (added.length) this.emit({ type: "pool", freelancers: added.map((f) => ({ ...f, work: [] })) });
    return added;
  }

  setSpec(spec: Spec) {
    const changed = JSON.stringify(spec) !== JSON.stringify(this.spec);
    this.spec = spec;
    if (changed) {
      this.specVersion++;
      this.screened.clear();
      this.assessed.clear();
      this.emit({ type: "rankings", rankings: {}, reset: true });
    }
    this.emit({ type: "spec", spec });
    return changed;
  }

  setFilters(filters: Filters) {
    this.filters = filters;
    this.emit({ type: "filters", filters });
  }

  setSuggestions(suggestions: string[]) {
    this.suggestions = suggestions;
    this.emit({ type: "suggestions", suggestions });
  }

  recordAssessment(id: number, ranking: Ranking) {
    this.assessed.set(id, ranking);
    this.emit({ type: "rankings", rankings: { [id]: ranking } });
  }

  setLinks(id: number, links: Freelancer["links"]) {
    const f = this.pool.get(id);
    if (!f) return;
    const merged = [...f.links];
    for (const l of links) if (!merged.some((m) => m.url === l.url)) merged.push(l);
    f.links = merged;
    this.emit({ type: "links", links: { [id]: merged } });
  }

  /** Fetches work history for anyone in `list` who doesn't have it yet. */
  async ensureEnriched(list: Freelancer[]) {
    const todo = list.filter((f) => !f.enriched);
    if (!todo.length) return;
    await enrich(todo);
    this.emit({ type: "work", work: Object.fromEntries(todo.map((f) => [f.id, f.work])) });
  }

  /**
   * Screens every pool member that passes the filters and has no Jev result for the current
   * spec. Runs one job at a time; results stream to the browser in small batches.
   */
  screenPool(onProgress?: (done: number, total: number) => void, signal?: AbortSignal) {
    const job = this.screening.then(() => this.runScreening(onProgress, signal));
    this.screening = job.catch(() => undefined);
    return job;
  }

  private async runScreening(onProgress?: (done: number, total: number) => void, signal?: AbortSignal) {
    const version = this.specVersion;
    const spec = this.spec;
    const todo = [...this.pool.values()].filter((f) => passesFilters(f, this.filters) && !this.screened.has(f.id));
    const failures: { id: number; error: string }[] = [];
    if (!todo.length || !spec.criteria.length) return { screened: 0, failures };

    await this.ensureEnriched(todo);
    let done = 0;
    let batch: Record<number, Ranking> = {};
    let lastFlush = Date.now();
    const flush = () => {
      if (Object.keys(batch).length && version === this.specVersion) this.emit({ type: "rankings", rankings: batch });
      batch = {};
      lastFlush = Date.now();
    };
    await mapLimit(todo, 16, async (f) => {
      if (signal?.aborted || version !== this.specVersion) return;
      try {
        const r = await screen(spec, f, signal);
        if (version !== this.specVersion) return;
        this.screened.set(f.id, r);
        if (!this.assessed.has(f.id)) batch[f.id] = r;
      } catch (err) {
        if (signal?.aborted) return;
        const error = (err as Error).message;
        failures.push({ id: f.id, error });
        const r: Ranking = { score: 0, source: "jev", verdict: null, summary: "", criteria: [], highlights: [], confidence: null, error };
        if (version === this.specVersion) batch[f.id] = r;
      }
      onProgress?.(++done, todo.length);
      if (Date.now() - lastFlush > 400) flush();
    });
    flush();
    return { screened: done - failures.length, failures };
  }

  newTurnId() {
    return randomUUID().slice(0, 8);
  }
}

const sessions = new Map<string, Session>();

export function createSession() {
  const s = new Session();
  sessions.set(s.id, s);
  return s;
}

export function getSession(id: string) {
  return sessions.get(id);
}

export function dropSession(id: string) {
  sessions.delete(id);
}

// Forget sessions nobody has touched for two hours.
setInterval(() => {
  for (const [id, s] of sessions) if (Date.now() - s.lastActive > 2 * 60 * 60_000) sessions.delete(id);
}, 10 * 60_000).unref();
