import { describe, it, expect } from "vitest";
import { sortRows, compareRows } from "./sort";

type Row = { name: string; n?: number };

describe("sortRows", () => {
  const rows: Row[] = [
    { name: "beta", n: 2 },
    { name: "alpha", n: 10 },
    { name: "gamma", n: 1 },
  ];

  it("sorts string columns ascending via localeCompare", () => {
    const out = sortRows(rows, { key: "name", dir: "asc" });
    expect(out.map((r) => r.name)).toEqual(["alpha", "beta", "gamma"]);
  });

  it("sorts string columns descending", () => {
    const out = sortRows(rows, { key: "name", dir: "desc" });
    expect(out.map((r) => r.name)).toEqual(["gamma", "beta", "alpha"]);
  });

  it("sorts numeric columns ascending", () => {
    const out = sortRows(rows, { key: "n", dir: "asc" });
    expect(out.map((r) => r.n)).toEqual([1, 2, 10]);
  });

  it("treats null/undefined numeric values as 0", () => {
    const data: Row[] = [{ name: "a", n: 5 }, { name: "b" }, { name: "c", n: -1 }];
    const out = sortRows(data, { key: "n", dir: "asc" });
    expect(out.map((r) => r.n)).toEqual([-1, undefined, 5]);
  });

  it("does not mutate the input array", () => {
    const original = [...rows];
    sortRows(rows, { key: "name", dir: "asc" });
    expect(rows).toEqual(original);
  });
});

describe("compareRows", () => {
  it("returns the sign of the comparison scaled by direction", () => {
    expect(compareRows({ name: "a" }, { name: "b" }, { key: "name", dir: "asc" })).toBeLessThan(0);
    expect(compareRows({ name: "a" }, { name: "b" }, { key: "name", dir: "desc" })).toBeGreaterThan(0);
    expect(compareRows({ n: 3 }, { n: 3 }, { key: "n", dir: "asc" })).toBe(0);
  });
});
