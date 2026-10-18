import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadCatalog } from "../src/catalog/load-files.js";
import { resolveFlatBeads } from "../src/flat/beads.js";
import { beadList, formatRow, gramsToBuy, oddTurnNote, pieceCount, renderFlatChartSvg, wordChart, wordChartText } from "../src/flat/chart.js";
import { designFromYaml } from "../src/flat/format.js";
import { emptyDesign, type FlatDesign, paintCells, trim } from "../src/flat/grid.js";

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

describe("word chart", () => {
  const load = (rows: string, canvas = "trimmed") =>
    designFromYaml(`kind: flat-peyote\ntitle: T\nbead: miyuki delica DB\nbeads:\n  A: miyuki DB-0010\n  B: miyuki DB-0201\ncanvas: ${canvas}\nfirst_column: high\nrows: |\n${rows}`);

  it("strings rows 1 and 2 together, then goes back and forth", () => {
    const chart = wordChart(load("  AB\n  BA\n"));
    if ("problem" in chart) throw new Error(chart.problem);
    expect(chart).toMatchObject({ columns: 2, rows: 4, count: "even" });
    expect(chart.lines.map(formatRow)).toEqual(["Rows 1–2 (→, string these first): 1A, 1B", "Row 3 (←): 1B", "Row 4 (→): 1A"]);
    expect(oddTurnNote(chart)).toBeUndefined();
  });

  it("joins runs and lists beads in pickup order", () => {
    const chart = wordChart(load("  AABBAA\n  ABBBBA\n"));
    if ("problem" in chart) throw new Error(chart.problem);
    // Row 3 (←) is columns 5, 3, 1 (counting from 1) of the second drawn row, right to left: B, B, A.
    expect(chart.lines.map(formatRow)).toEqual([
      "Rows 1–2 (→, string these first): 2A, 2B, 2A",
      "Row 3 (←): 2B, 1A",
      "Row 4 (→): 2B, 1A",
    ]);
  });

  it("marks the rows that need the odd-count turn", () => {
    const chart = wordChart(load("  ABA\n  BAB\n"));
    if ("problem" in chart) throw new Error(chart.problem);
    expect(chart.count).toBe("odd");
    expect(chart.lines.map(formatRow)).toEqual(["Rows 1–2 (→, string these first): 1A, 1B, 1A", "Row 3 (←): 2B", "Row 4 (→): 1A"]);
    expect(chart.lines.map((l) => l.oddTurn)).toEqual([undefined, "right", undefined]);
    expect(oddTurnNote(chart)).toBe(
      "Odd count: rows 3 start at the right edge in the column the thread comes out of, so they need the odd-count turn there.",
    );
  });

  it("says why there is no word chart yet", () => {
    expect(wordChart(load("  AB\n  BA\n", "unlimited"))).toEqual({ problem: expect.stringMatching(/^Trim the canvas first/) });
    expect(wordChart(load("  A.\n  BA\n"))).toEqual({ problem: expect.stringMatching(/^Fill the 1 empty spot first/) });
  });

  it("gives even or odd count from the columns", () => {
    expect(pieceCount(8)).toBe("even");
    expect(pieceCount(9)).toBe("odd");
  });

  it("writes the example file out as text", () => {
    const design = designFromYaml(readFileSync("patterns/flat/heart-band.flat-peyote.yaml", "utf8"));
    const chart = wordChart(design);
    if ("problem" in chart) throw new Error(chart.problem);
    const { size, beads } = resolveFlatBeads(design, catalog);
    const text = wordChartText(design, chart, beads, size.label);
    expect(text).toContain("Heart band\nMiyuki Delica 11/0 · 8 columns (even count) · 14 rows");
    expect(text).toContain("A: Miyuki Delica DB-0010 (black)");
    expect(text).toContain("Rows 1–2 (→, string these first): 8B");
    expect(text.trim().split("\n").at(-1)).toBe("Row 14 (→): 4A");
    // Every bead is in exactly one row.
    const total = chart.lines.flatMap((l) => l.runs).reduce((sum, r) => sum + r.count, 0);
    expect(total).toBe(design.cells.size);
  });
});

describe("printable chart", () => {
  const design = designFromYaml(readFileSync("patterns/flat/heart-band.flat-peyote.yaml", "utf8"));
  const { size, beads } = resolveFlatBeads(design, catalog);
  const svg = renderFlatChartSvg({ design, beads, box: size.box, shape: size.shape, sizeLabel: size.label });

  it("draws every bead, the bead list and the word chart", () => {
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg" width="180mm"')).toBe(true);
    expect(svg).toContain(">Heart band</text>");
    expect(svg).toContain("Miyuki Delica 11/0 · 8 × 14 beads · even count");
    // One rect per bead, one per bead-list swatch, and the background.
    expect(svg.match(/<rect /g)).toHaveLength(design.cells.size + 3 + 1);
    expect(svg).toContain("Row 3 (←)");
    expect(svg).toContain("Total 56");
  });

  it("marks empty spots and explains the missing word chart", () => {
    const holed = trim(paintCells(emptyDesign(), [{ c: 0, h: 0 }, { c: 2, h: 2 }], "A"));
    const out = renderFlatChartSvg({ design: holed, beads: resolveFlatBeads(holed, catalog).beads, box: size.box, shape: size.shape, sizeLabel: size.label });
    expect(out).toContain('stroke-dasharray="0.8 0.6"');
    expect(out).toContain("Fill the 3 empty spots first");
  });
});

describe("turned printable chart", () => {
  it("turns the grid a quarter turn and swaps the numbers", () => {
    const design = designFromYaml(readFileSync("patterns/flat/heart-band.flat-peyote.yaml", "utf8"));
    const { size, beads } = resolveFlatBeads(design, catalog);
    const svg = renderFlatChartSvg({ design, beads, box: size.box, shape: size.shape, sizeLabel: size.label, turned: true });
    expect(svg).toMatch(/<g transform="translate\([\d.]+ 36\) rotate\(90\)">/);
    expect(svg.match(/<rect /g)).toHaveLength(design.cells.size + 3 + 1);
  });
});
