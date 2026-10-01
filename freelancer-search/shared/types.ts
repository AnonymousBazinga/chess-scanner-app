// Types shared by the server and the browser.

export interface Criterion {
  id: string;
  /** Short chip label, e.g. "Python ETL pipelines". */
  label: string;
  /** What counts as evidence, written for the ranker. */
  description: string;
  /** Terms that signal this criterion in a profile or past job, used by keyword ranking. */
  keywords: string[];
  /** 1 = nice to have, 2 = important, 3 = must have. */
  weight: 1 | 2 | 3;
}

export interface Filters {
  /** Freelancer.com country names, e.g. "Germany". Empty = anywhere. */
  countries: string[];
  /** Human label for the location filter when it came from a region, e.g. "Europe". */
  locationLabel: string | null;
  minRate: number | null;
  maxRate: number | null;
  /** Minimum overall review rating, 0-5. */
  minRating: number | null;
  minReviews: number | null;
}

export interface SearchSpec {
  /** One or two sentences describing what the client needs. The ranker reads this. */
  brief: string;
  /** Keyword queries sent to the Freelancer.com directory to build the candidate pool. */
  queries: string[];
  filters: Filters;
  criteria: Criterion[];
}

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface WorkItem {
  kind: "review" | "portfolio";
  title: string;
  text: string;
  rating: number | null;
  /** Unix seconds. */
  date: number | null;
  url: string | null;
}

export interface Freelancer {
  id: number;
  username: string;
  displayName: string;
  tagline: string;
  description: string;
  avatarUrl: string | null;
  country: string | null;
  countryCode: string | null;
  city: string | null;
  hourlyRate: number | null;
  currency: string;
  rating: number | null;
  reviews: number;
  jobsCompleted: number;
  completionRate: number | null;
  onTime: number | null;
  onBudget: number | null;
  earningsScore: number | null;
  skills: string[];
  registeredAt: number | null;
  profileUrl: string;
  /** Past client reviews and portfolio items, newest first. Filled in by enrichment. */
  work: WorkItem[];
  enriched: boolean;
}

export type Fit = "strong" | "partial" | "none";

export interface CriterionScore {
  criterionId: string;
  fit: Fit;
  /** Quote or paraphrase of the profile or work history that justifies the fit. */
  evidence: string;
}

export interface Ranking {
  /** 0-100 relevance to the brief and criteria. */
  relevance: number;
  /** 0-100 track-record score from ratings, volume and completion. */
  quality: number;
  /** 0-100 combined score used for "Best match". */
  score: number;
  /** "ai" = scored by Claude against the criteria; "keyword" = lexical estimate. */
  method: "ai" | "keyword";
  summary: string;
  criteria: CriterionScore[];
  /** Indexes into Freelancer.work that best support the match. */
  highlights: number[];
}

export type SearchEvent =
  | { type: "plan"; spec: SearchSpec; reply: string; suggestions: string[]; ai: boolean }
  | { type: "status"; stage: "planning" | "retrieving" | "enriching" | "ranking" | "done"; message: string }
  /** The candidate pool, replacing any previous one. Work history arrives later in "work". */
  | { type: "pool"; freelancers: Freelancer[]; totalMatches: number }
  | { type: "work"; work: Record<number, WorkItem[]> }
  /** Rankings to merge into what the client already has, keyed by freelancer id. */
  | { type: "rankings"; rankings: Record<number, Ranking> }
  | { type: "error"; message: string };

export interface SearchRequest {
  messages: ChatMessage[];
  /** The spec currently shown in the UI, possibly edited by hand. */
  spec: SearchSpec | null;
  /** True when the last chat message should be turned into a new spec. */
  replan: boolean;
}
