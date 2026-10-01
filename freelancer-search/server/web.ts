// Outside evidence the agent can gather: GitHub profiles and arbitrary public web pages
// (a freelancer's own site, a project they link to).

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { truncate } from "./util.ts";

const GITHUB = "https://api.github.com";

function githubHeaders(): Record<string, string> {
  const h: Record<string, string> = { accept: "application/vnd.github+json", "user-agent": "talent-scout" };
  // A dedicated variable, so an unrelated GITHUB_TOKEN in the environment isn't sent along.
  if (process.env.GITHUB_API_TOKEN) h.authorization = `Bearer ${process.env.GITHUB_API_TOKEN}`;
  return h;
}

async function github(path: string): Promise<any> {
  const res = await fetch(`${GITHUB}${path}`, { headers: githubHeaders(), signal: AbortSignal.timeout(15_000) });
  if ((res.status === 403 || res.status === 429) && res.headers.get("x-ratelimit-remaining") === "0") {
    const reset = Number(res.headers.get("x-ratelimit-reset"));
    const when = reset ? ` until ${new Date(reset * 1000).toLocaleTimeString()}` : "";
    throw new Error(`GitHub rate limit reached${when}. Set GITHUB_API_TOKEN for higher limits.`);
  }
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(`GitHub refused the request (${res.status}${body?.message ? `: ${truncate(body.message, 120)}` : ""}).`);
  }
  return res.json();
}

/** Finds GitHub accounts matching a name or handle. */
export async function githubSearch(query: string) {
  const json = await github(`/search/users?q=${encodeURIComponent(query)}&per_page=5`);
  return (json?.items ?? []).map((u: any) => ({ login: u.login as string, url: u.html_url as string }));
}

/** A GitHub account's profile and most recently pushed repositories. */
export async function githubProfile(login: string) {
  const [user, repos] = await Promise.all([
    github(`/users/${encodeURIComponent(login)}`),
    github(`/users/${encodeURIComponent(login)}/repos?sort=pushed&per_page=30`),
  ]);
  if (!user) return null;
  const own = (repos ?? []).filter((r: any) => !r.fork);
  const languages: Record<string, number> = {};
  for (const r of own) if (r.language) languages[r.language] = (languages[r.language] ?? 0) + 1;
  return {
    login: user.login,
    url: user.html_url,
    name: user.name,
    bio: user.bio,
    location: user.location,
    blog: user.blog || null,
    company: user.company,
    publicRepos: user.public_repos,
    followers: user.followers,
    createdAt: user.created_at,
    languages,
    repos: own
      .sort((a: any, b: any) => b.stargazers_count - a.stargazers_count || Date.parse(b.pushed_at) - Date.parse(a.pushed_at))
      .slice(0, 12)
      .map((r: any) => ({
        name: r.name,
        description: r.description,
        language: r.language,
        stars: r.stargazers_count,
        topics: r.topics,
        pushedAt: r.pushed_at?.slice(0, 10),
      })),
  };
}

function isPrivateAddress(ip: string) {
  if (isIP(ip) === 6) return ip === "::1" || /^f[cd]/i.test(ip) || /^fe80/i.test(ip) || ip.startsWith("::ffff:127.");
  const [a, b] = ip.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

/** Fetches a public web page and returns its readable text. Refuses local and private addresses. */
export async function fetchPage(rawUrl: string, maxChars = 12_000) {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http(s) URLs can be fetched.");
  const { address } = await lookup(url.hostname);
  if (isPrivateAddress(address)) throw new Error("That address is not public.");
  const res = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0 (compatible; talent-scout)", accept: "text/html,text/plain,application/json" },
    redirect: "follow",
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText} from ${url.hostname}`);
  const type = res.headers.get("content-type") ?? "";
  const body = await res.text();
  const text = type.includes("html") ? htmlToText(body) : body;
  const title = type.includes("html") ? (body.match(/<title[^>]*>([^<]*)<\/title>/i)?.[1] ?? "").trim() : "";
  return { url: res.url, title, text: truncate(text, maxChars) };
}

export function htmlToText(html: string) {
  return html
    .replace(/<(script|style|noscript|svg|head)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<a\s[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_, href, text) => `${text} [${href}]`)
    .replace(/<\/(p|div|li|h[1-6]|tr|section|article)>/gi, "\n")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}
