import { Bookmark, CircleCheck, ChevronDown, CircleAlert, CircleDashed, CircleDot, CircleX, CodeXml, ExternalLink, Globe } from "lucide-react";
import { useState } from "react";
import type { Criterion, Fit, Freelancer, Ranking, WorkItem } from "../../shared/types.ts";

interface Props {
  rank: number;
  freelancer: Freelancer;
  ranking: Ranking | null;
  criteria: Criterion[];
  saved: boolean;
  onToggleSave: () => void;
}

function flag(code: string | null) {
  if (!code || code.length !== 2) return "";
  return code.toUpperCase().replace(/./g, (c) => String.fromCodePoint(127397 + c.charCodeAt(0)));
}

function month(ts: number | null) {
  return ts ? new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "";
}

const FIT: Record<Fit, { icon: typeof CircleCheck; label: string }> = {
  direct: { icon: CircleCheck, label: "Delivered for clients" },
  adjacent: { icon: CircleDot, label: "Related work" },
  claimed: { icon: CircleDashed, label: "Claimed only" },
  none: { icon: CircleX, label: "No evidence" },
};

function ScoreRing({ score, source }: { score: number; source: Ranking["source"] }) {
  const r = 20;
  const c = 2 * Math.PI * r;
  const tone = score >= 80 ? "high" : score >= 60 ? "mid" : "low";
  return (
    <div className={`ring ${tone}`} title={source === "agent" ? "Score from the agent's review of this profile" : "Score from Jev's screening"}>
      <svg viewBox="0 0 48 48" aria-hidden>
        <circle cx="24" cy="24" r={r} className="track" />
        <circle cx="24" cy="24" r={r} className="value" strokeDasharray={`${(c * score) / 100} ${c}`} />
      </svg>
      <b>{score}</b>
    </div>
  );
}

function Work({ item }: { item: WorkItem }) {
  return (
    <li className="work">
      <div className="work-title">
        {item.url ? (
          <a href={item.url} target="_blank" rel="noreferrer">
            {item.title}
          </a>
        ) : (
          <span>{item.title}</span>
        )}
        {item.rating != null && <span className="stars">★ {item.rating.toFixed(1)}</span>}
        <span className="work-meta">{item.kind === "review" ? `Client project${item.date ? ` · ${month(item.date)}` : ""}` : "Portfolio"}</span>
      </div>
      {item.text && <p>{item.text}</p>}
    </li>
  );
}

