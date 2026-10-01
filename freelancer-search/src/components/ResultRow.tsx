import { Bookmark, ExternalLink } from "lucide-react";
import { memo, useState } from "react";
import type { Criterion, Freelancer, Ranking, WorkItem } from "../../shared/types.ts";
import { EvidenceGlyph, FIT_LABEL } from "./Glyph.tsx";

interface Props {
  freelancer: Freelancer;
  ranking: Ranking | null;
  criteria: Criterion[];
  saved: boolean;
  onToggleSave: (f: Freelancer, r: Ranking | null) => void;
}

const VERDICT = { shortlist: "Shortlist", maybe: "Maybe", reject: "Not a fit" } as const;

function month(ts: number | null) {
  return ts ? new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", year: "numeric" }) : "";
}

function Work({ item }: { item: WorkItem }) {
  return (
    <li className="work-item">
      <div className="work-title">
        {item.url ? (
          <a href={item.url} target="_blank" rel="noreferrer">
            {item.title}
          </a>
        ) : (
          <span>{item.title}</span>
        )}
        <span className="work-meta">
          {item.kind === "review" ? "Client project" : "Portfolio"}
          {item.date ? `, ${month(item.date)}` : ""}
          {item.rating != null ? `, rated ${item.rating.toFixed(1)}` : ""}
        </span>
      </div>
      {item.text && <p>{item.text}</p>}
    </li>
  );
}

