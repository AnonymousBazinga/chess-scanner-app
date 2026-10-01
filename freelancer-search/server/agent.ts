// The sourcing agent. A Pi agent loop (https://github.com/earendil-works/pi) with tools to build
// a candidate pool on Freelancer.com, screen it with Jev, read promising profiles in depth, check
// GitHub and personal sites, and record evidence-backed verdicts that reorder the results list.

import { Agent, type AgentMessage, type AgentTool, type StreamFn } from "@earendil-works/pi-agent-core";
import { createModels, Type, type Model, type TSchema } from "@earendil-works/pi-ai";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import { azureOpenAIResponsesProvider } from "@earendil-works/pi-ai/providers/azure-openai-responses";
import { slug } from "../shared/criteria.ts";
import type { Criterion, Fit, Freelancer, Ranking } from "../shared/types.ts";
import { searchDirectory } from "./freelancer.ts";
import { resolvePlace } from "./geo.ts";
import { candidateState } from "./jev.ts";
import type { Session } from "./session.ts";
import { clamp, truncate } from "./util.ts";
import { fetchPage, githubProfile, githubSearch } from "./web.ts";

export const PROVIDER = process.env.LLM_PROVIDER || "azure-openai-responses";
export const MODEL_ID = process.env.LLM_MODEL || "gpt-5.5";
const THINKING = (process.env.AGENT_THINKING || "medium") as "low" | "medium" | "high";

const models = createModels();
models.setProvider(azureOpenAIResponsesProvider());
models.setProvider(anthropicProvider());

export function getModel(): Model<any> | undefined {
  return models.getModel(PROVIDER as any, MODEL_ID);
}

/** Environment variables the agent needs that are not set. */
export function missingConfig(): string[] {
  const missing: string[] = [];
  if (!process.env.TYPESAFE_API_KEY) missing.push("TYPESAFE_API_KEY (Jev, for screening)");
  if (PROVIDER === "azure-openai-responses") {
    if (!process.env.AZURE_OPENAI_API_KEY) missing.push("AZURE_OPENAI_API_KEY");
    if (!process.env.AZURE_OPENAI_BASE_URL && !process.env.AZURE_OPENAI_RESOURCE_NAME) missing.push("AZURE_OPENAI_BASE_URL");
  } else if (PROVIDER === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
    missing.push("ANTHROPIC_API_KEY");
  }
  if (!getModel()) missing.push(`a known model (LLM_PROVIDER=${PROVIDER}, LLM_MODEL=${MODEL_ID})`);
  return missing;
}

export const SYSTEM_PROMPT = `You are Talent Scout, a sourcing agent that finds freelancers on Freelancer.com for a client.

The client sees two things: this chat, and a results list showing every candidate in your pool, ordered by score. Your job is to make that ordering excellent for the client's specific niche, so the people who have demonstrably done this kind of work before rise to the top. You are not picking one or two people. The client browses the list.

How to work:
1. Understand the need. Turn the client's message, or the job post they pasted, into a precise brief and 3-6 weighted criteria with set_search_criteria. Criteria describe demonstrated work in the niche ("Built scrapers that get past Cloudflare for e-commerce clients"), not generic skills ("Knows Python"). Weight 3 = must have, 2 = important, 1 = nice to have. Set location, rate or rating filters only when the client asks for them.
2. Build a broad pool. The directory is a keyword search, so run search_freelancers several times (usually 4-8 queries) with different phrasings: the core skill, specific tool names, adjacent niche terms, job titles. Take page 2 of queries that keep returning new relevant people. Aim for roughly 150-400 candidates.
3. Screen. screen_candidates has Jev read every unscreened candidate's profile and client project history and score each criterion. You get the top of the ranking back. Use list_candidates to see further down.
4. Investigate. inspect_freelancer on the 10-15 most promising, about 5 in parallel per turn, and record verdicts for each batch before inspecting the next (the client watches the list update, and dossiers you've judged are dropped from your context). Read their actual client projects and reviews. Check that the best evidence is real, relevant and recent. When craft matters (software, data, design) and they mention GitHub or have a distinctive name, try github_lookup, and count an account only once you've confirmed it's theirs (matching name, location, bio or projects). Use fetch_page for sites they mention.
5. Record a verdict with record_assessment for every candidate you inspected. Your verdict replaces Jev's score for that person in the list.
6. If screening shows few strong matches, search from new angles and screen again before investigating.
7. Finish with suggest_followups, then reply.

Refinements: each new message builds on the current search; don't start over. "Add X" means adding a criterion (set_search_criteria with the full updated list; this clears scores, so screen again), searching specifically for X, then re-checking the top. A location or rate request means updating the filters; screened scores are kept and the list re-filters. If the message only changes how strict to be ("higher job success"), adjust filters and don't redo the whole search. Lines in square brackets at the start of a client message describe what the client changed in the interface since their last message.

Evidence standards:
- Delivered client work (project titles and client reviews) is the strongest evidence; portfolio items next; bio claims and skill lists are weak, since many profiles list hundreds of skills.
- Never invent facts. Quote project titles exactly as written.
- LinkedIn pages usually can't be fetched; don't rely on them.
- Freelancer.com removes links from profiles, so a "GitHub" mention needs a lookup.

Score calibration for record_assessment: 90-100 = several directly relevant client projects with strong reviews; 75-89 = clearly done this before; 55-74 = plausible, with gaps; below 55 = weak or not a fit.

Reply style: the list is the main output; the chat explains it. Write 3-6 short sentences or a few short bullets: what you searched and screened, the standouts by name and why (one line each), and anything you couldn't verify. Plain language, no tables, no headings.`;

