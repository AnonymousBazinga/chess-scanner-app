import { ArrowDownWideNarrow, ChevronDown, PanelLeftOpen, Search } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emptyFilters, passesFilters, type AppConfig, type Filters, type Freelancer, type Ranking, type ServerEvent, type Spec } from "../shared/types.ts";
import { api } from "./api.ts";
import ChatPanel, { type AgentTurn, type Turn } from "./components/ChatPanel.tsx";
import FilterBar from "./components/FilterBar.tsx";
import Popover from "./components/Popover.tsx";
import ResultCard from "./components/ResultCard.tsx";

type Sort = "best" | "rating" | "reviews" | "rate-asc" | "rate-desc";
const SORTS: Record<Sort, string> = {
  best: "Best match",
  rating: "Top rated",
  reviews: "Most reviews",
  "rate-asc": "Lowest rate",
  "rate-desc": "Highest rate",
};
const PAGE = 25;

interface Saved {
  freelancer: Freelancer;
  ranking: Ranking | null;
}

function loadSaved(): Record<number, Saved> {
  try {
    return JSON.parse(localStorage.getItem("talent-scout:saved") ?? "{}");
  } catch {
    return {};
  }
}

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configError, setConfigError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [spec, setSpec] = useState<Spec>({ brief: "", criteria: [] });
  const [filters, setFilters] = useState<Filters>(emptyFilters());
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [freelancers, setFreelancers] = useState<Record<number, Freelancer>>({});
  const [rankings, setRankings] = useState<Record<number, Ranking>>({});
  const [sort, setSort] = useState<Sort>("best");
  const [view, setView] = useState<"all" | "saved">("all");
  const [shown, setShown] = useState(PAGE);
  const [saved, setSaved] = useState<Record<number, Saved>>(loadSaved);
  const [chatOpen, setChatOpen] = useState(true);
  /** Between sending a message and the agent picking it up. */
  const [waiting, setWaiting] = useState(false);
  /** Edits made in the UI since the last message, so the agent hears about them. */
  const pendingNotes = useRef<string[]>([]);

  useEffect(() => {
    api.config().then(setConfig).catch((e) => setConfigError(e.message));
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem("talent-scout:saved", JSON.stringify(saved));
    } catch {
      // Storage unavailable (private mode): saved profiles last for this visit only.
    }
  }, [saved]);

  const updateTurn = (turnId: string, fn: (t: AgentTurn) => AgentTurn) =>
    setTurns((ts) => ts.map((t) => (t.kind === "agent" && t.turnId === turnId ? fn(t) : t)));

  const onEvent = useCallback((e: ServerEvent) => {
    switch (e.type) {
      case "turn_start":
        setWaiting(false);
        setTurns((ts) => [...ts, { kind: "agent", turnId: e.turnId, activities: [], draft: "", text: "", startedAt: Date.now(), endedAt: null, error: null }]);
        break;
      case "activity":
        updateTurn(e.turnId, (t) => {
          const i = t.activities.findIndex((a) => a.id === e.activity.id);
          const activities = i === -1 ? [...t.activities, e.activity] : t.activities.map((a, j) => (j === i ? e.activity : a));
          return { ...t, activities };
        });
        break;
      case "reply_delta":
        updateTurn(e.turnId, (t) => ({ ...t, draft: t.draft + e.text }));
        break;
      case "draft_to_note":
        updateTurn(e.turnId, (t) =>
          t.draft.trim() ? { ...t, draft: "", activities: [...t.activities, { id: `note-${t.activities.length}`, kind: "note", label: t.draft.trim(), state: "done" }] } : t,
        );
        break;
      case "turn_end":
        setWaiting(false);
        updateTurn(e.turnId, (t) => ({ ...t, text: t.draft, draft: "", endedAt: Date.now(), error: e.error ?? null }));
        break;
      case "spec":
        setSpec(e.spec);
        break;
      case "filters":
        setFilters(e.filters);
        break;
      case "suggestions":
        setSuggestions(e.suggestions);
        break;
      case "pool":
        setFreelancers((prev) => ({ ...prev, ...Object.fromEntries(e.freelancers.map((f) => [f.id, f])) }));
        break;
      case "work":
        setFreelancers((prev) => {
          const next = { ...prev };
          for (const [id, work] of Object.entries(e.work)) if (next[+id]) next[+id] = { ...next[+id], work, enriched: true };
          return next;
        });
        break;
      case "links":
        setFreelancers((prev) => {
          const next = { ...prev };
          for (const [id, links] of Object.entries(e.links)) if (next[+id]) next[+id] = { ...next[+id], links };
          return next;
        });
        break;
      case "rankings":
        setRankings((prev) => (e.reset ? { ...e.rankings } : { ...prev, ...e.rankings }));
        break;
    }
  }, []);

  const startSession = useCallback(async () => {
    const { id } = await api.createSession();
    setSessionId(id);
    return id;
  }, []);

  useEffect(() => {
    if (config?.ready && !sessionId) startSession().catch((e) => setConfigError(e.message));
  }, [config, sessionId, startSession]);

  useEffect(() => {
    if (!sessionId) return;
    return api.events(sessionId, onEvent, () => {});
  }, [sessionId, onEvent]);

  const running = turns.some((t) => t.kind === "agent" && t.endedAt === null);
  const busy = running || waiting;

  const send = async (text: string) => {
    if (!sessionId) return;
    const notes = pendingNotes.current;
    pendingNotes.current = [];
    setTurns((ts) => [...ts, { kind: "user", text, at: Date.now() }]);
    if (!running) setWaiting(true);
    setSuggestions([]);
    setView("all");
    const message = notes.length ? `[Since my last message I changed in the interface: ${notes.join(" ")}]\n${text}` : text;
    try {
      await api.send(sessionId, message);
    } catch (err) {
      setWaiting(false);
      setTurns((ts) => [...ts, { kind: "agent", turnId: `err-${Date.now()}`, activities: [], draft: "", text: "", startedAt: Date.now(), endedAt: Date.now(), error: (err as Error).message }]);
    }
  };

  const newChat = async () => {
    if (sessionId && busy) await api.abort(sessionId).catch(() => {});
    setTurns([]);
    setSpec({ brief: "", criteria: [] });
    setFilters(emptyFilters());
    setSuggestions([]);
    setFreelancers({});
    setRankings({});
    pendingNotes.current = [];
    setSessionId(null);
  };

  const changeFilters = (f: Filters, note: string) => {
    setFilters(f);
    setShown(PAGE);
    pendingNotes.current.push(note);
    if (sessionId) api.setFilters(sessionId, f).catch(() => {});
  };

  const changeSpec = (s: Spec, note: string) => {
    setSpec(s);
    pendingNotes.current.push(note);
    if (sessionId) api.setSpec(sessionId, s).catch(() => {});
  };

  const all = Object.values(freelancers);
  const results = useMemo(() => {
    const list =
      view === "saved"
        ? Object.values(saved).map((s) => ({ f: freelancers[s.freelancer.id] ?? s.freelancer, r: rankings[s.freelancer.id] ?? s.ranking }))
        : all.filter((f) => passesFilters(f, filters)).map((f) => ({ f, r: rankings[f.id] ?? null }));
    const score = (r: Ranking | null) => (r && !r.error ? r.score : -1);
    const by: Record<Sort, (a: (typeof list)[0], b: (typeof list)[0]) => number> = {
      best: (a, b) => score(b.r) - score(a.r),
      rating: (a, b) => (b.f.rating ?? 0) * Math.min(b.f.reviews, 20) - (a.f.rating ?? 0) * Math.min(a.f.reviews, 20),
      reviews: (a, b) => b.f.reviews - a.f.reviews,
      "rate-asc": (a, b) => (a.f.hourlyRate ?? 1e9) - (b.f.hourlyRate ?? 1e9),
      "rate-desc": (a, b) => (b.f.hourlyRate ?? 0) - (a.f.hourlyRate ?? 0),
    };
    return list.sort(by[sort]);
    // `all` is derived from `freelancers`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [freelancers, rankings, saved, sort, view, filters]);

  const screenedCount = results.filter(({ r }) => r && !r.error).length;
  const reviewedCount = results.filter(({ r }) => r?.source === "agent").length;
  const title = turns.find((t) => t.kind === "user")?.text ?? "New search";

  if (configError) return <Setup missing={[configError]} />;
  if (config && !config.ready) return <Setup missing={config.missing} />;

  return (
    <div className={`app ${chatOpen ? "" : "chat-hidden"}`}>
      {chatOpen ? (
        <ChatPanel
          turns={turns}
          busy={busy}
          suggestions={suggestions}
          model={config?.model ?? "…"}
          title={title}
          onSend={send}
          onStop={() => sessionId && api.abort(sessionId)}
          onNewChat={newChat}
          onCollapse={() => setChatOpen(false)}
        />
      ) : (
        <button className="chat-fab" onClick={() => setChatOpen(true)} aria-label="Show chat">
          <PanelLeftOpen size={18} /> Chat
        </button>
      )}

      <main className="results">
        <header className="results-head">
          <div className="title-row">
            <div>
              <h1>Talent</h1>
              <p className="subtitle">
                {all.length === 0
                  ? "Results appear here as the agent searches."
                  : `${results.length} candidates · ${screenedCount} screened · ${reviewedCount} reviewed in depth`}
              </p>
            </div>
            <div className="tabs" role="tablist">
              <button role="tab" aria-selected={view === "all"} className={view === "all" ? "on" : ""} onClick={() => setView("all")}>
                All
              </button>
              <button role="tab" aria-selected={view === "saved"} className={view === "saved" ? "on" : ""} onClick={() => setView("saved")}>
                Saved {Object.keys(saved).length > 0 && <span className="count">{Object.keys(saved).length}</span>}
              </button>
            </div>
          </div>
          <div className="toolbar">
            <FilterBar
              filters={filters}
              spec={spec}
              regions={config?.regions ?? {}}
              countries={config?.countries ?? []}
              onFilters={changeFilters}
              onSpec={changeSpec}
            />
            <Popover trigger={<><ArrowDownWideNarrow size={14} /> {SORTS[sort]} <ChevronDown size={14} /></>}>
              {(close) => (
                <div className="panel-body options column">
                  {(Object.keys(SORTS) as Sort[]).map((k) => (
                    <button
                      key={k}
                      className={sort === k ? "on" : ""}
                      onClick={() => {
                        setSort(k);
                        close();
                      }}
                    >
                      {SORTS[k]}
                    </button>
                  ))}
                </div>
              )}
            </Popover>
          </div>
        </header>

        {results.length === 0 ? (
          view === "saved" ? (
            <Empty title="Nothing saved yet" body="Bookmark people from the results to keep them here across searches." />
          ) : busy && all.length === 0 && spec.criteria.length > 0 ? (
            <div className="skeletons">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="card skeleton" />
              ))}
            </div>
          ) : all.length > 0 ? (
            <Empty title="No one matches these filters" body="Loosen the location, rate or rating filters, or ask the agent to search further." />
          ) : (
            <Empty
              icon
              title="Find people who've done your kind of work before"
              body="Describe the project in the chat. The agent searches Freelancer.com from several angles, screens everyone's past client work, reads the strongest profiles, and ranks the list by proven experience in your niche."
            />
          )
        ) : (
          <ol className="list">
            {results.slice(0, shown).map(({ f, r }, i) => (
              <ResultCard
                key={f.id}
                rank={i + 1}
                freelancer={f}
                ranking={r}
                criteria={spec.criteria}
                saved={Boolean(saved[f.id])}
                onToggleSave={() =>
                  setSaved((s) => {
                    const next = { ...s };
                    if (next[f.id]) delete next[f.id];
                    else next[f.id] = { freelancer: f, ranking: r };
                    return next;
                  })
                }
              />
            ))}
          </ol>
        )}
        {results.length > shown && (
          <button className="more" onClick={() => setShown((n) => n + PAGE)}>
            Show more ({results.length - shown} left)
          </button>
        )}
      </main>
    </div>
  );
}

function Empty({ title, body, icon }: { title: string; body: string; icon?: boolean }) {
  return (
    <div className="empty">
      {icon && (
        <span className="empty-icon">
          <Search size={20} />
        </span>
      )}
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

function Setup({ missing }: { missing: string[] }) {
  return (
    <div className="setup">
      <div className="setup-card">
        <span className="orb" aria-hidden />
        <h1>Talent Scout needs its API keys</h1>
        <p>The search is run by an AI agent and every candidate is screened by Jev, so these must be set in <code>freelancer-search/.env</code>:</p>
        <ul>
          {missing.map((m) => (
            <li key={m}>
              <code>{m}</code>
            </li>
          ))}
        </ul>
        <p className="muted">See <code>.env.example</code>, then restart the server.</p>
      </div>
    </div>
  );
}
