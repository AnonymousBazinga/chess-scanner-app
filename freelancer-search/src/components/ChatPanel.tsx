import { ArrowUp, Check, ChevronRight, Copy, Plus, Square } from "lucide-react";
import { useLayoutEffect, useRef, useState } from "react";
import type { Activity } from "../../shared/types.ts";
import Markdown from "./Markdown.tsx";

export interface UserTurn {
  kind: "user";
  text: string;
  at: number;
}

export interface AgentTurn {
  kind: "agent";
  turnId: string;
  activities: Activity[];
  /** Text streaming in; becomes `text` when the turn ends. */
  draft: string;
  text: string;
  startedAt: number;
  endedAt: number | null;
  error: string | null;
}

export type Turn = UserTurn | AgentTurn;

interface Props {
  turns: Turn[];
  busy: boolean;
  suggestions: string[];
  onSend: (text: string) => void;
  onStop: () => void;
  onNewChat: () => void;
  paneSwitch: React.ReactNode;
}

const STARTERS = [
  "Python data engineer in Europe under $70/hr who has built ETL pipelines into BigQuery",
  "Shopify developer who has migrated stores off WooCommerce",
  "Scraping specialist who has dealt with Cloudflare and anti-bot protection",
];

function duration(ms: number) {
  const s = Math.max(1, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
}

/** "Searched 12 queries, read 15 work histories and screened the pool in 2m 58s" */
function foldSummary(reads: Activity[], ms: number) {
  const count = (prefix: string) => reads.filter((a) => a.label.startsWith(prefix)).length;
  const parts: string[] = [];
  const searches = count("Searched");
  const profiles = count("Read ") - count("Read the ranking") - count("Read GitHub");
  const screens = count("Screened");
  const github = count("Looked for") + count("Read GitHub");
  const pages = count("Opened");
  if (searches) parts.push(`searched ${searches} ${searches === 1 ? "query" : "queries"}`);
  if (screens) parts.push(screens === 1 ? "screened the pool" : `screened the pool ${screens} times`);
  if (profiles) parts.push(`read ${profiles} work ${profiles === 1 ? "history" : "histories"}`);
  if (github) parts.push(`checked GitHub ${github} ${github === 1 ? "time" : "times"}`);
  if (pages) parts.push(`opened ${pages} ${pages === 1 ? "page" : "pages"}`);
  const failed = reads.filter((a) => a.state === "error").length;
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0] ?? `looked at ${reads.length} things`;
  const failures = failed ? `, ${failed} ${failed === 1 ? "step" : "steps"} failed` : "";
  return `${list[0].toUpperCase()}${list.slice(1)} in ${duration(ms)}${failures}`;
}

function Step({ a, live }: { a: Activity; live: boolean }) {
  const running = a.state === "running" && live;
  const mark = a.state === "error" ? "bad" : a.kind === "write" ? (a.tone ?? "muted") : "hollow";
  // A verdict receipt reads "Shortlisted Martin, scored 64"; the reasoning is on hover.
  const score = a.kind === "write" && a.state === "done" ? a.detail?.match(/^Scored (\d+)/)?.[1] : undefined;
  const detail = score ? null : a.detail;
  return (
    <div className={`step ${a.kind} ${a.state}`} title={score ? a.detail : undefined}>
      <span className="step-mark">
        <i className={mark} />
      </span>
      <span className="step-text">
        <span className={running ? "shimmer" : ""}>{a.label}</span>
        {score && <span className="step-detail">, scored {score}</span>}
        {detail && <span className="step-detail">, {detail}</span>}
      </span>
    </div>
  );
}

