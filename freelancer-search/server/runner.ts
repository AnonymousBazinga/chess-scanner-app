// Connects a session's Pi agent to the browser: agent events become chat activity, streamed
// reply text and turn boundaries. Messages sent while the agent is working steer it.

import type { Agent, AgentEvent } from "@earendil-works/pi-agent-core";
import type { Activity } from "../shared/types.ts";
import { createAgent, describeTool, type ModelOverride } from "./agent.ts";
import type { Session } from "./session.ts";
import { truncate } from "./util.ts";

export class Runner {
  readonly agent: Agent;
  private turnId: string | null = null;
  private labels = new Map<string, string>();
  private retries = 0;
  private resumeTimer: NodeJS.Timeout | null = null;
  private retryBaseMs: number;

  constructor(
    private session: Session,
    options: { override?: ModelOverride; retryBaseMs?: number } = {},
  ) {
    this.retryBaseMs = options.retryBaseMs ?? 10_000;
    this.agent = createAgent(session, (toolCallId, detail) => this.progress(toolCallId, detail), options.override);
    this.agent.subscribe((e) => this.onEvent(e));
  }

  get busy() {
    return this.agent.state.isStreaming || this.resumeTimer !== null;
  }

  send(text: string) {
    const message = { role: "user" as const, content: text, timestamp: Date.now() };
    if (this.busy) {
      // Picked up after the current tool batch (or when a paused retry resumes).
      this.agent.steer(message);
      this.activity({ id: `steer-${Date.now()}`, kind: "note", label: `Got your message: "${truncate(text, 80)}". Adjusting.`, state: "done" });
      return;
    }
    this.agent.prompt(message).catch((err) => {
      console.error("agent failed:", err);
      this.endTurn((err as Error).message);
    });
  }

  abort() {
    if (this.resumeTimer) {
      clearTimeout(this.resumeTimer);
      this.resumeTimer = null;
      this.agent.clearAllQueues();
      this.endTurn("Stopped.");
      return;
    }
    this.agent.abort();
  }

  private endTurn(error?: string) {
    if (this.turnId) this.session.emit({ type: "turn_end", turnId: this.turnId, error });
    this.turnId = null;
    this.retries = 0;
  }

  /** Rate limits and transient provider errors: drop the failed response and resume the same turn. */
  private scheduleResume(failed: unknown, reason: string) {
    this.retries++;
    const wait = Math.min(60_000, this.retryBaseMs * 2 ** (this.retries - 1));
    this.activity({ id: `retry-${Date.now()}`, kind: "note", label: `${reason} Resuming in ${Math.round(wait / 1000)}s…`, state: "done" });
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null;
      this.agent.state.messages = this.agent.state.messages.filter((m) => m !== failed);
      this.agent.continue().catch((err) => {
        console.error("resume failed:", err);
        this.endTurn((err as Error).message);
      });
    }, wait);
  }

  private activity(activity: Activity) {
    if (this.turnId) this.session.emit({ type: "activity", turnId: this.turnId, activity });
  }

  private progress(toolCallId: string, detail: string) {
    const label = this.labels.get(toolCallId);
    if (label) this.activity({ id: toolCallId, kind: "tool", label, detail, state: "running" });
  }

  private onEvent(e: AgentEvent) {
    switch (e.type) {
      case "agent_start":
        if (this.turnId) break; // resuming after a retry: same turn
        this.turnId = this.session.newTurnId();
        this.session.emit({ type: "turn_start", turnId: this.turnId });
        break;
      case "message_update":
        if (e.assistantMessageEvent.type === "text_delta" && this.turnId) {
          this.session.emit({ type: "reply_delta", turnId: this.turnId, text: e.assistantMessageEvent.delta });
        }
        break;
      case "message_end": {
        const m = e.message as any;
        if (m.role !== "assistant" || !this.turnId) break;
        for (const block of m.content) {
          if (block.type === "thinking" && block.thinking?.trim()) {
            // Reasoning summaries arrive as "**Title** text"; show the title as the label.
            const raw = block.thinking.trim();
            const title = raw.match(/^\*\*(.+?)\*\*\s*/);
            this.activity({
              id: `t-${Math.random().toString(36).slice(2)}`,
              kind: "thought",
              label: title ? title[1] : truncate(raw, 120),
              detail: truncate(title ? raw.slice(title[0].length) : raw.slice(120), 400) || undefined,
              state: "done",
            });
          }
        }
        const hasTools = m.content.some((b: any) => b.type === "toolCall");
        const hasText = m.content.some((b: any) => b.type === "text" && b.text.trim());
        if (hasTools && hasText) this.session.emit({ type: "draft_to_note", turnId: this.turnId });
        break;
      }
      case "tool_execution_start": {
        const label = describeTool(this.session, e.toolName, e.args);
        if (!label) break;
        this.labels.set(e.toolCallId, label);
        this.activity({ id: e.toolCallId, kind: "tool", label, state: "running" });
        break;
      }
      case "tool_execution_end": {
        const label = this.labels.get(e.toolCallId);
        if (!label) break;
        const errorText = e.isError ? e.result?.content?.find((c: any) => c.type === "text")?.text : undefined;
        const detail = e.isError ? truncate(errorText ?? "Failed", 160) : e.result?.details?.summary || undefined;
        this.activity({ id: e.toolCallId, kind: "tool", label, detail, state: e.isError ? "error" : "done" });
        break;
      }
      case "agent_end": {
        if (!this.turnId) break;
        const last = [...e.messages].reverse().find((m: any) => m.role === "assistant") as any;
        let error: string | undefined;
        if (last?.stopReason === "error") {
          error = last.errorMessage || "The model returned an error.";
          if (/rate limit|429|too many requests|overloaded|timed? ?out|5\d\d|ECONNRESET/i.test(error!) && this.retries < 5) {
            this.scheduleResume(last, /rate limit|429|too many/i.test(error!) ? "The model's rate limit was hit." : "The model had a temporary error.");
            break;
          }
        }
        if (last?.stopReason === "aborted") error = "Stopped.";
        this.endTurn(error);
        break;
      }
    }
  }
}
