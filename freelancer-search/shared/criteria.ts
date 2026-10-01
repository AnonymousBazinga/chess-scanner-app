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

export function criterionFrom(label: string, weight: 1 | 2 | 3 = 2): Criterion {
  return { id: slug(label), label, description: `Has done work involving ${label}.`, keywords: [label], weight };
}
