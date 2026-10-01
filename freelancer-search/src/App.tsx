import { ArrowUpDown, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { emptyFilters, passesFilters, type AppConfig, type Filters, type Freelancer, type Ranking, type ServerEvent, type Spec } from "../shared/types.ts";
import { api } from "./api.ts";
import ChatPanel, { type AgentTurn, type Turn } from "./components/ChatPanel.tsx";
import FilterBar from "./components/FilterBar.tsx";
import Menu from "./components/Menu.tsx";
import ResultRow from "./components/ResultRow.tsx";

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
  /** Which pane shows on narrow screens. */
  const [pane, setPane] = useState<"chat" | "talent">("chat");
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

  const screenedCount = results.filter(({ r }) => r).length;
  const reviewedCount = results.filter(({ r }) => r?.source === "agent").length;
  const screening = view === "all" && spec.criteria.length > 0 && screenedCount < results.length && busy;

  const toggleSave = useCallback(
    (f: Freelancer, r: Ranking | null) =>
      setSaved((s) => {
        const next = { ...s };
        if (next[f.id]) delete next[f.id];
        else next[f.id] = { freelancer: f, ranking: r };
        return next;
      }),
    [],
  );

  const switcher = (
    <div className="switch pane-switch" role="tablist" aria-label="View">
      <button role="tab" aria-selected={pane === "chat"} onClick={() => setPane("chat")}>
        Chat
      </button>
      <button role="tab" aria-selected={pane === "talent"} onClick={() => setPane("talent")}>
        Talent
      </button>
    </div>
  );

  if (configError) return <Setup missing={[configError]} />;
  if (config && !config.ready) return <Setup missing={config.missing} />;

  const meta =
    all.length === 0
      ? ""
      : screening
        ? `Screening ${screenedCount} of ${results.length}`
        : view === "saved"
          ? `${results.length} saved`
          : `${results.length} ${results.length === 1 ? "candidate" : "candidates"}${reviewedCount ? `, ${reviewedCount} read in depth` : ""}`;

  return (
    <div className="shell" data-pane={pane}>
      <ChatPanel
        turns={turns}
        busy={busy}
        suggestions={suggestions}
        onSend={send}
        onStop={() => sessionId && api.abort(sessionId)}
        onNewChat={newChat}
        paneSwitch={switcher}
      />

      <section className="pane pane-talent" aria-label="Talent">
        <header className="band">
          <span className="band-title">Talent</span>
          <span className="band-meta">{meta}</span>
          {switcher}
          <span className="band-spacer" />
          <div className="switch" role="tablist" aria-label="Show">
            <button role="tab" aria-selected={view === "all"} onClick={() => setView("all")}>
              All
            </button>
            <button role="tab" aria-selected={view === "saved"} onClick={() => setView("saved")}>
              Saved
            </button>
          </div>
          <Menu align="right" label={`Sort: ${SORTS[sort]}`} trigger={<><span className="sort-label">{SORTS[sort]}</span><ArrowUpDown className="sort-icon" size={14} /> <ChevronDown className="sort-chevron" size={14} /></>}>
            {(close) =>
              (Object.keys(SORTS) as Sort[]).map((k) => (
                <button
                  key={k}
                  className="menu-row"
                  role="menuitemradio"
                  aria-checked={sort === k}
                  onClick={() => {
                    setSort(k);
                    close();
                  }}
                >
                  {SORTS[k]}
                </button>
              ))
            }
          </Menu>
        </header>

        <FilterBar filters={filters} spec={spec} regions={config?.regions ?? {}} countries={config?.countries ?? []} onFilters={changeFilters} onSpec={changeSpec} />

        <div className="list-scroll">
          {results.length === 0 ? (
            view === "saved" ? (
              <Empty title="Nothing saved yet" body="Save people from the results and they stay here across searches." />
            ) : busy && all.length === 0 ? (
              <div className="list">
                {Array.from({ length: 5 }, (_, i) => (
                  <div key={i} className="skeleton" />
                ))}
              </div>
            ) : all.length > 0 ? (
              <Empty title="No one matches these filters" body="Remove a filter above, or ask in the chat to search further." />
            ) : (
              <Empty title="No search yet" body="Describe the job in the chat. Candidates appear here as they're found, ranked by the work they've delivered for clients." />
            )
          ) : (
            <ol className="list">
              {results.slice(0, shown).map(({ f, r }) => (
                <ResultRow key={f.id} freelancer={f} ranking={r} criteria={spec.criteria} saved={Boolean(saved[f.id])} onToggleSave={toggleSave} />
              ))}
            </ol>
          )}
          {results.length > shown && (
            <button className="outline-button more" onClick={() => setShown((n) => n + PAGE)}>
              Show {Math.min(PAGE, results.length - shown)} more
            </button>
          )}
        </div>
      </section>
    </div>
  );
}

function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p>{body}</p>
    </div>
  );
}

function Setup({ missing }: { missing: string[] }) {
  return (
    <div className="setup">
      <h1>Add the API keys to start</h1>
      <p>The search is run by an AI agent and every candidate is screened by Jev. Set these in freelancer-search/.env, then restart the server:</p>
      <ul>
        {missing.map((m) => (
          <li key={m}>{m}</li>
        ))}
      </ul>
      <p>.env.example lists every setting.</p>
    </div>
  );
}
