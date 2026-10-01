// Claude does two jobs: turning the chat into a search spec (planner), and reading each
// candidate's profile and past client work to judge fit against the spec's criteria (ranker).

import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import type { ChatMessage, Criterion, Freelancer, Ranking, SearchSpec } from "../shared/types.ts";
import { resolvePlace } from "./geo.ts";
import { slug } from "../shared/criteria.ts";
import { combine, qualityScore } from "./keyword.ts";
import { clamp, truncate } from "./util.ts";

export const MODEL = process.env.CLAUDE_MODEL || "claude-opus-5-5";
const PLAN_EFFORT = (process.env.PLAN_EFFORT || "medium") as "low" | "medium" | "high";
const RANK_EFFORT = (process.env.RANK_EFFORT || "low") as "low" | "medium" | "high";

let client: Anthropic | null = null;

export function aiEnabled() {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

/** Tests swap in a stub that implements `beta.messages.parse`. */
export function setClient(c: Anthropic | null) {
  client = c;
}

function getClient() {
  client ??= new Anthropic();
  return client;
}

async function parse<T>(params: {
  system: string;
  content: Anthropic.Beta.BetaContentBlockParam[] | string;
  schema: z.ZodType<T>;
  effort: "low" | "medium" | "high";
  maxTokens: number;
}): Promise<T> {
  const response = await getClient().beta.messages.parse({
    model: MODEL,
    max_tokens: params.maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: params.effort, format: betaZodOutputFormat(params.schema) },
    system: params.system,
    messages: [{ role: "user", content: params.content }],
  });
  if (response.stop_reason === "refusal") throw new Error("Claude declined this request.");
  if (response.stop_reason === "max_tokens") throw new Error("Claude's answer was cut off (max_tokens).");
  if (!response.parsed_output) throw new Error("Claude returned output that did not match the schema.");
  return response.parsed_output as T;
}

// --- Planner -----------------------------------------------------------------------------

const PlanSchema = z.object({
  reply: z.string(),
  suggestions: z.array(z.string()),
  brief: z.string(),
  queries: z.array(z.string()),
  places: z.array(z.string()),
  minRate: z.number().nullable(),
  maxRate: z.number().nullable(),
  minRating: z.number().nullable(),
  minReviews: z.number().int().nullable(),
  criteria: z.array(
    z.object({
      label: z.string(),
      description: z.string(),
      keywords: z.array(z.string()),
      weight: z.number().int(),
    }),
  ),
});

const PLAN_SYSTEM = `You are the search planner for a freelancer search tool built on Freelancer.com. A client describes the project or person they need, in one message or over a conversation, and may paste a long job description. You turn that into a search spec. A results list on screen is re-sorted from your spec every turn, so the client refines by chatting ("Add Scrapy", "More from Spain", "Higher job success", "drop the ETL requirement").

The spec has two halves.

Retrieval (cheap, keyword based, decides who is in the candidate pool):
- queries: 2-5 short keyword queries for the Freelancer.com user directory, 1-3 words each, e.g. "python etl", "airflow", "data engineer". Cover the core skill and close synonyms so good candidates are not missed. Do not put locations or rates in queries.
- places: regions or countries the client asked for, e.g. ["Europe"], ["Spain", "Portugal"]. Supported regions: Europe, European Union, Eastern Europe, Western Europe, Southern Europe, Nordics, North America, Latin America, South America, South Asia, Southeast Asia, East Asia, Asia, Middle East, Africa, Oceania. Empty list means anywhere.
- minRate / maxRate: hourly USD bounds, or null.
- minRating (0-5) and minReviews: only when the client asks for proven or highly rated people. "Higher job success" means minRating 4.8 and minReviews 10 or more; tighten further if already set.

Ranking (Claude reads every candidate's profile and client reviews against these):
- brief: 1-3 sentences restating what the client needs in concrete terms, including domain, scale and anything that would make one candidate clearly better than another.
- criteria: 3-6 things that separate a great fit from a generic one. Prefer evidence of specific delivered work ("Built production ETL pipelines in Python", "Scraped sites with anti-bot protection") over generic skills. Each has a short label (2-5 words) for a chip, a description of what counts as evidence, 3-8 keywords that would appear in a matching profile or project title (include tool names and synonyms), and a weight: 3 = must have, 2 = important, 1 = nice to have.

When refining, start from the current spec and change only what the latest message asks for; keep the rest as is. Keep criterion labels stable when they don't change. "More from X" or "only X" replaces the location. "Add X" adds a criterion (and usually a query). 

reply: one or two sentences to the client saying what you applied, in plain words, e.g. "Searching for Python data engineers in Europe under $70/hr, ranked by delivered ETL work. Want me to weight Airflow experience?" Do not list every field.

suggestions: 3 short refinements the client might want next, written as they would type them (2-5 words each), specific to this search, e.g. "Add Airflow", "Only senior profiles", "More from Poland".`;

