import { useState } from "react";
import type { Criterion, Freelancer, Ranking, WorkItem } from "../../shared/types.ts";

interface Props {
  rank: number;
  freelancer: Freelancer;
  ranking: Ranking | null;
  criteria: Criterion[];
  shortlisted: boolean;
  onToggleShortlist: () => void;
}

function flag(code: string | null) {
  if (!code || code.length !== 2) return "";
  return code.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

function month(ts: number | null) {
  return ts ? new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "";
}

function scoreTone(score: number) {
  return score >= 75 ? "high" : score >= 55 ? "mid" : "low";
}

const FIT_ICON = { strong: "✓", partial: "◐", none: "✕" } as const;

function Work({ item }: { item: WorkItem }) {
  const title = item.url ? (
    <a href={item.url} target="_blank" rel="noreferrer">
      {item.title}
    </a>
  ) : (
    item.title
  );
  return (
    <li className={`work ${item.kind}`}>
      <div className="work-title">
        <span className="kind">{item.kind === "review" ? "Client project" : "Portfolio"}</span>
        {title}
        {item.rating != null && <span className="stars">{item.rating.toFixed(1)}★</span>}
        {item.date && <span className="date">{month(item.date)}</span>}
      </div>
      {item.text && <p>{item.text}</p>}
    </li>
  );
}

export default function ResultCard({ rank, freelancer: f, ranking: r, criteria, shortlisted, onToggleShortlist }: Props) {
  const [open, setOpen] = useState(false);
  const highlights = (r?.highlights ?? []).map((i) => f.work[i]).filter(Boolean);
  const fits = new Map(r?.criteria.map((c) => [c.criterionId, c]) ?? []);
  const reviews = f.work.filter((w) => w.kind === "review");
  const portfolio = f.work.filter((w) => w.kind === "portfolio");

  return (
    <li className="card">
      <div className="card-top">
        <span className="rank">{rank}</span>
        {f.avatarUrl ? (
          <img className="photo" src={f.avatarUrl} alt="" loading="lazy" />
        ) : (
          <span className="photo initials">{f.displayName.slice(0, 1).toUpperCase()}</span>
        )}
        <div className="who">
          <h3>
            <a href={f.profileUrl} target="_blank" rel="noreferrer">
              {f.displayName}
            </a>
          </h3>
          <p className="tagline">{f.tagline || "Freelancer"}</p>
          <p className="facts">
            {f.country && (
              <span>
                {flag(f.countryCode)} {f.city ? `${f.city}, ` : ""}
                {f.country}
              </span>
            )}
            <span className="rate">{f.hourlyRate != null ? `$${f.hourlyRate}/hr` : "Rate n/a"}</span>
            {f.rating != null ? (
              <span>
                <b>{f.rating.toFixed(1)}★</b> {f.reviews} review{f.reviews === 1 ? "" : "s"}
              </span>
            ) : (
              <span className="muted">No reviews yet</span>
            )}
            {f.completionRate != null && f.jobsCompleted > 0 && <span>{Math.round(f.completionRate * 100)}% completed</span>}
            {f.onTime != null && f.jobsCompleted > 0 && <span>{Math.round(f.onTime * 100)}% on time</span>}
          </p>
        </div>
        <div className="actions">
          {r && (
            <div className={`score ${scoreTone(r.score)} ${r.method}`} title={`Relevance ${r.relevance} · track record ${r.quality}`}>
              <b>{r.score}</b>
              <span>{r.method === "ai" ? "AI match" : "keyword"}</span>
            </div>
          )}
          <button className={`star ${shortlisted ? "on" : ""}`} onClick={onToggleShortlist} aria-pressed={shortlisted} aria-label="Shortlist">
            {shortlisted ? "★" : "☆"}
          </button>
        </div>
      </div>

      {r?.summary && <p className={`summary ${r.method}`}>{r.summary}</p>}

      {criteria.length > 0 && r && (
        <ul className="fits">
          {criteria.map((c) => {
            const fit = fits.get(c.id);
            if (!fit) return null;
            return (
              <li key={c.id} className={`fit ${fit.fit}`} title={fit.evidence}>
                <span aria-hidden>{FIT_ICON[fit.fit]}</span> {c.label}
                <span className="sr-only"> ({fit.fit}): </span>
                <span className="evidence">{fit.evidence}</span>
              </li>
            );
          })}
        </ul>
      )}

      {highlights.length > 0 && (
        <div className="relevant">
          <h4>Most relevant past work</h4>
          <ul>
            {highlights.map((w, i) => (
              <Work key={i} item={w} />
            ))}
          </ul>
        </div>
      )}

      <div className="skills">
        {f.skills.slice(0, 8).map((s) => (
          <span key={s}>{s}</span>
        ))}
        {f.skills.length > 8 && <span className="muted">+{f.skills.length - 8}</span>}
      </div>

      <button className="expand" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
        {open ? "Hide details" : f.enriched ? `Profile and work history (${reviews.length} client reviews, ${portfolio.length} portfolio)` : "Profile"}
      </button>
      {open && (
        <div className="details">
          {f.description && <p className="about">{f.description}</p>}
          {!f.enriched && <p className="muted">Work history wasn't loaded for this candidate: they ranked outside the top group. Open their profile to see it.</p>}
          {reviews.length > 0 && (
            <>
              <h4>Client reviews</h4>
              <ul>
                {reviews.map((w, i) => (
                  <Work key={i} item={w} />
                ))}
              </ul>
            </>
          )}
          {portfolio.length > 0 && (
            <>
              <h4>Portfolio</h4>
              <ul>
                {portfolio.map((w, i) => (
                  <Work key={i} item={w} />
                ))}
              </ul>
            </>
          )}
          <a className="profile-link" href={f.profileUrl} target="_blank" rel="noreferrer">
            Open full profile on Freelancer.com ↗
          </a>
        </div>
      )}
    </li>
  );
}
