// Types shared by the server and the browser.

export interface Criterion {
  id: string;
  /** Short chip label, e.g. "Python ETL pipelines". */
  label: string;
  /** What counts as evidence. Jev and the agent judge candidates against this. */
  description: string;
  /** 1 = nice to have, 2 = important, 3 = must have. */
  weight: 1 | 2 | 3;
}

export interface Filters {
  /** Freelancer.com country names, e.g. "Germany". Empty = anywhere. */
  countries: string[];
  /** Label for the location filter, e.g. "Europe" or "Spain, Portugal". */
  locationLabel: string | null;
  minRate: number | null;
  maxRate: number | null;
  /** Minimum overall review rating, 0-5. */
  minRating: number | null;
  minReviews: number | null;
}

export interface Spec {
  /** What the client needs, in the agent's words. Jev's overall-fit question reads this. */
  brief: string;
  criteria: Criterion[];
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
  skills: string[];
  /** Exams and certifications passed on Freelancer.com. */
  qualifications: string[];
  registeredAt: number | null;
  profileUrl: string;
  /** Past client reviews and portfolio items. Filled in before screening. */
  work: WorkItem[];
  enriched: boolean;
  /** Links the agent verified (GitHub, personal site, ...). */
  links: { label: string; url: string }[];
}

/** How strong the evidence is that a freelancer meets one criterion. */
export type Fit = "direct" | "adjacent" | "claimed" | "none";

export interface CriterionScore {
  criterionId: string;
  fit: Fit;
  /** Why, e.g. a quoted project title. */
  evidence: string;
}

export interface Ranking {
  /** 0-100, used for "Best match". */
  score: number;
  /** "jev" = screened by Jev; "agent" = the agent read the profile and recorded a verdict. */
  source: "jev" | "agent";
  verdict: "shortlist" | "maybe" | "reject" | null;
  summary: string;
  criteria: CriterionScore[];
  /** Indexes into Freelancer.work that best support the match. */
  highlights: number[];
  /** Jev's confidence in its own answers, 0-1. */
  confidence: number | null;
  /** Set when screening failed for this candidate. */
  error?: string;
}

export interface Activity {
  id: string;
  /** "tool" = a step the agent took; "note" = what it said between steps; "thought" = reasoning summary. */
  kind: "tool" | "note" | "thought";
  label: string;
  detail?: string;
  state: "running" | "done" | "error";
}

export type ServerEvent =
  | { type: "turn_start"; turnId: string }
  | { type: "activity"; turnId: string; activity: Activity }
  | { type: "reply_delta"; turnId: string; text: string }
  /** The text streamed so far was commentary before tool calls, not the reply: move it into the activity log. */
  | { type: "draft_to_note"; turnId: string }
  | { type: "turn_end"; turnId: string; error?: string }
  | { type: "spec"; spec: Spec }
  | { type: "filters"; filters: Filters }
  | { type: "suggestions"; suggestions: string[] }
  | { type: "pool"; freelancers: Freelancer[] }
  | { type: "work"; work: Record<number, WorkItem[]> }
  | { type: "rankings"; rankings: Record<number, Ranking>; reset?: boolean }
  | { type: "links"; links: Record<number, Freelancer["links"]> };

export interface AppConfig {
  ready: boolean;
  /** What's missing from the server's .env, shown instead of the app when not ready. */
  missing: string[];
  model: string;
  regions: Record<string, string[]>;
  countries: string[];
}

export function emptyFilters(): Filters {
  return { countries: [], locationLabel: null, minRate: null, maxRate: null, minRating: null, minReviews: null };
}

export function passesFilters(f: Freelancer, filters: Filters) {
  const { countries, minRating, minReviews, minRate, maxRate } = filters;
  if (countries.length && (!f.country || !countries.includes(f.country))) return false;
  if (minRating != null && (f.rating ?? 0) < minRating) return false;
  if (minReviews != null && f.reviews < minReviews) return false;
  if (minRate != null && (f.hourlyRate == null || f.hourlyRate < minRate)) return false;
  if (maxRate != null && (f.hourlyRate == null || f.hourlyRate > maxRate)) return false;
  return true;
}
