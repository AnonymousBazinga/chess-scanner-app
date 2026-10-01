import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { criterionFrom } from "../shared/criteria.ts";
import type { ChatMessage, Freelancer, Ranking, SearchEvent, SearchSpec } from "../shared/types.ts";
import { fetchConfig, streamSearch } from "./api.ts";
import ChatPanel, { type ChatItem } from "./components/ChatPanel.tsx";
import ResultCard from "./components/ResultCard.tsx";
import SpecBar from "./components/SpecBar.tsx";

type Sort = "best" | "rating" | "reviews" | "rate-asc" | "rate-desc";
type Status = { stage: string; message: string } | null;
interface Saved {
  freelancer: Freelancer;
  ranking: Ranking | null;
}

const PAGE = 30;

function loadShortlist(): Record<number, Saved> {
  try {
    return JSON.parse(localStorage.getItem("shortlist") ?? "{}");
  } catch {
    return {};
  }
}

export default function App() {
  const [config, setConfig] = useState<{ ai: boolean; model: string | null } | null>(null);
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [spec, setSpec] = useState<SearchSpec | null>(null);
  const [freelancers, setFreelancers] = useState<Record<number, Freelancer>>({});
  const [rankings, setRankings] = useState<Record<number, Ranking>>({});
  const [totalMatches, setTotalMatches] = useState(0);
  const [status, setStatus] = useState<Status>(null);
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [sort, setSort] = useState<Sort>("best");
  const [view, setView] = useState<"all" | "shortlist">("all");
  const [shown, setShown] = useState(PAGE);
  const [shortlist, setShortlist] = useState<Record<number, Saved>>(loadShortlist);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    fetchConfig().then(setConfig).catch(() => setConfig({ ai: false, model: null }));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("shortlist", JSON.stringify(shortlist));
    } catch {
      // Storage can be unavailable (private mode); the shortlist then lasts for the session.
    }
  }, [shortlist]);

  const run = useCallback(async (messages: ChatMessage[], current: SearchSpec | null, replan: boolean) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setBusy(true);
    setView("all");
    setShown(PAGE);
    const onEvent = (e: SearchEvent) => {
      switch (e.type) {
        case "plan":
          setSpec(e.spec);
          setSuggestions(e.suggestions);
          setChat((c) => [...c, { role: "assistant", content: e.reply }]);
          break;
        case "status":
          setStatus({ stage: e.stage, message: e.message });
          break;
        case "pool":
          setFreelancers(Object.fromEntries(e.freelancers.map((f) => [f.id, f])));
          setRankings({});
          setTotalMatches(e.totalMatches);
          break;
        case "work":
          setFreelancers((prev) => {
            const next = { ...prev };
            for (const [id, work] of Object.entries(e.work)) {
              const f = next[Number(id)];
              if (f) next[Number(id)] = { ...f, work, enriched: true };
            }
            return next;
          });
          break;
        case "rankings":
          setRankings((prev) => {
            const next = { ...prev };
            // A keyword score never overwrites Claude's judgment of the same candidate.
            for (const [id, r] of Object.entries(e.rankings)) {
              if (r.method === "ai" || next[Number(id)]?.method !== "ai") next[Number(id)] = r;
            }
            return next;
          });
          break;
        case "error":
          setChat((c) => [...c, { role: "assistant", content: e.message, kind: "error" }]);
          setStatus(null);
          break;
      }
    };
    try {
      await streamSearch({ messages, spec: current, replan }, onEvent, controller.signal);
    } catch (err) {
      if (!controller.signal.aborted) {
        setChat((c) => [...c, { role: "assistant", content: (err as Error).message, kind: "error" }]);
      }
    } finally {
      if (abortRef.current === controller) setBusy(false);
    }
  }, []);

  const send = (text: string) => {
    const next: ChatItem[] = [...chat, { role: "user", content: text }];
    setChat(next);
    const transcript = next.filter((m) => m.kind === undefined).map(({ role, content }) => ({ role, content }));
    run(transcript, spec, true);
  };

  const editSpec = (next: SearchSpec, note: string) => {
    setSpec(next);
    setChat((c) => [...c, { role: "assistant", content: note, kind: "note" }]);
    const transcript = chat.filter((m) => m.kind === undefined).map(({ role, content }) => ({ role, content }));
    run(transcript, next, false);
  };

  const results = useMemo(() => {
    const list =
      view === "shortlist"
        ? Object.values(shortlist).map((s) => ({ f: freelancers[s.freelancer.id] ?? s.freelancer, r: rankings[s.freelancer.id] ?? s.ranking }))
        : Object.values(freelancers).map((f) => ({ f, r: rankings[f.id] ?? null }));
    const score = (x: { r: Ranking | null }) => (x.r ? x.r.score + (x.r.method === "ai" ? 1000 : 0) : -1);
    const by: Record<Sort, (a: (typeof list)[0], b: (typeof list)[0]) => number> = {
      best: (a, b) => score(b) - score(a),
      rating: (a, b) => (b.f.rating ?? 0) * Math.min(b.f.reviews, 20) - (a.f.rating ?? 0) * Math.min(a.f.reviews, 20),
      reviews: (a, b) => b.f.reviews - a.f.reviews,
      "rate-asc": (a, b) => (a.f.hourlyRate ?? 1e9) - (b.f.hourlyRate ?? 1e9),
      "rate-desc": (a, b) => (b.f.hourlyRate ?? 0) - (a.f.hourlyRate ?? 0),
    };
    return list.sort(by[sort]);
  }, [freelancers, rankings, shortlist, sort, view]);

  const poolSize = Object.keys(freelancers).length;
  const toggleShortlist = (f: Freelancer, r: Ranking | null) =>
    setShortlist((s) => {
      const next = { ...s };
      if (next[f.id]) delete next[f.id];
      else next[f.id] = { freelancer: f, ranking: r };
      return next;
    });

  return (
    <div className="app">
      <ChatPanel
        chat={chat}
        busy={busy}
        suggestions={suggestions}
        ai={config?.ai ?? null}
        model={config?.model ?? null}
        onSend={send}
      />
      <main className="results">
        <header className="results-head">
          <div className="title-row">
            <h1>Talent results</h1>
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={view === "all"} className={view === "all" ? "on" : ""} onClick={() => setView("all")}>
                All {poolSize ? <span className="count">{poolSize}</span> : null}
              </button>
              <button role="tab" aria-selected={view === "shortlist"} className={view === "shortlist" ? "on" : ""} onClick={() => setView("shortlist")}>
                Shortlist {Object.keys(shortlist).length ? <span className="count">{Object.keys(shortlist).length}</span> : null}
              </button>
            </div>
          </div>
          {spec && <SpecBar spec={spec} onChange={editSpec} makeCriterion={criterionFrom} />}
          {(poolSize > 0 || status) && view === "all" && (
            <div className="meta-row">
              <p className="status" aria-live="polite">
                {busy && <span className="spinner" aria-hidden />}
                {status?.message ??
                  `${poolSize} candidates from ${totalMatches.toLocaleString()} matches on Freelancer.com`}
              </p>
              <label className="sort">
                Sort
                <select value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
                  <option value="best">Best match</option>
                  <option value="rating">Top rated</option>
                  <option value="reviews">Most reviews</option>
                  <option value="rate-asc">Rate: low to high</option>
                  <option value="rate-desc">Rate: high to low</option>
                </select>
              </label>
            </div>
          )}
        </header>

        {results.length === 0 ? (
          view === "shortlist" ? (
            <div className="empty">
              <h2>No one shortlisted yet</h2>
              <p>Use the ☆ on a result to keep them here across searches.</p>
            </div>
          ) : busy ? (
            <div className="skeletons">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="card skeleton" />
              ))}
            </div>
          ) : (
            <Welcome onPick={send} hasSpec={spec !== null} />
          )
        ) : (
          <ol className="list">
            {results.slice(0, shown).map(({ f, r }, i) => (
              <ResultCard
                key={f.id}
                rank={i + 1}
                freelancer={f}
                ranking={r}
                criteria={spec?.criteria ?? []}
                shortlisted={Boolean(shortlist[f.id])}
                onToggleShortlist={() => toggleShortlist(f, r)}
              />
            ))}
          </ol>
        )}
        {results.length > shown && (
          <button className="more" onClick={() => setShown((n) => n + PAGE)}>
            Show {Math.min(PAGE, results.length - shown)} more of {results.length - shown}
          </button>
        )}
      </main>
    </div>
  );
}

const EXAMPLES = [
  "Python data engineer in Europe, under $70/hr, with ETL expertise",
  "Shopify developer who has migrated stores from WooCommerce",
  "React Native developer with published fintech apps, Latin America",
  "Scraping expert who has dealt with Cloudflare and anti-bot protection",
];

function Welcome({ onPick, hasSpec }: { onPick: (t: string) => void; hasSpec: boolean }) {
  if (hasSpec) {
    return (
      <div className="empty">
        <h2>No freelancers matched</h2>
        <p>Try loosening the location, rate or rating filters above, or ask for something broader.</p>
      </div>
    );
  }
  return (
    <div className="welcome">
      <h2>Find people who have done your kind of work before</h2>
      <p>
        Describe your project or paste a job post. Search pulls a few hundred candidates from Freelancer.com, reads their
        past client reviews and portfolios, and ranks everyone by how closely their work history matches your needs.
        Refine in chat and the list re-sorts.
      </p>
      <div className="examples">
        {EXAMPLES.map((e) => (
          <button key={e} onClick={() => onPick(e)}>
            {e}
          </button>
        ))}
      </div>
    </div>
  );
}
