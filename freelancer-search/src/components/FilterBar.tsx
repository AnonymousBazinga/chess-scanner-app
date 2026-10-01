import { ChevronDown, DollarSign, MapPin, Plus, Star, X } from "lucide-react";
import { useState } from "react";
import { criterionFrom } from "../../shared/criteria.ts";
import type { Filters, Spec } from "../../shared/types.ts";
import Popover from "./Popover.tsx";

interface Props {
  filters: Filters;
  spec: Spec;
  regions: Record<string, string[]>;
  countries: string[];
  onFilters: (f: Filters, note: string) => void;
  onSpec: (s: Spec, note: string) => void;
}

const WEIGHT = { 1: "Nice to have", 2: "Important", 3: "Must have" } as const;

function LocationPanel({ filters, regions, countries, onFilters, close }: Omit<Props, "spec" | "onSpec"> & { close: () => void }) {
  const [query, setQuery] = useState("");
  const selected = new Set(filters.countries);
  const matches = query.trim()
    ? countries.filter((c) => c.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 6)
    : [];
  const apply = (names: string[], label: string | null) => {
    onFilters({ ...filters, countries: names, locationLabel: names.length ? label : null }, names.length ? `Location set to ${label}.` : "Location cleared.");
    close();
  };
  return (
    <div className="panel-body">
      <input className="field" autoFocus placeholder="Country…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {matches.length > 0 && (
        <div className="options">
          {matches.map((c) => (
            <button key={c} onClick={() => apply([c], c)} className={selected.has(c) && selected.size === 1 ? "on" : ""}>
              {c}
            </button>
          ))}
        </div>
      )}
      <p className="panel-label">Regions</p>
      <div className="options grid">
        {Object.entries(regions).map(([name, list]) => (
          <button key={name} onClick={() => apply(list, name)} className={filters.locationLabel === name ? "on" : ""}>
            {name}
          </button>
        ))}
      </div>
      {filters.countries.length > 0 && (
        <button className="link" onClick={() => apply([], null)}>
          Anywhere
        </button>
      )}
    </div>
  );
}

function RatePanel({ filters, onFilters, close }: Pick<Props, "filters" | "onFilters"> & { close: () => void }) {
  const [min, setMin] = useState(filters.minRate?.toString() ?? "");
  const [max, setMax] = useState(filters.maxRate?.toString() ?? "");
  const apply = () => {
    const minRate = min ? Number(min) : null;
    const maxRate = max ? Number(max) : null;
    onFilters({ ...filters, minRate, maxRate }, minRate || maxRate ? `Rate set to ${rateLabel(minRate, maxRate)}.` : "Rate filter cleared.");
    close();
  };
  return (
    <form
      className="panel-body"
      onSubmit={(e) => {
        e.preventDefault();
        apply();
      }}
    >
      <p className="panel-label">Hourly rate (USD)</p>
      <div className="row">
        <input className="field" inputMode="numeric" placeholder="Min" value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ""))} />
        <span className="muted">to</span>
        <input className="field" inputMode="numeric" placeholder="Max" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ""))} />
      </div>
      <div className="options">
        {[20, 40, 70, 100].map((n) => (
          <button type="button" key={n} onClick={() => setMax(String(n))}>
            Under ${n}
          </button>
        ))}
      </div>
      <button className="apply">Apply</button>
    </form>
  );
}

function RatingPanel({ filters, onFilters, close }: Pick<Props, "filters" | "onFilters"> & { close: () => void }) {
  const set = (patch: Partial<Filters>, note: string) => {
    onFilters({ ...filters, ...patch }, note);
    close();
  };
  return (
    <div className="panel-body">
      <p className="panel-label">Minimum rating</p>
      <div className="options">
        {[null, 4.5, 4.8, 4.9].map((r) => (
          <button key={String(r)} className={filters.minRating === r ? "on" : ""} onClick={() => set({ minRating: r }, r ? `Minimum rating ${r}★.` : "Rating filter cleared.")}>
            {r ? `${r}★+` : "Any"}
          </button>
        ))}
      </div>
      <p className="panel-label">Client reviews</p>
      <div className="options">
        {[null, 5, 20, 50].map((n) => (
          <button key={String(n)} className={filters.minReviews === n ? "on" : ""} onClick={() => set({ minReviews: n }, n ? `At least ${n} reviews.` : "Review count filter cleared.")}>
            {n ? `${n}+` : "Any"}
          </button>
        ))}
      </div>
    </div>
  );
}