function specForPlanner(spec: SearchSpec | null) {
  if (!spec) return "none yet";
  return JSON.stringify(
    {
      brief: spec.brief,
      queries: spec.queries,
      places: spec.filters.locationLabel ? [spec.filters.locationLabel] : spec.filters.countries,
      minRate: spec.filters.minRate,
      maxRate: spec.filters.maxRate,
      minRating: spec.filters.minRating,
      minReviews: spec.filters.minReviews,
      criteria: spec.criteria.map(({ label, description, keywords, weight }) => ({ label, description, keywords, weight })),
    },
    null,
    1,
  );
}

export async function aiPlan(
  messages: ChatMessage[],
  current: SearchSpec | null,
): Promise<{ spec: SearchSpec; reply: string; suggestions: string[] }> {
  const transcript = messages.map((m) => `${m.role === "user" ? "Client" : "You"}: ${m.content}`).join("\n\n");
  const plan = await parse({
    system: PLAN_SYSTEM,
    content: `Current spec:\n${specForPlanner(current)}\n\nConversation so far:\n${transcript}\n\nReturn the updated spec for the client's latest message.`,
    schema: PlanSchema,
    effort: PLAN_EFFORT,
    maxTokens: 8000,
  });

  const unresolved: string[] = [];
  const countries = [
    ...new Set(
      plan.places.flatMap((p) => {
        const names = resolvePlace(p);
        if (!names.length) unresolved.push(p);
        return names;
      }),
    ),
  ];
  const usedIds = new Set<string>();
  const criteria: Criterion[] = plan.criteria.slice(0, 8).map((c) => {
    let id = slug(c.label);
    while (usedIds.has(id)) id += "-2";
    usedIds.add(id);
    return {
      id,
      label: c.label,
      description: c.description,
      keywords: c.keywords.length ? c.keywords : [c.label],
      weight: clamp(Math.round(c.weight), 1, 3) as 1 | 2 | 3,
    };
  });
  const spec: SearchSpec = {
    brief: plan.brief,
    queries: [...new Set(plan.queries.map((q) => q.trim()).filter(Boolean))].slice(0, 5),
    filters: {
      countries,
      locationLabel: countries.length ? plan.places.filter((p) => !unresolved.includes(p)).join(", ") : null,
      minRate: plan.minRate,
      maxRate: plan.maxRate,
      minRating: plan.minRating,
      minReviews: plan.minReviews,
    },
    criteria,
  };
  if (!spec.queries.length) spec.queries = criteria.slice(0, 3).map((c) => c.keywords[0] ?? c.label);
  const note = unresolved.length ? ` (Couldn't match location "${unresolved.join(", ")}", so that filter was skipped.)` : "";
  return { spec, reply: plan.reply + note, suggestions: plan.suggestions.slice(0, 4) };
}

// --- Ranker ------------------------------------------------------------------------------

const RankSchema = z.object({
  candidates: z.array(
    z.object({
      id: z.number().int(),
      overall: z.number().int(),
      summary: z.string(),
      criteria: z.array(
        z.object({
          criterionId: z.string(),
          fit: z.enum(["strong", "partial", "none"]),
          evidence: z.string(),
        }),
      ),
      highlights: z.array(z.number().int()),
    }),
  ),
});

const RANK_SYSTEM = `You screen freelancers for a client, the way an experienced technical recruiter would. For each candidate you get their Freelancer.com profile and their work history: reviews from past clients (with the project title) and portfolio items, each numbered.

Judge every candidate against every criterion:
- strong: direct evidence they have delivered this kind of work: a client review or project title about it, or a detailed portfolio item.
- partial: they claim it in their headline or description, or did closely adjacent work.
- none: no real evidence. Skill lists alone are weak evidence: many freelancers list hundreds of skills. A long generic description is not evidence either.

evidence: the specific fact behind your call in at most 20 words. Quote project titles in double quotes, e.g. Delivered "Airflow ETL for Shopify orders" (5.0★). For none, say what is missing.
overall: 0-10, how well this person fits the brief overall, judged as the client would: depth and recency of directly relevant work first, then track record. 8-10 means you'd put them on a shortlist; 5-7 plausible; 0-4 not a fit.
summary: one sentence, at most 25 words, on why they do or don't fit. Be specific to this person; don't repeat the brief.
highlights: up to 3 work item numbers most relevant to the brief, best first. Empty if none are relevant.

Return one entry per candidate, using the candidate's id, and one criteria entry per criterion id.`;

