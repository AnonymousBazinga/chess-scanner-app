import {
  ArrowUp,
  Brain,
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  LoaderCircle,
  PanelLeftClose,
  Sparkles,
  Square,
  SquarePen,
} from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
  model: string;
  title: string;
  onSend: (text: string) => void;
  onStop: () => void;
  onNewChat: () => void;
  onCollapse: () => void;
}

function clock(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

function time(at: number) {
  return new Date(at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      className="icon-btn small"
      aria-label="Copy"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        });
      }}
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

function ActivityLog({ turn }: { turn: AgentTurn }) {
  const running = turn.endedAt === null;
  const [open, setOpen] = useState<boolean | null>(null);
  const [, tick] = useState(0);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  const expanded = open ?? running;
  const elapsed = (turn.endedAt ?? Date.now()) - turn.startedAt;
  const steps = turn.activities.filter((a) => a.kind === "tool").length;
  const current = [...turn.activities].reverse().find((a) => a.kind === "tool" && a.state === "running");
  if (!running && turn.activities.length === 0) return null;

  return (
    <div className="activity">
      <button className="activity-head" onClick={() => setOpen(!expanded)} aria-expanded={expanded}>
        <Sparkles size={14} className={running ? "pulse" : ""} />
        <span className={running ? "shimmer" : ""}>
          {running ? (current ? current.label : "Thinking") : `Worked for ${clock(elapsed)}`}
        </span>
        <span className="muted">
          {running ? clock(elapsed) : `${steps} step${steps === 1 ? "" : "s"}`}
        </span>
        <ChevronRight size={14} className={`chev ${expanded ? "open" : ""}`} />
      </button>
      {expanded && (
        <ol className="steps">
          {turn.activities.map((a) => (
            <li key={a.id} className={`step ${a.kind} ${a.state}`}>
              <span className="step-icon">
                {a.kind === "thought" ? (
                  <Brain size={13} />
                ) : a.kind === "note" ? (
                  <span className="dot" />
                ) : a.state === "running" ? (
                  <LoaderCircle size={13} className="spin" />
                ) : a.state === "error" ? (
                  <CircleAlert size={13} />
                ) : (
                  <Check size={13} />
                )}
              </span>
              <span className="step-text">
                {a.label}
                {a.detail && <span className="step-detail">{a.detail}</span>}
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

export default function ChatPanel({ turns, busy, suggestions, model, title, onSend, onStop, onNewChat, onCollapse }: Props) {
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

  return (
    <aside className="chat">
      <header className="chat-head">
        <span className="orb" aria-hidden />
        <h2 title={title}>{title}</h2>
        <div className="head-actions">
          <button className="icon-btn" aria-label="New search" title="New search" onClick={onNewChat}>
            <SquarePen size={18} />
          </button>
          <button className="icon-btn" aria-label="Hide chat" title="Hide chat" onClick={onCollapse}>
            <PanelLeftClose size={18} />
          </button>
        </div>
      </header>

      <div
        className="log"
        ref={logRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {turns.length === 0 && (
          <div className="intro">
            <p>Describe who you're hiring, or paste the whole job post.</p>
            <p className="muted">
              I'll search Freelancer.com from several angles, have Jev screen every candidate's past client work, read
              the strongest profiles in depth, and rank the list on the right by how closely their delivered work
              matches your niche.
            </p>
          </div>
        )}
        {turns.map((t, i) =>
          t.kind === "user" ? (
            <div key={i} className="msg user">
              <div className="bubble">{t.text}</div>
              <div className="meta">
                <span>{time(t.at)}</span>
                <CopyButton text={t.text} />
              </div>
            </div>
          ) : (
            <div key={t.turnId} className="msg agent">
              <ActivityLog turn={t} />
              {(t.text || t.draft) && <Markdown text={t.text || t.draft} />}
              {t.error && (
                <p className="error">
                  <CircleAlert size={14} /> {t.error}
                </p>
              )}
              {t.endedAt !== null && t.text && (
                <div className="meta">
                  <CopyButton text={t.text} />
                </div>
              )}
            </div>
          ),
        )}
      </div>

      <div className="composer-wrap">
        {suggestions.length > 0 && !busy && (
          <div className="suggestions">
            {suggestions.map((s) => (
              <button key={s} onClick={() => submit(s)}>
                {s}
              </button>
            ))}
          </div>
        )}
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
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
            placeholder={
              busy ? "Steer the search while it runs…" : turns.length ? "Refine: 'Add Scrapy', 'More from Spain'…" : "Who are you looking for?"
            }
            aria-label="Message"
          />
          <div className="composer-row">
            <span className="chip-static" title="The agent that runs the search">
              <Sparkles size={13} /> {model}
            </span>
            <span className="chip-static" title="Screens every candidate's work history">
              Jev screening
            </span>
            <span className="spacer" />
            {busy && !draft.trim() ? (
              <button type="button" className="send stop" aria-label="Stop" onClick={onStop}>
                <Square size={12} fill="currentColor" />
              </button>
            ) : (
              <button type="submit" className="send" aria-label="Send" disabled={!draft.trim()}>
                <ArrowUp size={17} />
              </button>
            )}
          </div>
        </form>
      </div>
    </aside>
  );
}
