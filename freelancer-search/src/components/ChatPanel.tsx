import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "../../shared/types.ts";

/** "note" = a manual filter edit echoed into the chat; "error" = a failed search. Neither goes to the planner. */
export type ChatItem = ChatMessage & { kind?: "note" | "error" };

interface Props {
  chat: ChatItem[];
  busy: boolean;
  suggestions: string[];
  ai: boolean | null;
  model: string | null;
  onSend: (text: string) => void;
}

export default function ChatPanel({ chat, busy, suggestions, ai, model, onSend }: Props) {
  const [draft, setDraft] = useState("");
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight, behavior: "smooth" });
  }, [chat.length]);

  const submit = (text = draft) => {
    const t = text.trim();
    if (!t) return;
    onSend(t);
    setDraft("");
  };

  return (
    <aside className="chat">
      <header className="chat-head">
        <span className="logo" aria-hidden>
          ◎
        </span>
        <div>
          <h2>AI search &amp; refine</h2>
          <p className="mode">
            {ai === null ? "…" : ai ? `Ranking with Claude · ${model}` : "Keyword mode · set ANTHROPIC_API_KEY for AI ranking"}
          </p>
        </div>
      </header>

      <div className="log" ref={logRef}>
        {chat.length === 0 && (
          <p className="hint">
            Tell me what you're hiring for. Paste a whole job post if you have one: the more specific, the better the
            ranking.
          </p>
        )}
        {chat.map((m, i) => (
          <div key={i} className={`msg ${m.role} ${m.kind ?? ""}`}>
            {m.role === "assistant" && m.kind !== "note" && (
              <span className="avatar" aria-hidden>
                ◎
              </span>
            )}
            <p>{m.content}</p>
          </div>
        ))}
        {busy && chat[chat.length - 1]?.role === "user" && (
          <div className="msg assistant typing">
            <span className="avatar" aria-hidden>
              ◎
            </span>
            <p>
              <span className="dot" />
              <span className="dot" />
              <span className="dot" />
            </p>
          </div>
        )}
      </div>

      {suggestions.length > 0 && (
        <div className="suggestions">
          {suggestions.map((s) => (
            <button key={s} onClick={() => submit(s)} disabled={busy && chat[chat.length - 1]?.role === "user"}>
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
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder={chat.length ? "e.g. 'Add Scrapy', 'More from Spain', 'Higher job success'" : "Describe your project, or paste a job post…"}
          rows={chat.length ? 3 : 6}
          aria-label="Message"
        />
        <button type="submit" disabled={!draft.trim()} aria-label="Send">
          ↑
        </button>
      </form>
    </aside>
  );
}
