// Ranking and planning without an LLM. Used as the first pass before Claude re-ranks, and as
// the whole pipeline when ANTHROPIC_API_KEY is not set.

import type { CriterionScore, Fit, Freelancer, Ranking, SearchSpec } from "../shared/types.ts";
import { criterionFrom, slug } from "../shared/criteria.ts";
import { getCountries, REGION_NAMES, resolvePlace } from "./geo.ts";
import { clamp, truncate } from "./util.ts";

const STOPWORDS = new Set(
  `a an the and or but of for to in on at by with from into about as is are be been being i i'm im me my we our us you your
  it its this that these those who whom which what some any all more most less very really just also only please can could
  would should will want wants need needs needed looking look find hire hiring someone somebody person people freelancer
  freelancers contractor contractors expert experts expertise experienced experience skilled good great strong solid
  budget rate hour hourly hr per max maximum min minimum under below over above less than least up around about between
  project projects work job jobs help build building make like have has had do does done who's that's based located
  add show me more fewer remove drop without exclude only also too now then plus etc new someone's years year
  dealt deal dealing worked working handled handling used using knows know knowing familiar comfortable proven
  built created delivered shipped done ideally preferably must nice ideal`.split(/\s+/),
);

/** Lowercase word tokens with a light plural strip, so "pipelines" matches "pipeline". */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[a-z0-9][a-z0-9+#.]*[a-z0-9+#]|[a-z0-9]/g) ?? []).map(stem);
}

function stem(t: string) {
  return t.length > 4 && t.endsWith("s") && !t.endsWith("ss") ? t.slice(0, -1) : t;
}

/** A keyword matches when all of its tokens occur in the text, or all but one of 3+ tokens. */
function matches(tokens: Set<string>, keyword: string[]) {
  if (!keyword.length) return false;
  const found = keyword.filter((t) => tokens.has(t)).length;
  return found === keyword.length || (keyword.length >= 3 && found >= keyword.length - 1);
}

/** 0-100 from rating (shrunk toward 4.0 when there are few reviews), review volume and completion rate. */
export function qualityScore(f: Freelancer): number {
  const n = f.reviews;
  const bayes = ((f.rating ?? 0) * n + 4.0 * 3) / (n + 3);
  const ratingPart = clamp((bayes - 3.5) / 1.5, 0, 1);
  const volume = clamp(Math.log10(1 + n) / 2, 0, 1);
  const completion = f.completionRate ?? 0.8;
  return Math.round(100 * (0.5 * ratingPart + 0.3 * volume + 0.2 * completion));
}

export function combine(relevance: number, quality: number, method: "ai" | "keyword") {
  const w = method === "ai" ? 0.8 : 0.7;
  return Math.round(w * relevance + (1 - w) * quality);
}

