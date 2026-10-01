// Screening with Jev (TypeSafe's System One model, https://docs.typesafe.ai). One request per
// candidate: the state is their profile and work history; the questions are one Score per
// criterion, a yes/no on overall fit, and a Choice of the most relevant past project. Jev
// returns calibrated probabilities, so the numbers are comparable across candidates.

import type { Criterion, CriterionScore, Fit, Freelancer, Ranking, Spec } from "../shared/types.ts";
import { clamp, truncate } from "./util.ts";

const API = "https://api.typesafe.ai/v1/systemone";
const MAX_IN_FLIGHT = 16;

const LEVELS = [
  "No evidence of this anywhere in the profile or work history",
  "Only self-claimed: listed in skills, headline or bio, with no past project showing it",
  "Related or adjacent delivered work, or a detailed portfolio item showing it",
  "Directly delivered this for clients: named in past client project titles or reviews",
];
const FIT_BY_LEVEL: Fit[] = ["none", "claimed", "adjacent", "direct"];
const SHORT = ["No evidence", "Claimed only", "Related work", "Delivered for clients"];

export function jevEnabled() {
  return Boolean(process.env.TYPESAFE_API_KEY);
}

let inFlight = 0;
const waiting: (() => void)[] = [];
async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((r) => waiting.push(r));
  inFlight++;
  try {
    return await fn();
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

/** What Jev reads about a candidate. Work items keep their index so answers can point at them. */
export function candidateState(f: Freelancer) {
  const reviews = f.work.map((w, i) => ({ w, i })).filter(({ w }) => w.kind === "review").slice(0, 25);
  const portfolio = f.work.map((w, i) => ({ w, i })).filter(({ w }) => w.kind === "portfolio").slice(0, 10);
  return {
    headline: f.tagline,
    location: [f.city, f.country].filter(Boolean).join(", "),
    hourly_rate_usd: f.hourlyRate,
    rating: f.rating,
    review_count: f.reviews,
    self_listed_skills: f.skills.slice(0, 40),
    certifications: f.qualifications.slice(0, 10),
    bio: truncate(f.description, 3000),
    past_client_projects: reviews.map(({ w, i }) => ({
      id: `p${i}`,
      title: w.title,
      client_rating: w.rating,
      client_review: truncate(w.text, 400),
    })),
    portfolio: portfolio.map(({ w, i }) => ({ id: `p${i}`, title: w.title, description: truncate(w.text, 400) })),
  };
}

function questions(spec: Spec, f: Freelancer, state: ReturnType<typeof candidateState>) {
  const q: Record<string, unknown> = {};
  for (const c of spec.criteria) {
    q[`c:${c.id}`] = {
      type: "score",
      instructions: {
        requirement: c.description,
        question: "How strong is the evidence in this freelancer's profile and past work that they meet `requirement`?",
      },
      criteria: LEVELS,
    };
  }
  q.fit = {
    type: "noul",
    instructions: {
      client_need: spec.brief,
      question: "Judging by the work they have actually delivered, would an expert recruiter shortlist this freelancer for `client_need`?",
    },
  };
  const items = [...state.past_client_projects, ...state.portfolio];
  if (items.length) {
    q.best = {
      type: "choice",
      instructions: { client_need: spec.brief, question: "Which past project is most relevant to `client_need`?" },
      criteria: { none: "None of them is relevant", ...Object.fromEntries(items.map((it) => [it.id, truncate(it.title, 120)])) },
    };
  }
  return q;
}

async function call(body: unknown, signal?: AbortSignal): Promise<any> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(API, {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.TYPESAFE_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ?? AbortSignal.timeout(60_000),
    });
    if ((res.status === 429 || res.status === 529 || res.status >= 500) && attempt < 4) {
      const wait = Number(res.headers.get("retry-after")) * 1000 || 500 * 2 ** attempt;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    const json = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`Jev ${res.status}: ${JSON.stringify(json?.detail ?? json ?? res.statusText).slice(0, 200)}`);
    return json;
  }
}

/** 0-100 from rating (shrunk toward 4.0 when there are few reviews), review volume and completion. */
export function trackRecord(f: Freelancer): number {
  const n = f.reviews;
  const bayes = ((f.rating ?? 0) * n + 4.0 * 3) / (n + 3);
  const ratingPart = clamp((bayes - 3.5) / 1.5, 0, 1);
  const volume = clamp(Math.log10(1 + n) / 2, 0, 1);
  return Math.round(100 * (0.5 * ratingPart + 0.3 * volume + 0.2 * (f.completionRate ?? 0.8)));
}

/** Turns Jev's answers into a ranking. Exported for tests. */
export function toRanking(spec: Spec, f: Freelancer, answers: Record<string, any>): Ranking {
  let weighted = 0;
  let totalWeight = 0;
  const confidences: number[] = [];
  const criteria: CriterionScore[] = spec.criteria.map((c: Criterion) => {
    const a = answers[`c:${c.id}`];
    const level = clamp(Number(a?.score ?? 0), 0, 3);
    if (typeof a?.confidence === "number") confidences.push(a.confidence);
    weighted += (level / 3) * c.weight;
    totalWeight += c.weight;
    const top = Number(Object.entries<number>(a?.probabilities ?? { 0: 1 }).sort((x, y) => y[1] - x[1])[0][0]);
    const fit = FIT_BY_LEVEL[top] ?? "none";
    const p = Math.round(100 * (a?.probabilities?.[String(top)] ?? 0));
    return { criterionId: c.id, fit, evidence: `${SHORT[top]} · ${p}% likely` };
  });

  const fit = clamp(Number(answers.fit?.noul ?? 0), 0, 1);
  const criteriaPart = totalWeight ? weighted / totalWeight : fit;
  const relevance = 100 * (0.7 * criteriaPart + 0.3 * fit);
  const score = Math.round(0.85 * relevance + 0.15 * trackRecord(f));

  const best = answers.best?.choice as string | undefined;
  const bestIndex = best && best !== "none" ? Number(best.slice(1)) : NaN;
  const highlights = Number.isInteger(bestIndex) && f.work[bestIndex] ? [bestIndex] : [];
  const summary =
    highlights.length > 0
      ? `Most relevant past work: "${truncate(f.work[highlights[0]].title, 90)}".`
      : "No past project stood out as relevant.";
  const confidence = confidences.length ? confidences.reduce((a, b) => a + b, 0) / confidences.length : null;
  return { score, source: "jev", verdict: null, summary, criteria, highlights, confidence };
}

export async function screen(spec: Spec, f: Freelancer, signal?: AbortSignal): Promise<Ranking> {
  const state = candidateState(f);
  const json = await slot(() => call({ model: "jev-latest", state, questions: questions(spec, f, state) }, signal));
  return toRanking(spec, f, json.answers ?? {});
}
