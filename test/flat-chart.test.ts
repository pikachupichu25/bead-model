import { describe, expect, it } from "vitest";
import { loadCatalog } from "../src/catalog/load-files.js";
import { resolveFlatBeads } from "../src/flat/beads.js";
import { beadList, gramsToBuy } from "../src/flat/chart.js";
import { emptyDesign, type FlatDesign, paintCells } from "../src/flat/grid.js";

const catalog = loadCatalog("catalog/beads");

describe("grams to buy", () => {
  it("adds 10 % spare and rounds up to the next half gram", () => {
    // Delica 11/0: 200 beads per gram.
    expect(gramsToBuy(200, 200)).toBe(1.5); // 220 beads = 1.1 g
    expect(gramsToBuy(90, 200)).toBe(0.5); // 99 beads = 0.495 g
    expect(gramsToBuy(100, 200)).toBe(1); // 110 beads = 0.55 g
    expect(gramsToBuy(0, 200)).toBe(0);
  });

  it("is unknown without beads per gram", () => {
    expect(gramsToBuy(100, undefined)).toBeUndefined();
  });
});

describe("bead list", () => {
  const row = (count: number) => Array.from({ length: count }, (_, i) => ({ c: 2 * i, h: 0 }));

  it("lists every bead in key order with counts, grams and totals", () => {
    let design: FlatDesign = {
      ...emptyDesign(),
      beads: new Map<string, unknown>([
        ["A", "miyuki DB-0010"],
        ["B", { color: "coral", display: { rgb: "#f2795b" } }],
        ["C", "miyuki DB-0201"],
      ]),
    };
    design = paintCells(design, row(300), "A");
    design = paintCells(design, row(10).map((c) => ({ c: c.c, h: 2 })), "B");
    const { rows, total } = beadList(design, resolveFlatBeads(design, catalog).beads);
    expect(rows.map((r) => [r.key, r.count, r.grams])).toEqual([
      ["A", 300, 2],
      ["B", 10, 0.5],
      ["C", 0, 0],
    ]);
    expect(rows[0]!.label).toBe("Miyuki Delica DB-0010 (black)");
    expect(rows[1]!.rgb).toBe("#f2795b");
    expect(total).toEqual({ count: 310, grams: 2.5 });
  });

  it("leaves the total grams out when a bead's weight is unknown", () => {
    const design = paintCells(
      { ...emptyDesign("generic cylinder 11/0"), beads: new Map([["A", { color: "red", display: { rgb: "#f00" } }]]) },
      row(5),
      "A",
    );
    const { rows, total } = beadList(design, resolveFlatBeads(design, catalog).beads);
    expect(rows[0]!.grams).toBeUndefined();
    expect(total).toEqual({ count: 5, grams: undefined });
  });
});