function ResultRow({ freelancer: f, ranking: r, criteria, saved, onToggleSave }: Props) {
  const [open, setOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const scored = r && !r.error;
  const fits = new Map(r?.criteria.map((c) => [c.criterionId, c]) ?? []);
  const best = r?.highlights.map((i) => f.work[i]).find(Boolean);
  const reviews = f.work.filter((w) => w.kind === "review");
  const portfolio = f.work.filter((w) => w.kind === "portfolio");
  const toggle = () => setOpen((o) => !o);

  return (
    <li className={`row ${open ? "open" : ""}`}>
      <div
        className="row-main"
        role="button"
        tabIndex={0}
        aria-expanded={open}
        onClick={toggle}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === "Enter" || e.key === " ")) {
            e.preventDefault();
            toggle();
          }
        }}
      >
        {f.avatarUrl ? <img className="avatar" src={f.avatarUrl} alt="" loading="lazy" /> : <span className="avatar">{f.displayName.slice(0, 1)}</span>}

        <div className="row-body">
          <div className="row-head">
            <span className="row-name">{f.displayName}</span>
            <span className="row-headline">{f.tagline}</span>
          </div>
          <div className="facts">
            <span className="rate">{f.hourlyRate != null ? `$${f.hourlyRate}/hr` : "Rate not set"}</span>
            {f.country && <span>{f.city ? `${f.city}, ${f.country}` : f.country}</span>}
            <span>{f.rating != null ? `${f.rating.toFixed(1)} from ${f.reviews} review${f.reviews === 1 ? "" : "s"}` : "No reviews yet"}</span>
            {f.onTime != null && f.jobsCompleted > 0 && <span>{Math.round(f.onTime * 100)}% on time</span>}
          </div>

          {r?.error ? (
            <span className="pending error">Couldn't screen this profile: {r.error}</span>
          ) : !r ? (
            <span className="pending">Not screened yet</span>
          ) : (
            <>
              {r.source === "agent" && r.summary && <p className="summary">{r.summary}</p>}
              {criteria.length > 0 && (
                <div className="evidence">
                  {criteria.map((c) => {
                    const s = fits.get(c.id);
                    if (!s) return null;
                    return (
                      <span key={c.id} className={`evidence-item ${s.fit}`} title={`${FIT_LABEL[s.fit]}${s.evidence ? `: ${s.evidence}` : ""}`}>
                        <EvidenceGlyph fit={s.fit} />
                        {c.label}
                      </span>
                    );
                  })}
                </div>
              )}
              {best && !open && (
                <span className="best-work">
                  {best.kind === "review" ? "Delivered " : "Portfolio "}
                  <b>{best.title}</b>
                  {best.rating != null ? `, rated ${best.rating.toFixed(1)}` : ""}
                </span>
              )}
            </>
          )}
        </div>

        <div className={`score ${scored ? "" : "unscored"}`}>
          <b aria-label={scored ? `Match ${r.score} of 100` : "Not scored"}>{scored ? r.score : "–"}</b>
          {r?.verdict ? (
            <span className={`verdict ${r.verdict}`}>
              <i aria-hidden /> {VERDICT[r.verdict]}
            </span>
          ) : scored ? (
            <span className="verdict">Screened</span>
          ) : null}
          <div className={`row-actions ${saved ? "pinned" : ""}`}>
            <button
              className="icon-button"
              aria-pressed={saved}
              aria-label={saved ? "Remove from saved" : "Save"}
              title={saved ? "Remove from saved" : "Save"}
              onClick={(e) => {
                e.stopPropagation();
                onToggleSave(f, r);
              }}
            >
              <Bookmark size={16} fill={saved ? "currentColor" : "none"} />
            </button>
            <a className="icon-button" href={f.profileUrl} target="_blank" rel="noreferrer" aria-label="Open profile on Freelancer.com" title="Open profile on Freelancer.com" onClick={(e) => e.stopPropagation()}>
              <ExternalLink size={16} />
            </a>
          </div>
        </div>
      </div>

      <div className={`reveal ${open ? "open" : ""}`} aria-hidden={!open}>
        <div>
          {open && (
            <div className="details">
              {scored && criteria.length > 0 && (
                <section className="detail-section">
                  <span className="section-label">{r.source === "agent" ? "Evidence the agent found" : "Evidence from screening"}</span>
                  {criteria.map((c) => {
                    const s = fits.get(c.id);
                    if (!s) return null;
                    return (
                      <div key={c.id} className="criterion-detail">
                        <EvidenceGlyph fit={s.fit} />
                        <span>{c.label}</span>
                        <span className="why">{s.evidence || FIT_LABEL[s.fit]}</span>
                      </div>
                    );
                  })}
                </section>
              )}

              {f.description && (
                <section className="detail-section">
                  <span className="section-label">About</span>
                  <p className={`about ${aboutOpen ? "" : "clamped"}`}>{f.description}</p>
                  {f.description.length > 320 && (
                    <div>
                      <button className="ghost-button" style={{ marginLeft: -8 }} onClick={() => setAboutOpen((o) => !o)}>
                        {aboutOpen ? "Show less" : "Show all"}
                      </button>
                    </div>
                  )}
                </section>
              )}

              {reviews.length > 0 && (
                <section className="detail-section">
                  <span className="section-label">Client projects</span>
                  <ul className="work-list">
                    {reviews.map((w, i) => (
                      <Work key={i} item={w} />
                    ))}
                  </ul>
                </section>
              )}

              {portfolio.length > 0 && (
                <section className="detail-section">
                  <span className="section-label">Portfolio</span>
                  <ul className="work-list">
                    {portfolio.map((w, i) => (
                      <Work key={i} item={w} />
                    ))}
                  </ul>
                </section>
              )}

              {!f.enriched && <p className="pending">Work history loads when this profile is screened.</p>}

              {f.skills.length > 0 && (
                <section className="detail-section">
                  <span className="section-label">Listed skills</span>
                  <p className="skills">
                    {f.skills.slice(0, 30).join(", ")}
                    {f.skills.length > 30 ? `, and ${f.skills.length - 30} more` : ""}
                  </p>
                </section>
              )}

              <div className="links">
                <a className="ghost-button" href={f.profileUrl} target="_blank" rel="noreferrer">
                  <ExternalLink size={14} /> Freelancer.com profile
                </a>
                {f.links.map((l) => (
                  <a key={l.url} className="ghost-button" href={l.url} target="_blank" rel="noreferrer">
                    <ExternalLink size={14} /> {l.label}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </li>
  );
}

export default memo(ResultRow);