// --- Tool helpers ------------------------------------------------------------------------

const FIT_SHORT: Record<Fit, string> = { direct: "direct", adjacent: "adjacent", claimed: "claimed only", none: "none" };

function line(session: Session, f: Freelancer) {
  const r = session.ranking(f.id);
  const facts = [
    f.hourlyRate != null ? `$${f.hourlyRate}/hr` : "rate n/a",
    f.country ?? "?",
    f.rating != null ? `${f.rating.toFixed(1)}★ (${f.reviews})` : "no reviews",
  ].join(" · ");
  let scoring = "not screened";
  if (r?.error) scoring = `screening failed: ${r.error}`;
  else if (r) {
    const fits = r.criteria
      .map((c) => `${session.spec.criteria.find((x) => x.id === c.criterionId)?.label ?? c.criterionId}: ${FIT_SHORT[c.fit]}`)
      .join(", ");
    const best = r.highlights.length ? ` · best: "${truncate(f.work[r.highlights[0]]?.title ?? "", 70)}"` : "";
    scoring = `score ${r.score}${r.source === "agent" ? ` (your verdict: ${r.verdict})` : ""} [${fits}]${best}`;
  }
  return `#${f.id} ${f.displayName} (@${f.username}) · ${truncate(f.tagline, 60)} · ${facts} · ${scoring}`;
}

function text(t: string, summary?: string, tone?: "good" | "warn" | "muted") {
  return { content: [{ type: "text" as const, text: t }], details: { summary: summary ?? "", tone } };
}

function find(session: Session, id: number) {
  const f = session.pool.get(id);
  if (!f) throw new Error(`#${id} is not in the pool. Use ids from search or screening results.`);
  return f;
}

const Nullable = <T extends ReturnType<typeof Type.Number>>(t: T, description: string) =>
  Type.Optional(Type.Union([t, Type.Null()], { description }));

/** Keeps each tool's parameter types while collecting them in one array. */
function defineTool<T extends TSchema>(tool: AgentTool<T>): AgentTool<any> {
  return tool as AgentTool<any>;
}