function AgentTurnView({ turn, last, suggestions, onSend }: { turn: AgentTurn; last: boolean; suggestions: string[]; onSend: (t: string) => void }) {
  const [unfolded, setUnfolded] = useState(false);
  const [copied, setCopied] = useState(false);
  const live = turn.endedAt === null;
  const reads = turn.activities.filter((a) => a.kind === "read" || a.kind === "thought");
  const text = turn.text || turn.draft;

  // While running: every step in the order it happened. Settled: reads fold into one line,
  // receipts (writes) and what the agent said stay.
  // A failed read (a lookup that errored) folds with the other reads; the fold line counts it.
  const visible = live || unfolded ? turn.activities : turn.activities.filter((a) => a.kind === "write" || a.kind === "note");

  return (
    <div className={`agent-turn ${last ? "last" : ""}`}>
      {!live && reads.length > 0 && (
        <div className="step">
          <span className="step-mark" />
          <button className="fold step-text" aria-expanded={unfolded} onClick={() => setUnfolded((u) => !u)}>
            {foldSummary(reads.filter((a) => a.kind === "read"), (turn.endedAt ?? Date.now()) - turn.startedAt)}
            <ChevronRight size={14} />
          </button>
        </div>
      )}
      {visible.map((a) =>
        a.kind === "note" ? (
          <div key={a.id} className="step note">
            <span className="step-mark" />
            <span className="step-text preamble">{a.label}</span>
          </div>
        ) : a.kind === "thought" ? (
          <div key={a.id} className="step thought">
            <span className="step-mark" />
            <span className="step-text">{a.label}</span>
          </div>
        ) : (
          <Step key={a.id} a={a} live={live} />
        ),
      )}
      {live && turn.activities.length === 0 && !text && (
        <div className="step">
          <span className="step-mark" />
          <span className="step-text shimmer">Thinking</span>
        </div>
      )}
      {text && (
        <div className="answer">
          <Markdown text={text} />
        </div>
      )}
      {turn.error && (
        <div className="turn-error">
          <span className="step-mark">
            <i className="bad" />
          </span>
          <span>{turn.error === "Stopped." ? "Stopped." : `The search stopped: ${turn.error}`}</span>
        </div>
      )}
      {!live && last && suggestions.length > 0 && (
        <div className="followups">
          {suggestions.map((s) => (
            <button key={s} className="outline-button" onClick={() => onSend(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      {!live && text && (
        <div className="turn-actions">
          <button
            className="icon-button"
            aria-label="Copy answer"
            title="Copy answer"
            onClick={() =>
              navigator.clipboard?.writeText(text).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1200);
              })
            }
          >
            {copied ? <Check size={14} /> : <Copy size={14} />}
          </button>
        </div>
      )}
    </div>
  );
}

export default function ChatPanel({ turns, busy, suggestions, onSend, onStop, onNewChat, paneSwitch }: Props) {
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = logRef.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  });

  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 220)}px`;
  }, [draft]);

  const submit = (text = draft) => {
    const t = text.trim();
    if (!t) return;
    stick.current = true;
    onSend(t);
    setDraft("");
  };
  const lastAgent = [...turns].reverse().find((t) => t.kind === "agent");

  return (
    <section className="pane pane-chat" aria-label="Chat">
      <header className="band">
        <span className="band-title">talent scout</span>
        {paneSwitch}
        <span className="band-spacer" />
        <button className="icon-button" aria-label="New search" title="New search" onClick={onNewChat}>
          <Plus size={16} />
        </button>
      </header>

      <div
        className="transcript"
        ref={logRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {turns.length === 0 && (
          <div className="welcome">
            <p>Describe who you're hiring, or paste the job post. I search Freelancer.com, read each candidate's past client work, and rank the list by how closely it matches yours.</p>
            <div className="starters">
              {STARTERS.map((s) => (
                <button key={s} className="starter" onClick={() => submit(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {turns.map((t, i) =>
          t.kind === "user" ? (
            <div key={i} className="user-turn">
              <div className="pill">{t.text}</div>
            </div>
          ) : (
            <AgentTurnView key={t.turnId} turn={t} last={t === lastAgent} suggestions={suggestions} onSend={submit} />
          ),
        )}
      </div>

      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <div className="capture">
          <textarea
            ref={inputRef}
            value={draft}
            rows={1}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder={busy ? "Steer the search" : turns.length ? "Refine the search" : "Who are you looking for"}
            aria-label="Message"
          />
          {busy && !draft.trim() ? (
            <button type="button" className="send" aria-label="Stop" title="Stop" onClick={onStop}>
              <Square size={11} fill="currentColor" />
            </button>
          ) : (
            <button type="submit" className="send" aria-label="Send" disabled={!draft.trim()}>
              <ArrowUp size={16} />
            </button>
          )}
        </div>
      </form>
    </section>
  );
}
