import type { Criterion } from "./types.ts";

export function slug(label: string) {
  return (
    label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "criterion"
  );
}

/** A criterion typed into the UI by hand. */
export function criterionFrom(label: string, weight: 1 | 2 | 3 = 2): Criterion {
  return { id: slug(label), label, description: `Has delivered work involving ${label}.`, weight };
}