export function buildTools(session: Session, progress: (toolCallId: string, detail: string) => void): AgentTool<any>[] {
  const setCriteria = defineTool({
    name: "set_search_criteria",
    label: "Set criteria",
    description:
      "Set the brief and the full list of ranking criteria (replaces the previous list), and optionally the hard filters. Changing the brief or criteria clears all scores, so screen again afterwards. Omit a filter field to leave it unchanged; pass null to clear it.",
    parameters: Type.Object({
      brief: Type.String({ description: "1-3 sentences on what the client needs, concrete enough to judge candidates against." }),
      criteria: Type.Array(
        Type.Object({
          label: Type.String({ description: "2-5 word chip label" }),
          description: Type.String({ description: "What counts as evidence of this in a profile or past project." }),
          weight: Type.Integer({ description: "3 = must have, 2 = important, 1 = nice to have" }),
        }),
      ),
      location: Type.Optional(
        Type.Array(Type.String(), {
          description: "Regions (Europe, Eastern Europe, Latin America, South Asia, ...) or countries. Empty array = anywhere.",
        }),
      ),
      min_rate: Nullable(Type.Number(), "Minimum hourly rate in USD"),
      max_rate: Nullable(Type.Number(), "Maximum hourly rate in USD"),
      min_rating: Nullable(Type.Number(), "Minimum overall rating, 0-5"),
      min_reviews: Nullable(Type.Number(), "Minimum number of client reviews"),
    }),
    async execute(_id, p) {
      const used = new Set<string>();
      const criteria: Criterion[] = p.criteria.slice(0, 8).map((c: any) => {
        let id = slug(c.label);
        while (used.has(id)) id += "-2";
        used.add(id);
        return { id, label: c.label, description: c.description, weight: clamp(Math.round(c.weight), 1, 3) as 1 | 2 | 3 };
      });
      const changed = session.setSpec({ brief: p.brief, criteria });

      const filters = { ...session.filters };
      const notes: string[] = [];
      if (p.location !== undefined) {
        const unresolved: string[] = [];
        filters.countries = [...new Set<string>(p.location.flatMap((place: string) => {
          const names = resolvePlace(place);
          if (!names.length) unresolved.push(place);
          return names;
        }))];
        filters.locationLabel = filters.countries.length ? p.location.filter((x: string) => !unresolved.includes(x)).join(", ") : null;
        if (unresolved.length) notes.push(`Unknown location(s) ignored: ${unresolved.join(", ")}.`);
      }
      if (p.min_rate !== undefined) filters.minRate = p.min_rate;
      if (p.max_rate !== undefined) filters.maxRate = p.max_rate;
      if (p.min_rating !== undefined) filters.minRating = p.min_rating;
      if (p.min_reviews !== undefined) filters.minReviews = p.min_reviews;
      session.setFilters(filters);

      const where = [filters.locationLabel, filters.maxRate != null ? `under $${filters.maxRate}/hr` : null].filter(Boolean).join(", ");
      const summary = where ? `filtered to ${where}` : "";
      const ids = criteria.map((c) => `${c.id} (${c.label}, weight ${c.weight})`).join("; ");
      return text(
        `${changed ? "Criteria updated; all scores were cleared, so call screen_candidates." : "Criteria unchanged."} Criterion ids for record_assessment: ${ids}. Filters now: ${JSON.stringify(filters)}. ${notes.join(" ")}`,
        summary,
      );
    },
  });

  const search = defineTool({
    name: "search_freelancers",
    label: "Search",
    description:
      "Keyword search of the Freelancer.com directory (up to 100 per page). Respects the current location and rate filters. New people join the candidate pool. Returns the new candidates.",
    parameters: Type.Object({
      query: Type.String({ description: "1-4 keywords, e.g. 'airflow etl' or 'shopify migration'" }),
      page: Type.Optional(Type.Integer({ description: "1-based page number, default 1" })),
    }),
    async execute(_id, p) {
      const page = Math.max(1, p.page ?? 1);
      const { users, total } = await searchDirectory(p.query, session.filters, 100, (page - 1) * 100);
      const added = session.addToPool(users);
      const summary = `${added.length} new`;
      const lines = added.slice(0, 40).map((f) => line(session, f));
      return text(
        `"${p.query}" page ${page}: ${users.length} results of ${total} total matches; ${added.length} new to the pool (pool is now ${session.pool.size}).\n${lines.join("\n")}${added.length > 40 ? `\n…and ${added.length - 40} more` : ""}`,
        summary,
      );
    },
  });

  const screenTool = defineTool({
    name: "screen_candidates",
    label: "Screen",
    description:
      "Fetch work histories and have Jev score every unscreened candidate in the pool (within the filters) against the criteria. Returns the top of the ranking and counts.",
    parameters: Type.Object({ top: Type.Optional(Type.Integer({ description: "How many top candidates to return, default 25" })) }),
    async execute(toolCallId, p, signal) {
      if (!session.spec.criteria.length) throw new Error("Set criteria with set_search_criteria first.");
      progress(toolCallId, "fetching work histories");
      const { screened, failures } = await session.screenPool((done, total) => progress(toolCallId, `${done} of ${total}`), signal);
      const ranked = session.ranked();
      const direct = ranked.filter(({ r }) =>
        r?.criteria.some((c) => c.fit === "direct" && session.spec.criteria.find((x) => x.id === c.criterionId)?.weight === 3),
      ).length;
      const top = ranked.slice(0, clamp(p.top ?? 25, 5, 60)).map(({ f }) => line(session, f));
      const failNote = failures.length ? `\n${failures.length} failed (${failures[0].error}); they show as unscored in the list.` : "";
      return text(
        `Screened ${screened} new candidates. ${ranked.length} in the list after filters; ${direct} have direct evidence for a must-have.${failNote}\nTop:\n${top.join("\n")}`,
        `${screened} screened${failures.length ? `, ${failures.length} failed` : ""}, ${direct} with delivered work on a must-have`,
      );
    },
  });

  const list = defineTool({
    name: "list_candidates",
    label: "List",
    description: "Read the current ranked list (after filters), e.g. to look further down than the top.",
    parameters: Type.Object({
      offset: Type.Optional(Type.Integer()),
      limit: Type.Optional(Type.Integer({ description: "Default 30, max 60" })),
    }),
    async execute(_id, p) {
      const ranked = session.ranked();
      const offset = Math.max(0, p.offset ?? 0);
      const rows = ranked.slice(offset, offset + clamp(p.limit ?? 30, 1, 60));
      return text(`${ranked.length} candidates after filters. Rows ${offset + 1}-${offset + rows.length}:\n${rows.map(({ f }) => line(session, f)).join("\n")}`);
    },
  });

  const inspect = defineTool({
    name: "inspect_freelancer",
    label: "Inspect",
    description: "Read one candidate's full profile, every client review and portfolio item, certifications, and Jev's screening.",
    parameters: Type.Object({ id: Type.Integer() }),
    async execute(_id, p) {
      const f = find(session, p.id);
      await session.ensureEnriched([f]);
      const state = candidateState(f);
      const mentions = [...new Set((`${f.description} ${f.work.map((w) => w.text).join(" ")}`.match(/\b(github|gitlab|linkedin|behance|dribbble|kaggle|stack ?overflow|portfolio site|website)\b/gi) ?? []).map((m) => m.toLowerCase()))];
      const dossier = {
        id: f.id,
        name: f.displayName,
        username: f.username,
        member_since: f.registeredAt ? new Date(f.registeredAt * 1000).toISOString().slice(0, 7) : null,
        completion_rate: f.completionRate,
        on_time: f.onTime,
        on_budget: f.onBudget,
        ...state,
        bio: truncate(f.description, 4000),
        past_client_projects: f.work
          .map((w, i) => ({ w, i }))
          .filter(({ w }) => w.kind === "review")
          .slice(0, 30)
          .map(({ w, i }) => ({ id: `p${i}`, title: w.title, rating: w.rating, date: w.date ? new Date(w.date * 1000).toISOString().slice(0, 7) : null, review: truncate(w.text, 350) })),
        mentions_external_profiles: mentions,
        known_links: f.links,
        criterion_ids: session.spec.criteria.map((c) => `${c.id} = ${c.label}`),
        current_screening: line(session, f),
      };
      return text(JSON.stringify(dossier), `${f.work.length} items`);
    },
  });

  const github = defineTool({
    name: "github_lookup",
    label: "GitHub",
    description:
      "Search GitHub accounts by name or handle (pass query), or read one account's profile, languages and top repositories (pass login). Confirm identity before using it as evidence.",
    parameters: Type.Object({
      query: Type.Optional(Type.String({ description: "Name or handle to search for" })),
      login: Type.Optional(Type.String({ description: "Exact GitHub login to read" })),
    }),
    async execute(_id, p) {
      if (p.login) {
        const profile = await githubProfile(p.login);
        if (!profile) return text(`No GitHub account "${p.login}".`, "not found");
        return text(JSON.stringify(profile), `${profile.publicRepos} public repos`);
      }
      if (!p.query) throw new Error("Pass query or login.");
      const hits = await githubSearch(p.query);
      return text(hits.length ? JSON.stringify(hits) : "No accounts found.", `${hits.length} accounts`);
    },
  });

  const page = defineTool({
    name: "fetch_page",
    label: "Fetch",
    description: "Fetch a public web page (a candidate's site, a project they built) and read its text.",
    parameters: Type.Object({ url: Type.String() }),
    async execute(_id, p) {
      const r = await fetchPage(p.url);
      return text(`${r.title}\n${r.url}\n\n${r.text}`, r.title || new URL(r.url).hostname);
    },
  });

  const record = defineTool({
    name: "record_assessment",
    label: "Assess",
    description:
      "Record your verdict on a candidate you inspected. It replaces Jev's score in the client's list and shows your summary and per-criterion evidence on their card.",
    parameters: Type.Object({
      id: Type.Integer(),
      verdict: Type.Union([Type.Literal("shortlist"), Type.Literal("maybe"), Type.Literal("reject")]),
      score: Type.Integer({ description: "0-100, see calibration in your instructions" }),
      summary: Type.String({ description: "One or two sentences for the client: why they do or don't fit, with specifics." }),
      criteria: Type.Array(
        Type.Object({
          criterion_id: Type.String({ description: "The criterion's id, as listed by set_search_criteria and inspect_freelancer" }),
          fit: Type.Union([Type.Literal("direct"), Type.Literal("adjacent"), Type.Literal("claimed"), Type.Literal("none")]),
          evidence: Type.String({ description: "The fact behind the call in at most 20 words; quote project titles." }),
        }),
      ),
      highlight_projects: Type.Optional(Type.Array(Type.String({ description: "Work item ids like p3, most relevant first" }))),
      links: Type.Optional(
        Type.Array(Type.Object({ label: Type.String(), url: Type.String() }), {
          description: "Verified external profiles, e.g. their GitHub",
        }),
      ),
    }),
    async execute(_id, p) {
      const f = find(session, p.id);
      const highlights = (p.highlight_projects ?? [])
        .map((h: string) => Number(String(h).replace(/^p/, "")))
        .filter((i: number) => Number.isInteger(i) && f.work[i])
        .slice(0, 3);
      const ranking: Ranking = {
        score: clamp(Math.round(p.score), 0, 100),
        source: "agent",
        verdict: p.verdict,
        summary: p.summary,
        criteria: session.spec.criteria.map((c) => {
          // Accept the id or the label; fall back to Jev's call for anything the verdict leaves out.
          const given = p.criteria.find((x) => x.criterion_id === c.id || slug(x.criterion_id) === c.id);
          const screened = session.screened.get(f.id)?.criteria.find((x) => x.criterionId === c.id);
          if (given) return { criterionId: c.id, fit: given.fit, evidence: given.evidence };
          return screened ?? { criterionId: c.id, fit: "none" as const, evidence: "" };
        }),
        highlights: highlights.length ? highlights : (session.screened.get(f.id)?.highlights ?? []),
        confidence: null,
      };
      session.recordAssessment(f.id, ranking);
      if (p.links?.length) session.setLinks(f.id, p.links);
      return text(
        `Recorded ${p.verdict} (${ranking.score}) for #${f.id}.`,
        `Scored ${ranking.score}: ${truncate(p.summary, 140)}`,
        p.verdict === "shortlist" ? "good" : p.verdict === "maybe" ? "warn" : "muted",
      );
    },
  });

  const followups = defineTool({
    name: "suggest_followups",
    label: "Suggest",
    description: "Offer the client 2-4 short refinements they might want next, phrased as they would type them (e.g. 'Add Airflow', 'Only Eastern Europe').",
    parameters: Type.Object({ suggestions: Type.Array(Type.String()) }),
    async execute(_id, p) {
      session.setSuggestions(p.suggestions.slice(0, 4));
      return text("Shown to the client.");
    },
  });

  return [setCriteria, search, screenTool, list, inspect, github, page, record, followups];
}

