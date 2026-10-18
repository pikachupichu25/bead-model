import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadCatalog } from "../src/catalog/load-files.js";
import { allBeadSizes, catalogColors, FlatBeadError, resolveBeadSize, resolveFlatBeads } from "../src/flat/beads.js";
import { designFromYaml, designToYaml, FlatFormatError, nextFlatKey } from "../src/flat/format.js";
import { type Cell, cellKey, emptyCells, emptyDesign, type FlatDesign, paintCells, parseCellKey, trim } from "../src/flat/grid.js";

const catalog = loadCatalog("catalog/beads");
const dir = "patterns/flat";
const examples = readdirSync(dir).filter((f) => f.endsWith(".flat-peyote.yaml"));

const header = (extra = "") =>
  `kind: flat-peyote\ntitle: Test\nbead: miyuki delica DB\nbeads:\n  A: miyuki DB-0010\n  B: miyuki DB-0201\n${extra}`;

/** Cells and bounds moved so the top-left cell is near (0, 0), to compare designs placed differently. */
function normalized(design: FlatDesign) {
  const all: Cell[] = [...design.cells.keys()].map(parseCellKey);
  const c0 = design.bounds?.c0 ?? Math.min(...all.map((x) => x.c));
  const h0 = design.bounds?.h0 ?? Math.min(...all.map((x) => x.h));
  // Shift by an even amount in total, so the offset is kept.
  const dc = c0 - (((c0 + h0) % 2) + 2) % 2;
  const dh = h0;
  const cells = [...design.cells].map(([key, bead]) => {
    const { c, h } = parseCellKey(key);
    return `${cellKey(c - dc, h - dh)}=${bead}`;
  });
  const bounds = design.bounds && { c0: design.bounds.c0 - dc, c1: design.bounds.c1 - dc, h0: design.bounds.h0 - dh, h1: design.bounds.h1 - dh };
  return { cells: cells.sort(), bounds };
}

describe("example files", () => {
  it("exist", () => expect(examples.length).toBeGreaterThan(0));

  for (const name of examples) {
    const text = readFileSync(`${dir}/${name}`, "utf8");

    it(`${name} saves back the same, apart from comments`, () => {
      const withoutComments = text.split("\n").filter((l) => !l.startsWith("#")).join("\n");
      expect(designToYaml(designFromYaml(text))).toBe(withoutComments);
    });

    it(`${name} has beads that fit its bead size and no empty cells`, () => {
      const design = designFromYaml(text);
      expect(resolveFlatBeads(design, catalog).problems).toEqual([]);
      expect(emptyCells(design)).toEqual([]);
    });
  }
});

describe("rows", () => {
  it("map line i, character j to cell (j, 2i + j mod 2) for a high first column", () => {
    const design = designFromYaml(header("canvas: trimmed\nfirst_column: high\nrows: |\n  AB\n  BA\n"));
    expect([...design.cells]).toEqual([
      ["0,0", "A"],
      ["1,1", "B"],
      ["0,2", "B"],
      ["1,3", "A"],
    ]);
    expect(design.bounds).toEqual({ c0: 0, c1: 1, h0: 0, h1: 3 });
  });

  it("put the first column low with first_column: low", () => {
    const design = designFromYaml(header("canvas: trimmed\nfirst_column: low\nrows: |\n  AB\n"));
    expect([...design.cells]).toEqual([
      ["1,1", "A"],
      ["2,0", "B"],
    ]);
  });

  it("mark the cells below the last row with -", () => {
    const text = header("canvas: trimmed\nfirst_column: high\nrows: |\n  ABA\n  A-A\n");
    const design = designFromYaml(text);
    expect(design.bounds).toEqual({ c0: 0, c1: 2, h0: 0, h1: 2 });
    expect(design.cells.size).toBe(5);
    expect(designToYaml(design)).toBe(text);
  });

  it("treat . as an empty cell, which a trimmed canvas keeps", () => {
    const design = designFromYaml(header("canvas: trimmed\nrows: |\n  A.\n  AA\n"));
    expect(emptyCells(design)).toEqual([{ c: 1, h: 1 }]);
  });

  it("may leave off trailing . on an unlimited canvas", () => {
    const design = designFromYaml(header("canvas: unlimited\nrows: |\n  A\n\n  .B\n"));
    expect(design.bounds).toBeUndefined();
    expect([...design.cells]).toEqual([
      ["0,0", "A"],
      ["1,5", "B"],
    ]);
  });

  it("can be empty", () => {
    const text = header("canvas: unlimited\nfirst_column: high\nrows: \"\"\n");
    expect(designFromYaml(text).cells.size).toBe(0);
    expect(designToYaml(designFromYaml(text))).toBe(text);
  });
});

describe("round trip", () => {
  const painted = paintCells(emptyDesign(), [{ c: -3, h: 1 }, { c: 4, h: 6 }, { c: 0, h: -2 }, { c: 1, h: 7 }], "A");

  for (const [label, design] of [
    ["an unlimited canvas", painted],
    ["a trimmed canvas", trim(painted)],
    ["a trimmed canvas whose first column is low", trim(paintCells(emptyDesign(), [{ c: 1, h: 1 }, { c: 2, h: 0 }, { c: 3, h: 5 }], "A"))],
    ["an odd-count width", trim(paintCells(emptyDesign(), [{ c: 0, h: 0 }, { c: 4, h: 4 }], "A"))],
  ] as const) {
    it(`keeps every bead and the offset for ${label}`, () => {
      const again = designFromYaml(designToYaml(design));
      expect(normalized(again)).toEqual(normalized(design));
      expect(designToYaml(again)).toBe(designToYaml(design));
    });
  }

  it("keeps own colors and the title", () => {
    const design: FlatDesign = {
      ...emptyDesign("generic cylinder 11/0", "Mine: a test"),
      beads: new Map<string, unknown>([["z", { color: "coral", display: { rgb: "#f2795b" } }]]),
    };
    const again = designFromYaml(designToYaml(paintCells(design, [{ c: 0, h: 0 }], "z")));
    expect(again.title).toBe("Mine: a test");
    expect(again.bead).toBe("generic cylinder 11/0");
    expect([...again.beads]).toEqual([...design.beads]);
  });
});

