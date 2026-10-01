// Client for Freelancer.com's public REST API (https://developers.freelancer.com). The
// endpoints used here need no API key: the user directory, past-client reviews and portfolios.

import type { Filters, Freelancer, WorkItem } from "../shared/types.ts";
import { setCountries, type Country } from "./geo.ts";
import { TtlCache, mapLimit } from "./util.ts";

const API = "https://www.freelancer.com/api";
const SITE = "https://www.freelancer.com";

const directoryCache = new TtlCache<{ users: Freelancer[]; total: number }>(30 * 60_000, 500);
const workCache = new TtlCache<WorkItem[]>(6 * 60 * 60_000, 20_000);

async function get(path: string, params: [string, string | number | boolean][]): Promise<any> {
  const qs = params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`).join("&");
  const url = `${API}${path}?${qs}`;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(20_000) });
    if (res.status === 429 && attempt < 3) {
      const wait = Number(res.headers.get("retry-after") ?? 1 + attempt) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    const body = await res.json().catch(() => null);
    if (!res.ok || body?.status !== "success") {
      throw new Error(`Freelancer.com ${path} failed (${res.status}): ${body?.message ?? res.statusText}`);
    }
    return body.result;
  }
}

function cdn(url: string | null | undefined): string | null {
  if (!url) return null;
  if (url.startsWith("//")) return `https:${url}`;
  if (url.startsWith("/")) return `${SITE}${url}`;
  return url;
}

export function normalizeUser(u: any): Freelancer {
  const rep = u.reputation?.entire_history ?? {};
  const reviews = Number(rep.reviews ?? 0);
  return {
    id: u.id,
    username: u.username,
    displayName: u.public_name || u.display_name || u.username,
    tagline: u.tagline ?? "",
    description: u.profile_description ?? "",
    avatarUrl: cdn(u.avatar_large_cdn ?? u.avatar_cdn),
    country: u.location?.country?.name ?? null,
    countryCode: u.location?.country?.code ?? null,
    city: u.location?.city || null,
    hourlyRate: typeof u.hourly_rate === "number" && u.hourly_rate > 0 ? u.hourly_rate : null,
    currency: u.primary_currency?.code ?? "USD",
    rating: reviews > 0 && typeof rep.overall === "number" ? rep.overall : null,
    reviews,
    jobsCompleted: Number(rep.complete ?? 0),
    completionRate: rep.all ? rep.completion_rate ?? null : null,
    onTime: rep.all ? rep.on_time ?? null : null,
    onBudget: rep.all ? rep.on_budget ?? null : null,
    earningsScore: u.reputation?.earnings_score ?? null,
    skills: (u.jobs ?? []).map((j: any) => j.name as string),
    registeredAt: u.registration_date ?? null,
    profileUrl: `${SITE}/u/${u.username}`,
    work: [],
    enriched: false,
  };
}

export async function loadCountries() {
  const result = await get("/common/0.1/countries/", []);
  const list: Country[] = (result.countries ?? []).map((c: any) => ({ name: c.name, code: c.code }));
  setCountries(list);
  return list;
}

export async function searchDirectory(query: string, filters: Filters, limit = 100, offset = 0) {
  const key = JSON.stringify([query, filters.countries, filters.minRate, filters.maxRate, limit, offset]);
  const cached = directoryCache.get(key);
  if (cached) return cached;

  const params: [string, string | number | boolean][] = [
    ["query", query],
    ["limit", limit],
    ["offset", offset],
    ["compact", true],
    ["jobs", true],
    ["profile_description", true],
    ["reputation", true],
    ["avatar", true],
    ["location_details", true],
    ["display_info", true],
  ];
  for (const country of filters.countries) params.push(["countries[]", country]);
  if (filters.minRate != null) params.push(["hourly_rate_min", filters.minRate]);
  if (filters.maxRate != null) params.push(["hourly_rate_max", filters.maxRate]);

  const result = await get("/users/0.1/users/directory/", params);
  const users = (result.users ?? [])
    .filter((u: any) => !u.closed && u.is_profile_visible !== false)
    .map(normalizeUser);
  const out = { users, total: Number(result.total_count ?? users.length) };
  directoryCache.set(key, out);
  return out;
}

async function fetchReviews(userId: number): Promise<WorkItem[]> {
  const result = await get("/projects/0.1/reviews/", [
    ["to_users[]", userId],
    ["role", "freelancer"],
    ["review_types[]", "project"],
    ["limit", 30],
    ["compact", true],
  ]);
  return (result.reviews ?? [])
    .filter((r: any) => r.review_context?.context_name)
    .map(
      (r: any): WorkItem => ({
        kind: "review",
        title: r.review_context.context_name,
        text: r.description ?? "",
        rating: typeof r.rating === "number" ? r.rating : null,
        date: r.time_submitted ?? null,
        url: r.review_context.seo_url ? `${SITE}/${r.review_context.seo_url}` : null,
      }),
    );
}

async function fetchPortfolios(userIds: number[]): Promise<Map<number, WorkItem[]>> {
  const params: [string, string | number | boolean][] = userIds.map((id) => ["users[]", id]);
  params.push(["limit", 200]);
  const result = await get("/users/0.1/portfolios/", params);
  const out = new Map<number, WorkItem[]>();
  for (const [id, items] of Object.entries<any[]>(result.portfolios ?? {})) {
    out.set(
      Number(id),
      items.slice(0, 12).map((p) => ({
        kind: "portfolio",
        title: p.title ?? "Portfolio item",
        text: p.description ?? "",
        rating: null,
        date: p.last_modified ?? null,
        url: null,
      })),
    );
  }
  return out;
}

/** Fills in each freelancer's work history (client reviews + portfolio). Cached per user. */
export async function enrich(freelancers: Freelancer[], onProgress?: (done: number) => void): Promise<void> {
  const todo = freelancers.filter((f) => {
    const cached = workCache.get(String(f.id));
    if (cached) {
      f.work = cached;
      f.enriched = true;
      return false;
    }
    return !f.enriched;
  });
  if (todo.length === 0) return;

  const portfolios = new Map<number, WorkItem[]>();
  const chunks: number[][] = [];
  for (let i = 0; i < todo.length; i += 25) chunks.push(todo.slice(i, i + 25).map((f) => f.id));
  const portfolioJob = mapLimit(chunks, 4, async (ids) => {
    try {
      for (const [id, items] of await fetchPortfolios(ids)) portfolios.set(id, items);
    } catch (err) {
      console.warn("portfolio fetch failed:", (err as Error).message);
    }
  });

  let done = 0;
  const reviews = await mapLimit(todo, 12, async (f) => {
    // Nobody to ask about a freelancer with no reviews.
    const items = f.reviews > 0 ? await fetchReviews(f.id).catch(() => []) : [];
    onProgress?.(++done);
    return items;
  });
  await portfolioJob;

  todo.forEach((f, i) => {
    f.work = [...reviews[i], ...(portfolios.get(f.id) ?? [])];
    f.enriched = true;
    workCache.set(String(f.id), f.work);
  });
}