function rateLabel(min: number | null, max: number | null) {
  if (min != null && max != null) return `$${min}–$${max}/hr`;
  if (max != null) return `Under $${max}/hr`;
  if (min != null) return `$${min}+/hr`;
  return "Rate";
}

export default function FilterBar({ filters, spec, regions, countries, onFilters, onSpec }: Props) {
  const [adding, setAdding] = useState("");
  const location = filters.countries.length ? (filters.locationLabel ?? `${filters.countries.length} countries`) : "Location";
  const rate = rateLabel(filters.minRate, filters.maxRate);
  const rating =
    [filters.minRating != null ? `${filters.minRating}★+` : null, filters.minReviews ? `${filters.minReviews}+ reviews` : null].filter(Boolean).join(" · ") ||
    "Rating";
  const anyFilter = filters.countries.length > 0 || filters.minRate != null || filters.maxRate != null || filters.minRating != null || filters.minReviews != null;

  return (
    <div className="filterbar">
      <div className="pills">
        <Popover active={filters.countries.length > 0} trigger={<><MapPin size={14} /> {location} <ChevronDown size={14} /></>}>
          {(close) => <LocationPanel filters={filters} regions={regions} countries={countries} onFilters={onFilters} close={close} />}
        </Popover>
        <Popover active={filters.minRate != null || filters.maxRate != null} trigger={<><DollarSign size={14} /> {rate} <ChevronDown size={14} /></>}>
          {(close) => <RatePanel filters={filters} onFilters={onFilters} close={close} />}
        </Popover>
        <Popover active={filters.minRating != null || filters.minReviews != null} trigger={<><Star size={14} /> {rating} <ChevronDown size={14} /></>}>
          {(close) => <RatingPanel filters={filters} onFilters={onFilters} close={close} />}
        </Popover>
        {anyFilter && (
          <button
            className="link"
            onClick={() => onFilters({ countries: [], locationLabel: null, minRate: null, maxRate: null, minRating: null, minReviews: null }, "Cleared all filters.")}
          >
            Clear
          </button>
        )}
      </div>

      {spec.criteria.length > 0 && (
        <div className="criteria">
          <span className="criteria-label">Ranked by</span>
          {spec.criteria.map((c) => (
            <span key={c.id} className="criterion" title={`${c.description}\n${WEIGHT[c.weight]} (click the bars to change)`}>
              <button
                className="weight"
                aria-label={`${c.label}: ${WEIGHT[c.weight]}. Change importance`}
                onClick={() => {
                  const weight = ((c.weight % 3) + 1) as 1 | 2 | 3;
                  onSpec({ ...spec, criteria: spec.criteria.map((x) => (x.id === c.id ? { ...x, weight } : x)) }, `Made "${c.label}" ${WEIGHT[weight].toLowerCase()}.`);
                }}
              >
                {[1, 2, 3].map((n) => (
                  <i key={n} className={n <= c.weight ? "on" : ""} />
                ))}
              </button>
              {c.label}
              <button
                className="remove"
                aria-label={`Stop ranking by ${c.label}`}
                onClick={() => onSpec({ ...spec, criteria: spec.criteria.filter((x) => x.id !== c.id) }, `Stopped ranking by "${c.label}".`)}
              >
                <X size={12} />
              </button>
            </span>
          ))}
          <form
            className="add-criterion"
            onSubmit={(e) => {
              e.preventDefault();
              const label = adding.trim();
              if (!label) return;
              const c = criterionFrom(label);
              if (!spec.criteria.some((x) => x.id === c.id)) onSpec({ ...spec, criteria: [...spec.criteria, c] }, `Added criterion "${label}".`);
              setAdding("");
            }}
          >
            <Plus size={13} />
            <input value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add criterion" aria-label="Add criterion" />
          </form>
        </div>
      )}
    </div>
  );
}
