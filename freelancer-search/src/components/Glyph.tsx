import type { Fit } from "../../shared/types.ts";

export const FIT_LABEL: Record<Fit, string> = {
  direct: "Delivered for clients",
  adjacent: "Related work",
  claimed: "Claimed only",
  none: "No evidence",
};

const SHARE: Record<Fit, number> = { none: 0, claimed: 0.25, adjacent: 0.5, direct: 1 };

/** A pie slice of the inner disc, clockwise from 12 o'clock. */
function slice(share: number) {
  const r = 3.5;
  if (share >= 1) return `M7 ${7 - r}a${r} ${r} 0 1 1 0 ${2 * r}a${r} ${r} 0 1 1 0 ${-2 * r}`;
  const angle = share * 2 * Math.PI;
  const x = 7 + r * Math.sin(angle);
  const y = 7 - r * Math.cos(angle);
  return `M7 7L7 ${7 - r}A${r} ${r} 0 ${share > 0.5 ? 1 : 0} 1 ${x} ${y}Z`;
}

/** How strong the evidence is for one criterion: the ring fills as it moves from claims to delivered work. */
export function EvidenceGlyph({ fit }: { fit: Fit }) {
  const share = SHARE[fit];
  return (
    <svg className={`glyph ${fit}`} viewBox="0 0 14 14" role="img" aria-label={FIT_LABEL[fit]}>
      <circle cx="7" cy="7" r="6" />
      {share > 0 && <path d={slice(share)} />}
    </svg>
  );
}
