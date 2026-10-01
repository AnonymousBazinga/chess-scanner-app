import type Anthropic from "@anthropic-ai/sdk";
import { afterEach, describe, expect, it } from "vitest";
import type { Freelancer, SearchSpec } from "../shared/types.ts";
import { aiPlan, aiRank, setClient } from "../server/ai.ts";
import { setCountries } from "../server/geo.ts";

/** A stand-in client whose `beta.messages.parse` returns `output` and records the request. */
function stub(output: unknown, stop_reason = "end_turn") {
  const calls: any[] = [];
  const client = {
    beta: {
      messages: {
        parse: async (params: any) => {
          calls.push(params);
          return { stop_reason, parsed_output: output };
        },
      },
    },
  } as unknown as Anthropic;
  setClient(client);
  return calls;
}

afterEach(() => setClient(null));

const spec: SearchSpec = {
  brief: "Python ETL pipelines",
  queries: ["python etl"],
  filters: { countries: [], locationLabel: null, minRate: null, maxRate: null, minRating: null, minReviews: null },
  criteria: [
    { id: "etl", label: "ETL", description: "", keywords: ["etl"], weight: 3 },
    { id: "aws", label: "AWS", description: "", keywords: ["aws"], weight: 1 },
  ],
};

const f = (id: number, reviews: number): Freelancer => ({
  id, username: `u${id}`, displayName: `U${id}`, tagline: "", description: "", avatarUrl: null, country: null,
  countryCode: null, city: null, hourlyRate: 40, currency: "USD", rating: 4.9, reviews, jobsCompleted: reviews,
  completionRate: 1, onTime: 1, onBudget: 1, earningsScore: null, skills: [], registeredAt: null, profileUrl: "",
  work: [{ kind: "review", title: "Airflow ETL", text: "", rating: 5, date: null, url: null }], enriched: true,
});

describe("aiPlan", () => {
  it("resolves places, clamps weights and makes stable ids", async () => {
    setCountries([{ name: "Germany", code: "DE" }, { name: "Spain", code: "ES" }]);
    const calls = stub({
      reply: "ok",
      suggestions: ["a", "b", "c", "d", "e"],
      brief: "b",
      queries: ["python etl", " python etl ", ""],
      places: ["Europe", "Narnia"],
      minRate: null, maxRate: 70, minRating: null, minReviews: null,
      criteria: [
        { label: "ETL pipelines", description: "d", keywords: [], weight: 7 },
        { label: "ETL pipelines", description: "d", keywords: ["x"], weight: 0 },
      ],
    });
    const { spec, reply, suggestions } = await aiPlan([{ role: "user", content: "hi" }], null);
    expect(calls[0].model).toBe("claude-opus-5-5");
    expect(calls[0].fallbacks).toBe("default");
    expect(spec.filters.countries).toEqual(["Germany", "Spain"]);
    expect(spec.filters.locationLabel).toBe("Europe");
    expect(reply).toContain("Narnia");
    expect(spec.queries).toEqual(["python etl"]);
    expect(spec.criteria.map((c) => [c.id, c.weight])).toEqual([["etl-pipelines", 3], ["etl-pipelines-2", 1]]);
    expect(spec.criteria[0].keywords).toEqual(["ETL pipelines"]);
    expect(suggestions).toHaveLength(4);
  });
});

describe("aiRank", () => {
  it("turns per-criterion fits into scores and ignores unknown ids", async () => {
    stub({
      candidates: [
        { id: 1, overall: 9, summary: "s", criteria: [{ criterionId: "etl", fit: "strong", evidence: "e" }, { criterionId: "aws", fit: "strong", evidence: "e" }], highlights: [0, 5] },
        { id: 2, overall: 2, summary: "s", criteria: [{ criterionId: "etl", fit: "none", evidence: "e" }], highlights: [] },
        { id: 99, overall: 10, summary: "s", criteria: [], highlights: [] },
      ],
    });
    const out = await aiRank(spec, [f(1, 40), f(2, 40)]);
    expect([...out.keys()]).toEqual([1, 2]);
    expect(out.get(1)!.relevance).toBe(96);
    expect(out.get(1)!.highlights).toEqual([0]);
    expect(out.get(2)!.criteria.map((c) => c.fit)).toEqual(["none", "none"]);
    expect(out.get(1)!.score).toBeGreaterThan(out.get(2)!.score);
    expect(out.get(1)!.method).toBe("ai");
  });

  it("raises on a refusal so the batch keeps its keyword scores", async () => {
    stub(null, "refusal");
    await expect(aiRank(spec, [f(1, 1)])).rejects.toThrow(/declined/);
  });
});