export function keywordRank(f: Freelancer, spec: SearchSpec): Ranking {
  const profileTokens = new Set(tokenize(`${f.tagline} ${f.skills.join(" ")}`));
  const descTokens = new Set(tokenize(f.description));
  const workTokens = f.work.map((w) => new Set(tokenize(`${w.title} ${w.text}`)));

  const criteria = spec.criteria.length ? spec.criteria : spec.queries.map((q) => criterionFrom(q));
  const highlightHits = new Map<number, number>();
  let weighted = 0;
  let totalWeight = 0;

  const scores: CriterionScore[] = criteria.map((c) => {
    const keywords = (c.keywords.length ? c.keywords : [c.label]).map(tokenize).filter((k) => k.length);
    const inProfile = keywords.some((k) => matches(profileTokens, k));
    const inDescription = keywords.some((k) => matches(descTokens, k));
    const hits: number[] = [];
    workTokens.forEach((tokens, i) => {
      if (keywords.some((k) => matches(tokens, k))) hits.push(i);
    });
    const reviewHits = hits.filter((i) => f.work[i].kind === "review").length;
    const portfolioHits = hits.length - reviewHits;
    for (const i of hits) highlightHits.set(i, (highlightHits.get(i) ?? 0) + c.weight);

    // Delivered client work counts most; portfolio and self-description less.
    const raw = (inProfile ? 0.3 : 0) + (inDescription ? 0.2 : 0) + 0.3 * reviewHits + 0.12 * portfolioHits;
    const s = clamp(raw, 0, 1);
    weighted += s * c.weight;
    totalWeight += c.weight;

    const fit: Fit = s >= 0.6 ? "strong" : s > 0 ? "partial" : "none";
    let evidence = "No mention in profile or past work.";
    if (hits.length) {
      const w = f.work[hits[0]];
      const more = hits.length > 1 ? ` (+${hits.length - 1} more)` : "";
      evidence = `${w.kind === "review" ? "Delivered" : "Portfolio"}: "${truncate(w.title, 70)}"${more}`;
    } else if (inProfile) evidence = "Listed in skills or headline.";
    else if (inDescription) evidence = "Mentioned in profile description.";
    return { criterionId: c.id, fit, evidence };
  });

  const relevance = totalWeight ? Math.round((100 * weighted) / totalWeight) : 0;
  const quality = qualityScore(f);
  const highlights = [...highlightHits.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([i]) => i);
  const strong = scores.filter((s) => s.fit === "strong").length;
  const summary = criteria.length
    ? `${strong} of ${criteria.length} criteria strongly matched by keyword${f.enriched ? "" : " (profile only)"}.`
    : "";
  return { relevance, quality, score: combine(relevance, quality, "keyword"), method: "keyword", summary, criteria: scores, highlights };
}

// --- Planning without an LLM -------------------------------------------------------------

function findPlaces(text: string): string[] {
  const lower = ` ${text.toLowerCase().replace(/[^a-z\s]/g, " ")} `;
  const names = [...REGION_NAMES, ...getCountries().map((c) => c.name.toLowerCase()), "uk", "usa", "uae"];
  return names
    .sort((a, b) => b.length - a.length)
    .filter((n) => lower.includes(` ${n} `))
    .filter((n, i, all) => !all.slice(0, i).some((longer) => longer.includes(n)));
}

export function emptySpec(): SearchSpec {
  return {
    brief: "",
    queries: [],
    filters: { countries: [], locationLabel: null, minRate: null, maxRate: null, minRating: null, minReviews: null },
    criteria: [],
  };
}

/**
 * Turns the latest message into a spec, merging with the current one. Handles the common
 * shapes ("Python data engineer in Europe under $70/hr", "Add Scrapy", "More from Spain",
 * "Higher job success", "remove ETL") well enough to be useful without an API key.
 */
