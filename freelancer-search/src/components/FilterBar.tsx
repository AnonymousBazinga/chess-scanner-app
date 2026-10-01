import { ListFilter, Plus, X } from "lucide-react";
import { useState } from "react";
import { criterionFrom } from "../../shared/criteria.ts";
import { emptyFilters, type Filters, type Spec } from "../../shared/types.ts";
import Menu from "./Menu.tsx";

interface Props {
  filters: Filters;
  spec: Spec;
  regions: Record<string, string[]>;
  countries: string[];
  onFilters: (f: Filters, note: string) => void;
  onSpec: (s: Spec, note: string) => void;
}

type Key = "location" | "rate" | "rating" | "reviews";

const WEIGHT = { 1: "nice to have", 2: "important", 3: "a must have" } as const;

function rateText(min: number | null, max: number | null) {
  if (min != null && max != null) return `$${min} to $${max}`;
  if (max != null) return `Under $${max}`;
  if (min != null) return `$${min} and up`;
  return "";
}

/** The second level of the filter picker: the values for one key. */
function Values({ k, filters, regions, countries, apply }: { k: Key; filters: Filters; regions: Props["regions"]; countries: string[]; apply: (patch: Partial<Filters>, note: string) => void }) {
  const [query, setQuery] = useState("");
  const [min, setMin] = useState(filters.minRate?.toString() ?? "");
  const [max, setMax] = useState(filters.maxRate?.toString() ?? "");

  if (k === "location") {
    const q = query.trim().toLowerCase();
    const regionRows = Object.entries(regions).filter(([name]) => !q || name.toLowerCase().includes(q));
    const countryRows = q ? countries.filter((c) => c.toLowerCase().includes(q)).slice(0, 8) : [];
    return (
      <>
        <input className="menu-search" autoFocus placeholder="Region or country" value={query} onChange={(e) => setQuery(e.target.value)} />
        <div className="menu-separator" />
        {regionRows.map(([name, list]) => (
          <button key={name} className="menu-row" role="menuitemradio" aria-checked={filters.locationLabel === name} onClick={() => apply({ countries: list, locationLabel: name }, `Location set to ${name}.`)}>
            {name}
            <span className="hint">Region</span>
          </button>
        ))}
        {countryRows.map((c) => (
          <button key={c} className="menu-row" role="menuitemradio" aria-checked={filters.locationLabel === c} onClick={() => apply({ countries: [c], locationLabel: c }, `Location set to ${c}.`)}>
            {c}
          </button>
        ))}
      </>
    );
  }
  if (k === "rate") {
    const custom = () => {
      const minRate = min ? Number(min) : null;
      const maxRate = max ? Number(max) : null;
      apply({ minRate, maxRate }, `Hourly rate set to ${rateText(minRate, maxRate) || "any"}.`);
    };
    return (
      <>
        {[20, 40, 70, 100].map((n) => (
          <button key={n} className="menu-row" role="menuitemradio" aria-checked={filters.maxRate === n && filters.minRate == null} onClick={() => apply({ minRate: null, maxRate: n }, `Hourly rate set to under $${n}.`)}>
            Under ${n}/hr
          </button>
        ))}
        <div className="menu-separator" />
        <form
          className="menu-pair"
          onSubmit={(e) => {
            e.preventDefault();
            custom();
          }}
        >
          <span className="muted">$</span>
          <input className="flat-input" inputMode="numeric" placeholder="Min" value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, ""))} aria-label="Minimum rate" />
          <span className="muted">to</span>
          <input className="flat-input" inputMode="numeric" placeholder="Max" value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, ""))} aria-label="Maximum rate" />
          <button className="ghost-button" type="submit">
            Apply
          </button>
        </form>
      </>
    );
  }
  if (k === "rating") {
    return (
      <>
        {[4.5, 4.8, 4.9].map((r) => (
          <button key={r} className="menu-row" role="menuitemradio" aria-checked={filters.minRating === r} onClick={() => apply({ minRating: r }, `Minimum rating set to ${r}.`)}>
            {r} stars or more
          </button>
        ))}
      </>
    );
  }
  return (
    <>
      {[5, 20, 50].map((n) => (
        <button key={n} className="menu-row" role="menuitemradio" aria-checked={filters.minReviews === n} onClick={() => apply({ minReviews: n }, `Minimum reviews set to ${n}.`)}>
          {n} or more client reviews
        </button>
      ))}
    </>
  );
}

const KEYS: { key: Key; label: string }[] = [
  { key: "location", label: "Location" },
  { key: "rate", label: "Hourly rate" },
  { key: "rating", label: "Rating" },
  { key: "reviews", label: "Client reviews" },
];

