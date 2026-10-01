import { afterEach, describe, expect, it, vi } from "vitest";
import type { Freelancer, Spec } from "../shared/types.ts";
import { normalizeUser } from "../server/freelancer.ts";
import { candidateState, screen, toRanking, trackRecord } from "../server/jev.ts";
import { rawUser, scoreAnswer, stubApis } from "./helpers.ts";

const spec: Spec = {
  brief: "ETL engineer",
  criteria: [
    { id: "etl", label: "ETL", description: "Built ETL pipelines", weight: 3 },
    { id: "dbt", label: "dbt", description: "Used dbt", weight: 1 },
  ],
};

function withWork(): Freelancer {
  const f = normalizeUser(rawUser(1));
  f.work = [
    { kind: "review", title: "Airflow ETL", text: "great", rating: 5, date: null, url: null },
    { kind: "portfolio", title: "Dashboard", text: "BI", rating: null, date: null, url: null },
  ];
  f.enriched = true;
  return f;
}

afterEach(() => vi.unstubAllGlobals());

describe("toRanking", () => {
  it("weights criteria, maps levels to fits and resolves the best project", () => {
    const f = withWork();
    const r = toRanking(spec, f, { "c:etl": scoreAnswer(3), "c:dbt": scoreAnswer(0), fit: { type: "noul", noul: 1 }, best: { type: "choice", choice: "p0" } });
    expect(r.criteria.map((c) => c.fit)).toEqual(["direct", "none"]);
    // relevance = 100 * (0.7 * (1 * 3 + 0 * 1) / 4 + 0.3 * 1) = 82.5
    expect(r.score).toBe(Math.round(0.85 * 82.5 + 0.15 * trackRecord(f)));
    expect(r.highlights).toEqual([0]);
    expect(r.summary).toContain("Airflow ETL");
    expect(r.confidence).toBeCloseTo(0.9);
  });

  it("ranks delivered work above claims", () => {
    const f = withWork();
    const direct = toRanking(spec, f, { "c:etl": scoreAnswer(3), "c:dbt": scoreAnswer(3), fit: { noul: 0.9 } });
    const claimed = toRanking(spec, f, { "c:etl": scoreAnswer(1), "c:dbt": scoreAnswer(1), fit: { noul: 0.9 } });
    expect(direct.score).toBeGreaterThan(claimed.score);
    expect(claimed.criteria[0].fit).toBe("claimed");
  });
});

describe("screen", () => {
  it("sends one Score per criterion, an overall fit and a best-project Choice", async () => {
    process.env.TYPESAFE_API_KEY = "test";
    const calls = stubApis([], () => ({ "c:etl": scoreAnswer(2), "c:dbt": scoreAnswer(1), fit: { noul: 0.5 }, best: { choice: "none" } }));
    const r = await screen(spec, withWork());
    const body = calls[0].body;
    expect(Object.keys(body.questions).sort()).toEqual(["best", "c:dbt", "c:etl", "fit"]);
    expect(body.questions["c:etl"].type).toBe("score");
    expect(body.questions.best.criteria).toMatchObject({ none: expect.any(String), p0: "Airflow ETL", p1: "Dashboard" });
    expect(body.state.past_client_projects[0]).toMatchObject({ id: "p0", title: "Airflow ETL" });
    expect(r.criteria.map((c) => c.fit)).toEqual(["adjacent", "claimed"]);
    expect(r.criteria[0].evidence).toBe("Related work · 100% likely");
    expect(r.highlights).toEqual([]);
  });
});

describe("candidateState", () => {
  it("keeps work item indexes stable across reviews and portfolio", () => {
    const s = candidateState(withWork());
    expect(s.past_client_projects.map((p) => p.id)).toEqual(["p0"]);
    expect(s.portfolio.map((p) => p.id)).toEqual(["p1"]);
  });
});