export function keywordPlan(
  message: string,
  current: SearchSpec | null,
): { spec: SearchSpec; reply: string; suggestions: string[] } {
  const spec: SearchSpec = structuredClone(current ?? emptySpec());
  const isRefinement = current !== null && current.criteria.length > 0;
  const notes: string[] = [];
  let text = message;

  const removal = text.match(/\b(?:remove|drop|without|exclude|no)\s+([\w+#. -]+)/i);
  if (removal && isRefinement) {
    const target = tokenize(removal[1]).join(" ");
    const before = spec.criteria.length;
    spec.criteria = spec.criteria.filter((c) => !tokenize(c.label).join(" ").includes(target));
    spec.queries = spec.queries.filter((q) => !tokenize(q).join(" ").includes(target));
    if (spec.criteria.length < before) notes.push(`removed "${removal[1].trim()}"`);
    text = text.replace(removal[0], " ");
  }

  const range = text.match(/\$?\s?(\d+)\s*(?:-|to)\s*\$?\s?(\d+)\s*(?:\/\s*h(?:ou)?r|per hour|an hour|\/h)?/i);
  const max = text.match(/(?:under|below|less than|<|max(?:imum)?|up to|no more than|budget(?: of)?)\s*\$?\s?(\d+)/i);
  const min = text.match(/(?:over|above|more than|>|at least|min(?:imum)?)\s*\$?\s?(\d+)/i);
  if (range && /\$|hr|hour|rate/i.test(range[0])) {
    spec.filters.minRate = Number(range[1]);
    spec.filters.maxRate = Number(range[2]);
    text = text.replace(range[0], " ");
  } else {
    if (max) {
      spec.filters.maxRate = Number(max[1]);
      text = text.replace(max[0], " ");
    }
    if (min && !/review|rating|star/i.test(text.slice(text.indexOf(min[0])))) {
      spec.filters.minRate = Number(min[1]);
      text = text.replace(min[0], " ");
    }
  }
  if (spec.filters.minRate !== current?.filters.minRate || spec.filters.maxRate !== current?.filters.maxRate) {
    const { minRate, maxRate } = spec.filters;
    notes.push(`rate ${minRate != null ? `$${minRate}` : ""}${minRate != null && maxRate != null ? "–" : maxRate != null ? "≤ " : "+"}${maxRate != null ? `$${maxRate}` : ""}/hr`);
  }

  if (/\b(higher|better|top|best)\b.*\b(job success|rated|rating|reviews?)\b|\btop[- ]rated\b|\bproven\b|\bveteran\b/i.test(text)) {
    spec.filters.minRating = Math.max(spec.filters.minRating ?? 0, 4.7);
    spec.filters.minReviews = Math.max(spec.filters.minReviews ?? 0, 10);
    notes.push("rating ≥ 4.7 with 10+ reviews");
    text = text.replace(/\b(higher|better|top|best)\b.*\b(job success|rated|rating|reviews?)\b|\btop[- ]rated\b/gi, " ");
  }

  const places = findPlaces(text);
  if (places.length) {
    spec.filters.countries = [...new Set(places.flatMap(resolvePlace))];
    spec.filters.locationLabel = places.map((p) => (p.length <= 3 ? p.toUpperCase() : titleCase(p))).join(", ");
    notes.push(`location ${spec.filters.locationLabel}`);
    for (const p of places) text = text.replace(new RegExp(`\\b${p}\\b`, "ig"), " ");
  } else if (/\b(anywhere|worldwide|any country)\b/i.test(text)) {
    spec.filters.countries = [];
    spec.filters.locationLabel = null;
    notes.push("location anywhere");
  }

  // Remaining content words, grouped into phrases at stopwords and punctuation.
  const phrases: string[] = [];
  for (const chunk of text.split(/[,.;:!?()\n/]+|\s(?:and|or|with|plus|&)\s/i)) {
    let current: string[] = [];
    for (const word of chunk.split(/\s+/)) {
      const w = word.replace(/^[^\w+#]+|[^\w+#]+$/g, "");
      if (!w || STOPWORDS.has(w.toLowerCase()) || /^\$?\d+$/.test(w) || w.toLowerCase() === "in") {
        if (current.length) phrases.push(current.join(" "));
        current = [];
      } else current.push(w);
    }
    if (current.length) phrases.push(current.join(" "));
  }
  const added: string[] = [];
  for (const phrase of phrases.slice(0, 8)) {
    const id = slug(phrase);
    if (spec.criteria.some((c) => c.id === id)) continue;
    spec.criteria.push(criterionFrom(phrase, isRefinement ? 2 : 3));
    added.push(phrase);
  }
  if (added.length) {
    spec.queries = [...new Set([...spec.queries, ...added])].slice(0, 5);
    notes.push(`added ${added.map((a) => `"${a}"`).join(", ")}`);
  }
  if (!spec.brief || !isRefinement) spec.brief = truncate(message, 300);
  else spec.brief = truncate(`${spec.brief} ${message}`, 400);

  const reply = notes.length
    ? `Keyword mode (no AI key set): ${notes.join("; ")}. Results are sorted by how often these terms appear in each freelancer's past client work.`
    : "Keyword mode couldn't find anything new to apply in that message. Try naming a skill, a country or a rate.";
  const suggestions = ["Higher job success", spec.filters.maxRate ? `Under $${Math.round(spec.filters.maxRate * 0.7)}/hr` : "Under $50/hr", "Only Europe"];
  return { spec, reply, suggestions };
}

function titleCase(s: string) {
  return s.replace(/\b\w/g, (c) => c.toUpperCase());
}