export default function ResultCard({ rank, freelancer: f, ranking: r, criteria, saved, onToggleSave }: Props) {
  const [open, setOpen] = useState(false);
  const highlights = (r?.highlights ?? []).map((i) => f.work[i]).filter(Boolean);
  const fits = new Map(r?.criteria.map((c) => [c.criterionId, c]) ?? []);
  const reviews = f.work.filter((w) => w.kind === "review");
  const portfolio = f.work.filter((w) => w.kind === "portfolio");
  const scored = r && !r.error;

  return (
    <li className={`card ${r?.verdict === "reject" ? "dim" : ""}`}>
      <div className="card-top">
        <span className="rank">{rank}</span>
        {f.avatarUrl ? <img className="avatar" src={f.avatarUrl} alt="" loading="lazy" /> : <span className="avatar initials">{f.displayName.slice(0, 1)}</span>}
        <div className="who">
          <div className="name-row">
            <h3>
              <a href={f.profileUrl} target="_blank" rel="noreferrer">
                {f.displayName}
              </a>
            </h3>
            {r?.verdict && <span className={`verdict ${r.verdict}`}>{r.verdict === "shortlist" ? "Shortlist" : r.verdict === "maybe" ? "Maybe" : "Not a fit"}</span>}
          </div>
          <p className="headline">{f.tagline || "Freelancer"}</p>
          <p className="facts">
            {f.country && (
              <span>
                {flag(f.countryCode)} {f.country}
              </span>
            )}
            <span className="strong">{f.hourlyRate != null ? `$${f.hourlyRate}/hr` : "Rate n/a"}</span>
            {f.rating != null ? (
              <span>
                <span className="star">★</span> {f.rating.toFixed(1)} <span className="muted">({f.reviews})</span>
              </span>
            ) : (
              <span className="muted">No reviews</span>
            )}
            {f.onTime != null && f.jobsCompleted > 0 && <span className="muted">{Math.round(f.onTime * 100)}% on time</span>}
          </p>
        </div>
        <div className="card-actions">
          {scored ? <ScoreRing score={r.score} source={r.source} /> : <div className="ring pending" title={r?.error ? "Screening failed" : "Not screened yet"} />}
          <button className={`icon-btn ${saved ? "saved" : ""}`} onClick={onToggleSave} aria-pressed={saved} aria-label="Save to shortlist">
            <Bookmark size={17} fill={saved ? "currentColor" : "none"} />
          </button>
        </div>
      </div>

      {r?.error ? (
        <p className="card-error">
          <CircleAlert size={14} /> Couldn't screen this profile: {r.error}
        </p>
      ) : !r ? (
        <p className="pending-line">Waiting to be screened…</p>
      ) : (
        <>
          {r.summary && <p className={`summary ${r.source}`}>{r.summary}</p>}
          {criteria.length > 0 && (
            <ul className="fits">
              {criteria.map((c) => {
                const s = fits.get(c.id);
                if (!s) return null;
                const { icon: Icon, label } = FIT[s.fit];
                return (
                  <li key={c.id} className={`fit ${s.fit}`}>
                    <Icon size={15} aria-label={label} />
                    <span className="fit-label">{c.label}</span>
                    <span className="fit-evidence">{s.evidence || label}</span>
                  </li>
                );
              })}
            </ul>
          )}
          {highlights.length > 0 && (
            <ul className="relevant">
              {highlights.map((w, i) => (
                <Work key={i} item={w} />
              ))}
            </ul>
          )}
        </>
      )}

      <div className="card-foot">
        <span className="source">
          {r?.source === "agent" ? "Reviewed by the agent" : scored ? `Screened by Jev${r.confidence != null ? ` · ${Math.round(r.confidence * 100)}% confident` : ""}` : ""}
        </span>
        <span className="links">
          {f.links.map((l) => (
            <a key={l.url} href={l.url} target="_blank" rel="noreferrer">
              {/github\.com/.test(l.url) ? <CodeXml size={14} /> : <Globe size={14} />} {l.label}
            </a>
          ))}
          <a href={f.profileUrl} target="_blank" rel="noreferrer">
            <ExternalLink size={14} /> Profile
          </a>
          <button className="link" onClick={() => setOpen((o) => !o)} aria-expanded={open}>
            {open ? "Less" : "Work history"} <ChevronDown size={14} className={open ? "flip" : ""} />
          </button>
        </span>
      </div>

      {open && (
        <div className="details">
          {f.description && <p className="about">{f.description}</p>}
          {f.skills.length > 0 && (
            <div className="skills">
              {f.skills.slice(0, 24).map((s) => (
                <span key={s}>{s}</span>
              ))}
              {f.skills.length > 24 && <span className="muted">+{f.skills.length - 24}</span>}
            </div>
          )}
          {!f.enriched && <p className="muted">Work history loads when this profile is screened.</p>}
          {reviews.length > 0 && (
            <>
              <h4>Client projects ({reviews.length})</h4>
              <ul className="history">
                {reviews.map((w, i) => (
                  <Work key={i} item={w} />
                ))}
              </ul>
            </>
          )}
          {portfolio.length > 0 && (
            <>
              <h4>Portfolio ({portfolio.length})</h4>
              <ul className="history">
                {portfolio.map((w, i) => (
                  <Work key={i} item={w} />
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </li>
  );
}