export interface ToolStep {
  /** Reads fold into one line when the turn settles; writes stay as receipts. */
  kind: "read" | "write";
  /** Present tense, shown while the step runs. Always names its subject. */
  running: string;
  /** Past tense, shown once it has answered. */
  done: string;
}

/** How a tool call reads in the chat. Null hides it. */
export function describeTool(session: Session, name: string, args: any): ToolStep | null {
  const who = (id: number) => session.pool.get(id)?.displayName ?? `#${id}`;
  const quoted = (q: string) => `\u201c${q}\u201d`;
  switch (name) {
    case "set_search_criteria":
      return { kind: "write", running: "Writing the criteria", done: `Ranking by ${(args.criteria ?? []).map((c: any) => c.label).join(", ")}` };
    case "search_freelancers": {
      const page = args.page > 1 ? `, page ${args.page}` : "";
      return { kind: "read", running: `Searching ${quoted(args.query)}${page}`, done: `Searched ${quoted(args.query)}${page}` };
    }
    case "screen_candidates":
      return { kind: "read", running: "Screening the pool with Jev", done: "Screened the pool with Jev" };
    case "list_candidates":
      return { kind: "read", running: "Reading the ranking", done: "Read the ranking" };
    case "inspect_freelancer":
      return { kind: "read", running: `Reading ${who(args.id)}'s work history`, done: `Read ${who(args.id)}'s work history` };
    case "github_lookup":
      return args.login
        ? { kind: "read", running: `Reading GitHub ${args.login}`, done: `Read GitHub ${args.login}` }
        : { kind: "read", running: `Looking for ${quoted(args.query)} on GitHub`, done: `Looked for ${quoted(args.query)} on GitHub` };
    case "fetch_page": {
      let host = "a web page";
      try {
        host = new URL(args.url).hostname;
      } catch {}
      return { kind: "read", running: `Opening ${host}`, done: `Opened ${host}` };
    }
    case "record_assessment": {
      const verdict = args.verdict === "shortlist" ? "Shortlisted" : args.verdict === "maybe" ? "Marked maybe:" : "Ruled out";
      return { kind: "write", running: `Judging ${who(args.id)}`, done: `${verdict} ${who(args.id)}` };
    }
    default:
      return null;
  }
}

