import { describe, expect, it } from "vitest";
import { loadCatalog, loadPalettes } from "../src/catalog/load-files.js";
import { isOwned, offeredColors, offeredProducts, readColorSource } from "../src/collection/color-source.js";
import { addOwned, emptyMyBeads } from "../src/collection/my-beads.js";
import {
  copyPalette,
  emptyMyPalettes,
  mergeMyPalettes,
  type MyPalette,
  myPalettesFromJson,
  myPalettesToJson,
  newPaletteId,
  paletteFromEntries,
  putMyPalette,
  removeMyPalette,
} from "../src/collection/my-palettes.js";
import { checkPalettes, MAX_DELTA_E, type Palette, PaletteError, paletteColorsFor, palettesFromFiles, parsePalette } from "../src/collection/palettes.js";
import { resolveBeadSize } from "../src/flat/beads.js";

const catalog = loadCatalog("catalog/beads");
const presets = loadPalettes("catalog/palettes");
const delica = resolveBeadSize(catalog, "miyuki delica DB");
const miyukiRound = resolveBeadSize(catalog, "miyuki round 11");
const generic = resolveBeadSize(catalog, "generic round 11/0");

const palette = (colors: Palette["colors"]): Palette => ({ id: "test", name: "Test", colors });

describe("preset palettes", () => {
  it("load, and every product is in the catalog", () => {
    expect(presets.length).toBeGreaterThanOrEqual(6);
    expect(checkPalettes(presets, catalog)).toEqual([]);
    expect(new Set(presets.map((p) => p.id)).size).toBe(presets.length);
  });

  it("each offer at least two colors in Delica 11/0", () => {
    for (const p of presets) expect(paletteColorsFor(p, delica, catalog).length, p.id).toBeGreaterThanOrEqual(2);
  });
});

describe("reading a palette", () => {
  it("reads products and colors by value", () => {
    const p = parsePalette({ id: "sea", name: " Sea ", colors: [{ bead: "miyuki DB-0010", role: "dark" }, { rgb: "#2A6F97", name: "sea blue" }] }, "sea.yaml");
    expect(p).toEqual({ id: "sea", name: "Sea", colors: [{ bead: "miyuki DB-0010", role: "dark" }, { rgb: "#2a6f97", name: "sea blue" }] });
  });

  it("says what's wrong", () => {
    expect(() => parsePalette({ id: "Sea", name: "x", colors: [{ bead: "miyuki DB-0010" }] }, "a.yaml")).toThrow(/a.yaml: `id`/);
    expect(() => parsePalette({ id: "sea", name: "x", colors: [] }, "a.yaml")).toThrow(/at least one color/);
    expect(() => parsePalette({ id: "sea", name: "x", colors: [{ rgb: "#123456" }] }, "a.yaml")).toThrow(/needs a name/);
    expect(() => parsePalette({ id: "sea", name: "x", colors: [{ bead: "x", role: "loud" }] }, "a.yaml")).toThrow(PaletteError);
    const file = "id: a\nname: A\ncolors: [{ bead: miyuki DB-0010 }]\n";
    expect(() => palettesFromFiles([{ name: "a.yaml", text: file }, { name: "b.yaml", text: file }])).toThrow(/defined twice/);
  });

  it("reports products the catalog doesn't have", () => {
    expect(checkPalettes([palette([{ bead: "miyuki DB-9999" }])], catalog)).toEqual(['palette test: "miyuki DB-9999" isn\'t in the catalog']);
  });
});

describe("a palette in a bead size", () => {
  it("uses a product of this size as it is", () => {
    expect(paletteColorsFor(palette([{ bead: "miyuki DB-0726" }]), delica, catalog)).toEqual([
      { entry: "miyuki DB-0726", name: "opaque cobalt", rgb: "#1c2f7a", code: "DB-0726" },
    ]);
  });

  it("matches other sizes and colors by value to the nearest catalog color", () => {
    const [black] = paletteColorsFor(palette([{ bead: "miyuki DB-0010" }]), miyukiRound, catalog);
    expect(black!.entry).toMatch(/^miyuki 11-/);
    expect(black!.nearest?.name).toBe("black");
    expect(black!.nearest!.deltaE).toBeLessThanOrEqual(MAX_DELTA_E);
    const [blue] = paletteColorsFor(palette([{ rgb: "#1c2f7a", name: "navy" }]), delica, catalog);
    expect(blue).toMatchObject({ entry: "miyuki DB-0726", nearest: { name: "navy" } });
  });

  it("makes a color of my own when nothing in this size is close", () => {
    const [own] = paletteColorsFor(palette([{ rgb: "#2a6f97", name: "sea blue" }]), generic, catalog);
    expect(own).toEqual({ entry: { color: "sea blue", display: { rgb: "#2a6f97" } }, name: "sea blue", rgb: "#2a6f97", code: "own" });
  });

  it("counts two colors that land on the same bead once", () => {
    expect(paletteColorsFor(palette([{ bead: "miyuki DB-0010" }, { rgb: "#151515", name: "black" }]), delica, catalog)).toHaveLength(1);
  });

  it("leaves out a product the catalog doesn't have", () => {
    expect(paletteColorsFor(palette([{ bead: "miyuki DB-9999" }]), delica, catalog)).toEqual([]);
  });
});

