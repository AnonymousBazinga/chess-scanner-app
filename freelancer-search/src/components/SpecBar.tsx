import { useState } from "react";
import type { Criterion, SearchSpec } from "../../shared/types.ts";

interface Props {
  spec: SearchSpec;
  onChange: (spec: SearchSpec, note: string) => void;
  makeCriterion: (label: string) => Criterion;
}

const WEIGHT_LABEL = { 1: "Nice to have", 2: "Important", 3: "Must have" } as const;

/** The current search as editable chips: filters on the first line, ranking criteria on the second. */
export default function SpecBar({ spec, onChange, makeCriterion }: Props) {
  const [adding, setAdding] = useState("");
  const f = spec.filters;
  const set = (patch: Partial<SearchSpec["filters"]>, note: string) => onChange({ ...spec, filters: { ...f, ...patch } }, note);

  const rate =
    f.minRate != null && f.maxRate != null
      ? `$${f.minRate}–$${f.maxRate}/hr`
      : f.maxRate != null
        ? `≤ $${f.maxRate}/hr`
        : f.minRate != null
          ? `≥ $${f.minRate}/hr`
          : null;
  const rating = [f.minRating != null ? `≥ ${f.minRating}★` : null, f.minReviews ? `${f.minReviews}+ reviews` : null]
    .filter(Boolean)
    .join(", ");

  return (
    <div className="spec">
      <div className="chips">
        <span className="chip-label">Search</span>
        {spec.queries.map((q) => (
          <span key={q} className="chip query">
            {q}
            {spec.queries.length > 1 && (
              <button
                aria-label={`Remove query ${q}`}
                onClick={() => onChange({ ...spec, queries: spec.queries.filter((x) => x !== q) }, `Stopped searching for "${q}".`)}
              >
                ×
              </button>
            )}
          </span>
        ))}
        {f.countries.length > 0 && (
          <span className="chip filter" title={f.countries.join(", ")}>
            📍 {f.locationLabel ?? `${f.countries.length} countries`}
            <button aria-label="Remove location filter" onClick={() => set({ countries: [], locationLabel: null }, "Removed the location filter.")}>
              ×
            </button>
          </span>
        )}
        {rate && (
          <span className="chip filter">
            {rate}
            <button aria-label="Remove rate filter" onClick={() => set({ minRate: null, maxRate: null }, "Removed the rate filter.")}>
              ×
            </button>
          </span>
        )}
        {rating && (
          <span className="chip filter">
            {rating}
            <button aria-label="Remove rating filter" onClick={() => set({ minRating: null, minReviews: null }, "Removed the rating filter.")}>
              ×
            </button>
          </span>
        )}
      </div>
      <div className="chips">
        <span className="chip-label">Rank by</span>
        {spec.criteria.map((c) => (
          <span key={c.id} className={`chip criterion w${c.weight}`} title={`${c.description}\n${WEIGHT_LABEL[c.weight]}. Click the dots to change.`}>
            <button
              className="weight"
              aria-label={`${c.label}: ${WEIGHT_LABEL[c.weight]}. Change weight`}
              onClick={() => {
                const weight = ((c.weight % 3) + 1) as 1 | 2 | 3;
                onChange(
                  { ...spec, criteria: spec.criteria.map((x) => (x.id === c.id ? { ...x, weight } : x)) },
                  `"${c.label}" is now ${WEIGHT_LABEL[weight].toLowerCase()}.`,
                );
              }}
            >
              {[1, 2, 3].map((n) => (
                <i key={n} className={n <= c.weight ? "on" : ""} />
              ))}
            </button>
            {c.label}
            <button
              aria-label={`Remove criterion ${c.label}`}
              onClick={() => onChange({ ...spec, criteria: spec.criteria.filter((x) => x.id !== c.id) }, `Stopped ranking by "${c.label}".`)}
            >
              ×
            </button>
          </span>
        ))}
        <form
          className="add"
          onSubmit={(e) => {
            e.preventDefault();
            const label = adding.trim();
            if (!label) return;
            const c = makeCriterion(label);
            if (!spec.criteria.some((x) => x.id === c.id)) {
              onChange({ ...spec, criteria: [...spec.criteria, c] }, `Also ranking by "${label}".`);
            }
            setAdding("");
          }}
        >
          <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="+ add criterion" aria-label="Add criterion" />
        </form>
      </div>
    </div>
  );
}