function FilterPicker(props: Omit<Props, "spec" | "onSpec"> & { start?: Key; close: () => void }) {
  const [key, setKey] = useState<Key | null>(props.start ?? null);
  const apply = (patch: Partial<Filters>, note: string) => {
    props.onFilters({ ...props.filters, ...patch }, note);
    props.close();
  };
  if (!key) {
    return (
      <>
        {KEYS.map(({ key: k, label }) => (
          <button key={k} className="menu-row" role="menuitem" onClick={() => setKey(k)}>
            {label}
            <span className="hint">{valueText(props.filters, k)}</span>
          </button>
        ))}
      </>
    );
  }
  return <Values k={key} filters={props.filters} regions={props.regions} countries={props.countries} apply={apply} />;
}

function valueText(f: Filters, k: Key): string {
  if (k === "location") return f.countries.length ? (f.locationLabel ?? `${f.countries.length} countries`) : "";
  if (k === "rate") return rateText(f.minRate, f.maxRate);
  if (k === "rating") return f.minRating != null ? `${f.minRating}+` : "";
  return f.minReviews != null ? `${f.minReviews}+` : "";
}

const CLEAR: Record<Key, Partial<Filters>> = {
  location: { countries: [], locationLabel: null },
  rate: { minRate: null, maxRate: null },
  rating: { minRating: null },
  reviews: { minReviews: null },
};

export default function FilterBar(props: Props) {
  const { filters, spec, onFilters, onSpec } = props;
  const [adding, setAdding] = useState("");
  const active = KEYS.filter(({ key }) => valueText(filters, key));

  return (
    <div className="controls">
      <div className="control-row">
        {active.map(({ key, label }) => (
          <span key={key} className="chip">
            <Menu className="chip-body" trigger={<><span className="chip-key">{label}</span> {valueText(filters, key)}</>}>
              {(close) => <FilterPicker {...props} start={key} close={close} />}
            </Menu>
            <button className="chip-x" aria-label={`Remove ${label} filter`} onClick={() => onFilters({ ...filters, ...CLEAR[key] }, `Removed the ${label.toLowerCase()} filter.`)}>
              <X size={12} />
            </button>
          </span>
        ))}
        <Menu trigger={<><ListFilter size={14} /> Filter</>}>{(close) => <FilterPicker {...props} close={close} />}</Menu>
        {active.length > 0 && (
          <button className="ghost-button" onClick={() => onFilters(emptyFilters(), "Cleared all filters.")}>
            Clear
          </button>
        )}
      </div>

      {spec.criteria.length > 0 && (
        <div className="control-row">
          <span className="control-label">Ranked by</span>
          {spec.criteria.map((c) => (
            <span key={c.id} className="chip" title={c.description}>
              <button
                className="chip-body"
                aria-label={`${c.label}, ${WEIGHT[c.weight]}. Change how much it counts`}
                title={`${c.description}\nCounts as ${WEIGHT[c.weight]}. Click to change.`}
                onClick={() => {
                  const weight = ((c.weight % 3) + 1) as 1 | 2 | 3;
                  onSpec({ ...spec, criteria: spec.criteria.map((x) => (x.id === c.id ? { ...x, weight } : x)) }, `Made "${c.label}" ${WEIGHT[weight]}.`);
                }}
              >
                <span className="weight" aria-hidden>
                  {[1, 2, 3].map((n) => (
                    <i key={n} className={n <= c.weight ? "on" : ""} />
                  ))}
                </span>
                {c.label}
              </button>
              <button className="chip-x" aria-label={`Stop ranking by ${c.label}`} onClick={() => onSpec({ ...spec, criteria: spec.criteria.filter((x) => x.id !== c.id) }, `Stopped ranking by "${c.label}".`)}>
                <X size={12} />
              </button>
            </span>
          ))}
          <form
            className="ghost-button"
            onSubmit={(e) => {
              e.preventDefault();
              const label = adding.trim();
              if (!label) return;
              const c = criterionFrom(label);
              if (!spec.criteria.some((x) => x.id === c.id)) onSpec({ ...spec, criteria: [...spec.criteria, c] }, `Added "${label}" to the ranking.`);
              setAdding("");
            }}
          >
            <Plus size={14} />
            <input className="flat-input" style={{ width: 140 }} value={adding} onChange={(e) => setAdding(e.target.value)} placeholder="Add criterion" aria-label="Add criterion" />
          </form>
        </div>
      )}
    </div>
  );
}
