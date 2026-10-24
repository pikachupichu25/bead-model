import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { checkCatalog, parseBrand, resolveBeads } from "../src/catalog/catalog.js";
import { loadCatalog } from "../src/catalog/load-files.js";

const catalog = loadCatalog("catalog/beads");
const resolve = (entry: unknown) => resolveBeads({ A: entry }, catalog).get("A")!;

describe("catalog files", () => {
  it("load without warnings", () => {
    expect([...catalog.keys()].sort()).toEqual(["generic", "miyuki", "preciosa", "toho"]);
    expect(checkCatalog(catalog)).toEqual([]);
  });

  it("reject bad entries", () => {
    const brand = (lines: string) => () => parseBrand(parseYaml(`brand: x\nlines:\n${lines}`), "x.yaml");
    expect(brand("  a: { shape: blob, sizes: { s: { outer_diameter: 1, length: 1 } } }")).toThrow(/shape must be/);
    expect(brand("  a: { shape: round, sizes: { s: { outer_diameter: 1 } } }")).toThrow(/length is required/);
    expect(brand("  a: { shape: round, sizes: { s: { outer_diameter: { min: 2, max: 1 }, length: 1 } } }")).toThrow(
      /min is bigger than max/,
    );
    expect(
      brand(
        '  a: { shape: round, code: "{size}", sizes: { s: { outer_diameter: 1, length: 1 } } }\n' +
          '  b: { shape: cylinder, code: "{size}", sizes: { s: { outer_diameter: 1, length: 1 } } }',
      ),
    ).toThrow(/two lines produce the product code/);
    expect(
      brand(
        "  a: { shape: round, sizes: { s: { outer_diameter: 1, length: 1 } }, colors: { c1: { sizes: [t], display: { rgb: '#000' } } } }",
      ),
    ).toThrow(/lists size t/);
  });
});

describe("resolveBeads", () => {
  it("finds a bead by brand and product code", () => {
    const bead = resolve("miyuki DB-0010");
    expect(bead).toMatchObject({
      label: "Miyuki Delica DB-0010 (black)",
      shape: "cylinder",
      outerDiameter: 1.6,
      length: 1.3,
      basis: { outerDiameter: "official", length: "derived" },
      display: { rgb: "#151515" },
      warnings: [],
    });
  });

  it("tells sizes of the same line apart", () => {
    expect(resolve("miyuki DBS-0010").outerDiameter).toBe(1.3);
    expect(resolve("miyuki 11-401")).toMatchObject({ shape: "round", outerDiameter: 2.0, length: 1.45 });
  });

  it("finds a bead from written-out fields", () => {
    expect(resolve({ brand: "toho", line: "round", size: "11", color: "49F" })).toMatchObject({
      outerDiameter: 2.2,
      display: { finish: ["matte"] },
    });
  });

  it("finds a Toho Treasure by product code, in either size", () => {
    expect(resolve("toho TT-01-41")).toMatchObject({ shape: "cylinder", outerDiameter: 1.8, length: 1.3, warnings: [] });
    expect(resolve("toho TT-08-557")).toMatchObject({ outerDiameter: 3.3, display: { finish: ["metallic"] } });
  });

  it("uses the middle of a size range", () => {
    expect(resolve("preciosa 10/0 23980").outerDiameter).toBeCloseTo(2.3);
  });

  it("keeps the size but uses a placeholder color for an unknown color code", () => {
    const bead = resolve("miyuki DB-9999");
    expect(bead.outerDiameter).toBe(1.6);
    expect(bead.warnings).toEqual([expect.stringMatching(/color 9999 isn't in the catalog/)]);
  });

  it("falls back to a generic bead and warns that its size is an estimate", () => {
    const bead = resolve({ size: "15/0", shape: "round", color: "silver-lined crystal" });
    expect(bead).toMatchObject({ label: "Round seed bead 15/0 (silver-lined crystal)", outerDiameter: 1.5 });
    expect(bead.warnings).toEqual([expect.stringMatching(/size is an estimate/)]);
  });

  it("falls back to a generic round 11/0 when the bead is unknown", () => {
    const bead = resolve({ size: "unknown", shape: "unknown" });
    expect(bead).toMatchObject({ shape: "round", outerDiameter: 2.0 });
    expect(bead.warnings[0]).toMatch(/no generic bead/);
  });

  it("lets the pattern override how a bead is drawn", () => {
    expect(resolve({ bead: "miyuki DB-0010", display: { rgb: "#203040" } }).display.rgb).toBe("#203040");
  });

  it("gives beads without a catalog color distinct colors", () => {
    const beads = resolveBeads({ A: {}, B: {} }, catalog);
    expect(beads.get("A")!.display.rgb).not.toBe(beads.get("B")!.display.rgb);
  });
});