it("gives the first free bead key, up to 62", () => {
  expect(nextFlatKey(["A", "B", "D"])).toBe("C");
  const all: string[] = [];
  for (let i = 0; i < 62; i++) all.push(nextFlatKey(all)!);
  expect(all.at(-1)).toBe("9");
  expect(nextFlatKey(all)).toBeUndefined();
});

describe("mistakes", () => {
  const bad = (text: string, message: RegExp) => expect(() => designFromYaml(text)).toThrow(message);

  it("are reported clearly", () => {
    expect(() => designFromYaml("title: [")).toThrow(FlatFormatError);
    bad("title: x\nbead: miyuki delica DB\n", /kind must be "flat-peyote"/);
    bad("kind: flat-peyote\n", /bead is required/);
    bad(header("canvas: square\n"), /canvas must be unlimited or trimmed/);
    bad(header("first_column: up\n"), /first_column must be high or low/);
    bad(header("rows: |\n  AX\n"), /row 1, column 2: no bead "X" in beads/);
    bad(header("rows: |\n  A#\n"), /row 1, column 2: "#" isn't a bead key/);
    bad(header("rows: |\n  A B\n"), /row 1: no spaces inside a row/);
    bad(header("canvas: trimmed\nrows: |\n  A-\n  AA\n"), /"-" can only be in the last row/);
    bad(header("canvas: trimmed\nrows: |\n  AA\n  -A\n"), /row 2, column 1: "-" is inside the canvas/);
    bad("kind: flat-peyote\nbead: miyuki delica DB\nbeads:\n  AB: miyuki DB-0010\n", /bead key "AB" must be one letter or digit/);
  });
});

describe("bead size", () => {
  it("resolves from the catalog with the bead's length across the column", () => {
    const size = resolveBeadSize(catalog, "miyuki delica DB");
    expect(size.label).toBe("Miyuki Delica 11/0");
    expect(size.shape).toBe("cylinder");
    expect(size.box).toEqual({ w: 1.3, d: 1.6 });
    expect(resolveBeadSize(catalog, "generic round 11/0").label).toBe("Round seed bead 11/0");
  });

  it("lists the catalog colors that fit it, as entries that resolve back to it", () => {
    const size = resolveBeadSize(catalog, "miyuki delica DB");
    const colors = catalogColors(size);
    expect(colors.map((c) => c.entry)).toContain("miyuki DB-0010");
    const design: FlatDesign = { ...emptyDesign(), beads: new Map(colors.map((c, i) => [String.fromCharCode(65 + i), c.entry])) };
    expect(resolveFlatBeads(design, catalog).problems).toEqual([]);
    expect(catalogColors(resolveBeadSize(catalog, "generic cylinder 11/0"))).toEqual([]);
  });

  it("lists every size in the catalog, and each one resolves", () => {
    const sizes = allBeadSizes(catalog);
    expect(sizes).toContainEqual({ text: "miyuki delica DB", label: "Miyuki Delica 11/0 (DB)" });
    for (const { text } of sizes) expect(() => resolveBeadSize(catalog, text)).not.toThrow();
  });

  it("explains a bad bead size", () => {
    expect(() => resolveBeadSize(catalog, "miyuki DB")).toThrow(FlatBeadError);
    expect(() => resolveBeadSize(catalog, "nobody delica DB")).toThrow(/no brand "nobody"/);
    expect(() => resolveBeadSize(catalog, "miyuki delicas DB")).toThrow(/has no line "delicas"/);
    expect(() => resolveBeadSize(catalog, "miyuki delica XX")).toThrow(/has no size "XX" \(DBS, DB, DBM, DBL\)/);
  });

  it("flags beads of another size, and gives own colors the piece's size", () => {
    const design: FlatDesign = {
      ...emptyDesign(),
      beads: new Map<string, unknown>([
        ["A", "miyuki DB-0010"],
        ["B", "miyuki 11-401"],
        ["C", { color: "coral", display: { rgb: "#f2795b" } }],
        ["D", { brand: "toho", line: "round", size: "11", color: "49F" }],
        ["E", "miyuki NOPE-1"],
      ]),
    };
    const { beads, problems } = resolveFlatBeads(design, catalog);
    expect(problems).toEqual([
      'bead B: "miyuki 11-401" is Miyuki Round Rocailles 11/0, but this piece uses Miyuki Delica 11/0',
      "bead D: toho round 11 isn't the bead this piece uses (Miyuki Delica 11/0)",
      'bead E: "miyuki NOPE-1" isn\'t a product in the catalog',
    ]);
    const own = beads.get("C")!;
    expect(own).toMatchObject({ label: "Miyuki Delica 11/0 (coral)", shape: "cylinder", length: 1.3, outerDiameter: 1.6 });
    expect(own.display.rgb).toBe("#f2795b");
  });
});