const TRIM_AFTER_TURNS = 3;
const TRIMMED_LENGTH: Record<string, number> = {
  inspect_freelancer: 200,
  search_freelancers: 400,
  screen_candidates: 1200,
  list_candidates: 600,
  github_lookup: 600,
  fetch_page: 400,
};

/**
 * Keeps the context small, which matters because every turn resends it. Tool output older than a
 * few turns is shortened; a profile dossier is kept until the agent has recorded a verdict on that
 * person, then shortened too. The agent can always call the tool again.
 */
export function pruneContext(messages: AgentMessage[]): AgentMessage[] {
  const assistants = messages.flatMap((m, i) => ((m as any).role === "assistant" ? [i] : []));
  const cutoff = assistants.length > TRIM_AFTER_TURNS ? assistants[assistants.length - TRIM_AFTER_TURNS] : 0;
  const inspectedId = new Map<string, number>();
  const assessed = new Set<number>();
  for (const m of messages as any[]) {
    if (m.role !== "assistant") continue;
    for (const b of m.content) {
      if (b.type !== "toolCall") continue;
      if (b.name === "inspect_freelancer") inspectedId.set(b.id, Number(b.arguments?.id));
      if (b.name === "record_assessment") assessed.add(Number(b.arguments?.id));
    }
  }
  return messages.map((m: any, i) => {
    if (i >= cutoff || m.role !== "toolResult") return m;
    const id = inspectedId.get(m.toolCallId);
    if (id !== undefined && !assessed.has(id)) return m;
    const limit = TRIMMED_LENGTH[m.toolName] ?? 800;
    const content = m.content.map((c: any) =>
      c.type === "text" && c.text.length > limit ? { ...c, text: `${c.text.slice(0, limit)}… [trimmed from context; call the tool again if you need it]` } : c,
    );
    return { ...m, content };
  });
}

/** Lets tests run the agent on Pi's scripted faux provider. */
export interface ModelOverride {
  model: Model<any>;
  streamFn: StreamFn;
}

export function createAgent(session: Session, progress: (toolCallId: string, detail: string) => void, override?: ModelOverride) {
  const model = override?.model ?? getModel();
  if (!model) throw new Error(`Unknown model ${PROVIDER}/${MODEL_ID}`);
  return new Agent({
    initialState: { systemPrompt: SYSTEM_PROMPT, model, thinkingLevel: THINKING, tools: buildTools(session, progress) },
    streamFn: override?.streamFn ?? models.streamSimple.bind(models),
    transformContext: async (messages) => pruneContext(messages),
    sessionId: session.id,
  });
}

