import { vi } from "vitest";

/** A raw Freelancer.com directory user. */
export function rawUser(id: number, over: Record<string, unknown> = {}) {
  return {
    id,
    username: `user${id}`,
    public_name: `User ${id}`,
    tagline: "Python developer",
    profile_description: "I build data pipelines.",
    hourly_rate: 40,
    location: { country: { name: "Spain", code: "es" }, city: "Madrid" },
    reputation: { entire_history: { overall: 4.9, reviews: 20, complete: 20, all: 20, completion_rate: 1, on_time: 1, on_budget: 1 } },
    jobs: [{ name: "Python" }],
    qualifications: [],
    ...over,
  };
}

/** Stubs fetch for Freelancer.com and Jev. `jev` receives each request body and returns its answers. */
export function stubApis(users: any[], jev: (body: any) => Record<string, unknown>) {
  const calls: { url: string; body?: any }[] = [];
  vi.stubGlobal("fetch", async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    const ok = (result: unknown) => new Response(JSON.stringify({ status: "success", result }), { status: 200 });
    if (url.includes("/users/0.1/users/directory/")) return ok({ users, total_count: users.length });
    if (url.includes("/projects/0.1/reviews/")) {
      const id = Number(new URL(url).searchParams.get("to_users[]"));
      return ok({
        reviews: [
          { review_context: { context_name: `Airflow ETL pipeline for client of ${id}`, seo_url: "projects/x" }, description: "Great work", rating: 5, time_submitted: 1780000000 },
          { review_context: { context_name: "Logo design" }, description: "", rating: 4, time_submitted: 1770000000 },
        ],
      });
    }
    if (url.includes("/users/0.1/portfolios/")) return ok({ portfolios: {} });
    if (url.startsWith("https://api.typesafe.ai/")) {
      return new Response(JSON.stringify({ model: "jev-test", answers: jev(body), usage: { input_tokens: 1, output_tokens: 1 } }), { status: 200 });
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  return calls;
}

export function scoreAnswer(level: 0 | 1 | 2 | 3, confidence = 0.9) {
  const probabilities: Record<string, number> = { "0": 0, "1": 0, "2": 0, "3": 0 };
  probabilities[String(level)] = 1;
  return { type: "score", score: level, probabilities, confidence };
}
