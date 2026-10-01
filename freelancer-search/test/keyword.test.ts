import { beforeAll, describe, expect, it } from "vitest";
import type { Freelancer, SearchSpec } from "../shared/types.ts";
import { resolvePlace, setCountries } from "../server/geo.ts";
import { keywordPlan, keywordRank, qualityScore } from "../server/keyword.ts";
import { passesFilters } from "../server/search.ts";

beforeAll(() => {
  setCountries([
    { name: "Germany", code: "DE" },
    { name: "Spain", code: "ES" },
    { name: "Poland", code: "PL" },
    { name: "United Kingdom", code: "GB" },
    { name: "India", code: "IN" },
  ]);
});

function freelancer(over: Partial<Freelancer> = {}): Freelancer {
  return {
    id: 1, username: "u", displayName: "U", tagline: "", description: "", avatarUrl: null, country: "Spain",
    countryCode: "es", city: null, hourlyRate: 40, currency: "USD", rating: 4.9, reviews: 30, jobsCompleted: 30,
    completionRate: 1, onTime: 1, onBudget: 1, earningsScore: null, skills: [], registeredAt: null,
    profileUrl: "", work: [], enriched: true, ...over,
  };
}

describe("resolvePlace", () => {
  it("expands regions to the countries Freelancer.com knows", () => {
    expect(resolvePlace("Europe")).toEqual(expect.arrayContaining(["Germany", "Spain", "Poland", "United Kingdom"]));
    expect(resolvePlace("Europe")).not.toContain("India");
  });
  it("handles aliases and case", () => {
    expect(resolvePlace("uk")).toEqual(["United Kingdom"]);
    expect(resolvePlace("spain")).toEqual(["Spain"]);
    expect(resolvePlace("Atlantis")).toEqual([]);
  });
});

describe("keywordPlan", () => {
  it("pulls skills, region and rate out of a first message", () => {
    const { spec } = keywordPlan("I'm looking for a Python data engineer in Europe, budget under $70/hr, with ETL expertise.", null);
    expect(spec.filters.maxRate).toBe(70);
    expect(spec.filters.locationLabel).toBe("Europe");
    expect(spec.filters.countries).toContain("Germany");
    expect(spec.criteria.map((c) => c.label)).toEqual(["Python data engineer", "ETL"]);
  });

  it("drops filler verbs", () => {
    const { spec } = keywordPlan("A scraping expert who has dealt with Cloudflare and anti-bot protection", null);
    expect(spec.criteria.map((c) => c.label)).toEqual(["scraping", "Cloudflare", "anti-bot protection"]);
  });

  it("refines an existing spec instead of replacing it", () => {
    const first = keywordPlan("Python data engineer in Europe under $70/hr", null).spec;
    const added = keywordPlan("Add Scrapy", first).spec;
    expect(added.criteria.map((c) => c.label)).toEqual(["Python data engineer", "Scrapy"]);
    expect(added.filters.maxRate).toBe(70);

    const spain = keywordPlan("More from Spain", added).spec;
    expect(spain.filters.countries).toEqual(["Spain"]);
    expect(spain.criteria).toHaveLength(2);

    const proven = keywordPlan("Higher job success", spain).spec;
    expect(proven.filters.minRating).toBeGreaterThanOrEqual(4.7);
    expect(proven.criteria).toHaveLength(2);

    const removed = keywordPlan("remove scrapy", proven).spec;
    expect(removed.criteria.map((c) => c.label)).toEqual(["Python data engineer"]);
  });
});

describe("keywordRank", () => {
  const spec: SearchSpec = {
    brief: "",
    queries: ["etl"],
    filters: { countries: [], locationLabel: null, minRate: null, maxRate: null, minRating: null, minReviews: null },
    criteria: [
      { id: "etl", label: "ETL pipelines", description: "", keywords: ["etl", "airflow"], weight: 3 },
      { id: "scrapy", label: "Scrapy", description: "", keywords: ["scrapy"], weight: 1 },
    ],
  };

  it("ranks delivered client work above a skills-list claim", () => {
    const delivered = freelancer({
      id: 1,
      work: [
        { kind: "review", title: "Airflow ETL for Shopify orders", text: "Great pipelines", rating: 5, date: null, url: null },
        { kind: "review", title: "Fix ETL job", text: "", rating: 5, date: null, url: null },
      ],
    });
    const claimed = freelancer({ id: 2, skills: ["ETL", "Scrapy"] });
    const a = keywordRank(delivered, spec);
    const b = keywordRank(claimed, spec);
    expect(a.relevance).toBeGreaterThan(b.relevance);
    expect(a.criteria[0].fit).toBe("strong");
    expect(a.criteria[0].evidence).toContain("Airflow ETL for Shopify orders");
    expect(a.highlights).toEqual([0, 1]);
    expect(b.criteria[0].fit).toBe("partial");
  });

  it("matches plurals", () => {
    const f = freelancer({ work: [{ kind: "review", title: "Data pipelines", text: "", rating: 5, date: null, url: null }] });
    const r = keywordRank(f, { ...spec, criteria: [{ id: "p", label: "pipeline", description: "", keywords: ["pipeline"], weight: 1 }] });
    expect(r.criteria[0].fit).not.toBe("none");
  });
});

describe("qualityScore", () => {
  it("does not let one 5-star review beat a long track record", () => {
    expect(qualityScore(freelancer({ rating: 5, reviews: 1 }))).toBeLessThan(qualityScore(freelancer({ rating: 4.9, reviews: 200 })));
  });
});

describe("passesFilters", () => {
  const spec: SearchSpec = {
    brief: "",
    queries: [],
    criteria: [],
    filters: { countries: [], locationLabel: null, minRate: null, maxRate: 70, minRating: 4.5, minReviews: 5 },
  };
  it("applies rate and track-record filters", () => {
    expect(passesFilters(freelancer(), spec)).toBe(true);
    expect(passesFilters(freelancer({ hourlyRate: 90 }), spec)).toBe(false);
    expect(passesFilters(freelancer({ hourlyRate: null }), spec)).toBe(false);
    expect(passesFilters(freelancer({ reviews: 2 }), spec)).toBe(false);
    expect(passesFilters(freelancer({ rating: 4.2 }), spec)).toBe(false);
  });
});
