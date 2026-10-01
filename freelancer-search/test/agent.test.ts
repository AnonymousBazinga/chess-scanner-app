import { createModels, fauxAssistantMessage, fauxProvider, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ServerEvent } from "../shared/types.ts";
import { pruneContext } from "../server/agent.ts";
import { setCountries } from "../server/geo.ts";
import { Runner } from "../server/runner.ts";
import { createSession } from "../server/session.ts";
import { rawUser, scoreAnswer, stubApis } from "./helpers.ts";

function harness() {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  const session = createSession();
  const runner = new Runner(session, { override: { model: faux.getModel(), streamFn: models.streamSimple.bind(models) }, retryBaseMs: 5 });
  const events: ServerEvent[] = [];
  session.subscribe((e) => events.push(e));
  const turnEnd = () =>
    new Promise<Extract<ServerEvent, { type: "turn_end" }>>((resolve) => {
      const off = session.subscribe((e) => {
        if (e.type === "turn_end") {
          off();
          resolve(e);
        }
      });
    });
  return { faux, session, runner, events, turnEnd };
}

beforeEach(() => {
  process.env.TYPESAFE_API_KEY = "test";
  setCountries([
    { name: "Spain", code: "ES" },
    { name: "Germany", code: "DE" },
    { name: "India", code: "IN" },
  ]);
});
afterEach(() => vi.unstubAllGlobals());

describe("agent loop", () => {
  it("defines criteria, searches, screens, inspects and records a verdict", async () => {
    stubApis(
      [rawUser(1), rawUser(2, { hourly_rate: 90 }), rawUser(3, { location: { country: { name: "India", code: "in" } } })],
      (body) => ({ "c:etl-pipelines": scoreAnswer(body.state.hourly_rate_usd === 40 ? 3 : 1), fit: { noul: 0.8 }, best: { choice: "p0" } }),
    );
    const { faux, session, runner, events, turnEnd } = harness();
    faux.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall("set_search_criteria", {
            brief: "ETL engineer",
            criteria: [{ label: "ETL pipelines", description: "Built ETL", weight: 3 }],
            location: ["Europe"],
            max_rate: 70,
          }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("Searching now."), fauxToolCall("search_freelancers", { query: "etl" })], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("screen_candidates", {})], { stopReason: "toolUse" }),
      fauxAssistantMessage([fauxToolCall("inspect_freelancer", { id: 1 })], { stopReason: "toolUse" }),
      fauxAssistantMessage(
        [
          fauxToolCall("record_assessment", {
            id: 1,
            verdict: "shortlist",
            score: 93,
            summary: "Delivered Airflow ETL for clients.",
            // A label instead of the id still has to land on the right criterion.
            criteria: [{ criterion_id: "ETL pipelines", fit: "direct", evidence: 'Delivered "Airflow ETL pipeline"' }],
            highlight_projects: ["p0"],
          }),
          fauxToolCall("suggest_followups", { suggestions: ["Add dbt", "Only Spain"] }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage([fauxText("User 1 is the standout.")]),
    ]);
    const done = turnEnd();
    runner.send("Python ETL engineer in Europe under $70/hr");
    const end = await done;

    expect(end.error).toBeUndefined();
    expect(session.spec.criteria.map((c) => c.id)).toEqual(["etl-pipelines"]);
    expect(session.filters).toMatchObject({ locationLabel: "Europe", maxRate: 70 });
    expect([...session.filters.countries].sort()).toEqual(["Germany", "Spain"]);
    // The stubbed directory returns all three; the rate and location filters keep 2 and 3 out of screening.
    expect(session.pool.size).toBe(3);
    expect([...session.screened.keys()]).toEqual([1]);
    expect(session.ranking(1)).toMatchObject({ source: "agent", verdict: "shortlist", score: 93, highlights: [0] });
    expect(session.ranking(1)!.criteria).toEqual([{ criterionId: "etl-pipelines", fit: "direct", evidence: 'Delivered "Airflow ETL pipeline"' }]);
    expect(session.ranked().map(({ f }) => f.id)).toEqual([1]);
    expect(session.suggestions).toEqual(["Add dbt", "Only Spain"]);

    const labels = events.flatMap((e) => (e.type === "activity" && e.activity.state === "done" ? [e.activity.label] : []));
    expect(labels).toEqual(
      expect.arrayContaining(["Searched \u201cetl\u201d", "Screened the pool with Jev", "Read User 1's work history", "Shortlisted User 1"]),
    );
    expect(events.some((e) => e.type === "draft_to_note")).toBe(true);
    const reply = events.flatMap((e) => (e.type === "reply_delta" ? [e.text] : [])).join("");
    expect(reply).toContain("User 1 is the standout.");
  });

  it("resumes the same turn after a rate limit", async () => {
    stubApis([], () => ({}));
    const { faux, events, runner, turnEnd } = harness();
    faux.setResponses([
      fauxAssistantMessage([], { stopReason: "error", errorMessage: "429 Too Many Requests: rate limit exceeded" }),
      fauxAssistantMessage([fauxText("Recovered.")]),
    ]);
    const done = turnEnd();
    runner.send("hello");
    const end = await done;
    expect(end.error).toBeUndefined();
    expect(events.filter((e) => e.type === "turn_start")).toHaveLength(1);
    expect(events.some((e) => e.type === "activity" && /rate limit/.test(e.activity.label))).toBe(true);
  });

  it("reports a non-retryable model error instead of hiding it", async () => {
    stubApis([], () => ({}));
    const { faux, runner, turnEnd } = harness();
    faux.setResponses([fauxAssistantMessage([], { stopReason: "error", errorMessage: "401 invalid api key" })]);
    const done = turnEnd();
    runner.send("hello");
    expect((await done).error).toContain("401");
  });
});

describe("pruneContext", () => {
  const toolCall = (id: string, name: string, args: object) => ({ role: "assistant", content: [{ type: "toolCall", id, name, arguments: args }] });
  const result = (id: string, name: string, text: string) => ({ role: "toolResult", toolCallId: id, toolName: name, content: [{ type: "text", text }] });

  it("trims old output but keeps dossiers the agent hasn't judged yet", () => {
    const big = "x".repeat(5000);
    const messages: any[] = [
      { role: "user", content: "go" },
      toolCall("a", "search_freelancers", { query: "q" }),
      result("a", "search_freelancers", big),
      toolCall("b", "inspect_freelancer", { id: 1 }),
      result("b", "inspect_freelancer", big),
      toolCall("c", "inspect_freelancer", { id: 2 }),
      result("c", "inspect_freelancer", big),
      toolCall("d", "record_assessment", { id: 1 }),
      result("d", "record_assessment", "ok"),
      toolCall("e", "list_candidates", {}),
      result("e", "list_candidates", "ok"),
      toolCall("f", "list_candidates", {}),
      result("f", "list_candidates", "ok"),
    ];
    const pruned = pruneContext(messages) as any[];
    const len = (i: number) => pruned[i].content[0].text.length;
    expect(len(2)).toBeLessThan(600); // old search output
    expect(len(4)).toBeLessThan(400); // dossier for #1, already assessed
    expect(len(6)).toBe(5000); // dossier for #2, not assessed yet
  });
});