function describe(f: Freelancer): string {
  const facts = [
    f.country,
    f.hourlyRate != null ? `$${f.hourlyRate}/hr` : null,
    f.rating != null ? `${f.rating.toFixed(1)}★ from ${f.reviews} reviews` : "no reviews yet",
    f.completionRate != null ? `${Math.round(f.completionRate * 100)}% completion` : null,
  ].filter(Boolean);
  const lines = [
    `<candidate id="${f.id}">`,
    `${f.displayName} (@${f.username}) | ${facts.join(" | ")}`,
    `Headline: ${f.tagline || "none"}`,
    `Skills listed (${f.skills.length}): ${f.skills.slice(0, 25).join(", ")}${f.skills.length > 25 ? ", …" : ""}`,
    `About: ${truncate(f.description, 900) || "none"}`,
  ];
  const reviews = f.work.map((w, i) => ({ w, i })).filter(({ w }) => w.kind === "review").slice(0, 20);
  const portfolio = f.work.map((w, i) => ({ w, i })).filter(({ w }) => w.kind === "portfolio").slice(0, 8);
  lines.push(reviews.length ? "Client reviews, newest first:" : "Client reviews: none");
  for (const { w, i } of reviews) {
    const rating = w.rating != null ? ` ${w.rating.toFixed(1)}★` : "";
    lines.push(`[${i}] "${truncate(w.title, 100)}"${rating}${w.text ? ` "${truncate(w.text, 220)}"` : ""}`);
  }
  if (portfolio.length) lines.push("Portfolio:");
  for (const { w, i } of portfolio) lines.push(`[${i}] "${truncate(w.title, 100)}" ${truncate(w.text, 200)}`);
  lines.push("</candidate>");
  return lines.join("\n");
}

function specBlock(spec: SearchSpec) {
  const criteria = spec.criteria
    .map((c) => `- id "${c.id}" (weight ${c.weight}/3): ${c.label}. ${c.description}`)
    .join("\n");
  return `Client brief: ${spec.brief}\n\nCriteria:\n${criteria}`;
}

const FIT_VALUE = { strong: 1, partial: 0.45, none: 0 } as const;

/** Scores a batch of enriched freelancers. Returns rankings keyed by freelancer id. */
export async function aiRank(spec: SearchSpec, batch: Freelancer[]): Promise<Map<number, Ranking>> {
  const result = await parse({
    system: RANK_SYSTEM,
    content: [
      { type: "text", text: specBlock(spec), cache_control: { type: "ephemeral" } },
      { type: "text", text: `Candidates:\n\n${batch.map(describe).join("\n\n")}` },
    ],
    schema: RankSchema,
    effort: RANK_EFFORT,
    maxTokens: 16000,
  });

  const out = new Map<number, Ranking>();
  for (const c of result.candidates) {
    const f = batch.find((b) => b.id === c.id);
    if (!f) continue;
    const scores = spec.criteria.map((crit) => {
      const s = c.criteria.find((x) => x.criterionId === crit.id);
      return { criterionId: crit.id, fit: s?.fit ?? "none", evidence: s?.evidence ?? "" };
    });
    const totalWeight = spec.criteria.reduce((sum, crit) => sum + crit.weight, 0);
    const criteriaPart = totalWeight
      ? spec.criteria.reduce((sum, crit, i) => sum + crit.weight * FIT_VALUE[scores[i].fit], 0) / totalWeight
      : 0;
    const overall = clamp(c.overall, 0, 10) / 10;
    const relevance = Math.round(100 * (totalWeight ? 0.6 * criteriaPart + 0.4 * overall : overall));
    const quality = qualityScore(f);
    out.set(f.id, {
      relevance,
      quality,
      score: combine(relevance, quality, "ai"),
      method: "ai",
      summary: c.summary,
      criteria: scores,
      highlights: c.highlights.filter((i) => i >= 0 && i < f.work.length).slice(0, 3),
    });
  }
  return out;
}