describe("color source", () => {
  const ocean = presets.find((p) => p.id === "ocean")!;
  const mine = [{ kind: "catalog", bead: "miyuki DB-0726" } as const, { kind: "own", size: "miyuki delica DB", name: "rose", rgb: "#c48a90" } as const].reduce(
    addOwned,
    emptyMyBeads(),
  );
  const context = { myBeads: mine, palettes: presets, catalog };

  it("reads the saved setting, falling back to every catalog color", () => {
    expect(readColorSource("mine", presets)).toBe("mine");
    expect(readColorSource("palette:ocean", presets)).toBe("palette:ocean");
    expect(readColorSource("palette:gone", presets)).toBe("all");
    expect(readColorSource(null, presets)).toBe("all");
  });

  it("offers every catalog color, my beads, or a palette", () => {
    expect(offeredColors("all", delica, context)).toHaveLength(190);
    expect(offeredColors("mine", delica, context).map((c) => c.code)).toEqual(["DB-0726", "own"]);
    const offered = offeredColors(`palette:${ocean.id}`, delica, context);
    expect(offered.map((c) => c.entry)).toEqual(ocean.colors.map((c) => ("bead" in c ? c.bead : "")));
    expect(offered.filter((c) => c.mine).map((c) => c.code)).toEqual(["DB-0726"]);
  });

  it("offers a palette's products in every size, for the Circular editor", () => {
    expect(offeredProducts("all", context)).toBeUndefined();
    expect(offeredProducts("mine", context)).toEqual(new Set(["miyuki db-0726"]));
    const bw = offeredProducts("palette:black-and-white", context)!;
    expect(bw.has("miyuki db-0010")).toBe(true);
    expect([...bw].some((code) => code.startsWith("toho "))).toBe(true);
  });

  it("knows my own colors", () => {
    expect(isOwned(mine, delica, { color: "rose", display: { rgb: "#c48a90" } })).toBe(true);
    expect(isOwned(mine, delica, "miyuki DB-0010")).toBe(false);
  });
});

describe("my palettes", () => {
  const sea: MyPalette = { id: "my-sea", name: "Sea", colors: [{ bead: "miyuki DB-0726" }], visibility: "public" };

  it("read as private unless they say public, and drop what isn't one", () => {
    const list = myPalettesFromJson(
      JSON.stringify({ palettes: [sea, { ...sea, id: "my-b", visibility: "everyone" }, { ...sea, id: "ocean" }, { ...sea, id: "my-sea" }, "x"] }),
    );
    expect(list.palettes.map((p) => [p.id, p.visibility])).toEqual([["my-sea", "public"], ["my-b", "private"]]);
    expect(myPalettesFromJson("not json").palettes).toEqual([]);
    expect(myPalettesFromJson(myPalettesToJson(list))).toEqual(list);
  });

  it("are made from a design's beads", () => {
    const p = paletteFromEntries(" Heart ", ["miyuki DB-0010", { color: "rose", display: { rgb: "#C48A90" } }, "miyuki DB-0010", { brand: "x" }], "my-x");
    expect(p).toEqual({ id: "my-x", name: "Heart", colors: [{ bead: "miyuki DB-0010" }, { rgb: "#c48a90", name: "rose" }], visibility: "private" });
    expect(paletteFromEntries("Empty", [{ brand: "x" }])).toBeUndefined();
    expect(newPaletteId(() => 0)).toBe("my-0000000000");
  });

  it("come back from a backup as private, without replacing mine", () => {
    let list = putMyPalette(emptyMyPalettes(), { ...sea, name: "Mine" });
    list = mergeMyPalettes(list, { version: 1, palettes: [sea, { ...sea, id: "my-new" }] });
    expect(list.palettes.map((p) => [p.id, p.name, p.visibility])).toEqual([["my-sea", "Mine", "public"], ["my-new", "Sea", "private"]]);
    expect(removeMyPalette(list, "my-sea").palettes.map((p) => p.id)).toEqual(["my-new"]);
  });

  it("copy someone's palette as a new private one", () => {
    expect(copyPalette(sea, "my-copy")).toEqual({ ...sea, id: "my-copy", visibility: "private" });
  });

  it("can be a color source", () => {
    expect(readColorSource("palette:my-sea", [...presets, sea])).toBe("palette:my-sea");
    expect(offeredColors("palette:my-sea", delica, { myBeads: emptyMyBeads(), palettes: [sea], catalog }).map((c) => c.code)).toEqual(["DB-0726"]);
  });

  it("can't take a preset's place", () => {
    expect(() => palettesFromFiles([{ name: "a.yaml", text: "id: my-a\nname: A\ncolors: [{ bead: miyuki DB-0010 }]\n" }])).toThrow(/"my-" ids/);
  });
});
