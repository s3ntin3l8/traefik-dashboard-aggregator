// Pure table-sort helper, lifted out of views/Tables.tsx's useSorted so the
// comparator can be unit-tested without rendering. String columns sort by
// localeCompare; everything else is treated numerically with null/undefined → 0.
import type { Sort } from "../components/ui";

export function compareRows<T extends Record<string, any>>(a: T, b: T, sort: Sort): number {
  const dir = sort.dir === "asc" ? 1 : -1;
  const av = a[sort.key];
  const bv = b[sort.key];
  if (typeof av === "string") return av.localeCompare(bv) * dir;
  return ((av || 0) - (bv || 0)) * dir;
}

export function sortRows<T extends Record<string, any>>(rows: T[], sort: Sort): T[] {
  return [...rows].sort((a, b) => compareRows(a, b, sort));
}
