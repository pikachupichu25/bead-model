import { describe, expect, it } from "vitest";
import { catalogFromFiles } from "../src/catalog/catalog.js";
import { loadCatalog, loadPalettes } from "../src/catalog/load-files.js";
import { paletteFromText, paletteToText } from "../src/collection/palette-text.js";
import type { Palette } from "../src/collection/palettes.js";

const catalog = loadCatalog("catalog/beads");
const presets = loadPalettes("catalog/palettes");

const read = (text: string) => paletteFromText(text, catalog);

describe("a palette as text", () => {
  const ocean: Palette = {
    id: "ocean",
    name: "Ocean",
    description: "Deep blues.",
    tags: ["blue", "sea"],
    colors: [{ bead: "miyuki DB-0726", role: "dark" }, { bead: "miyuki DB-0149" }, { rgb: "#2a6f97", name: "sea blue" }],
  };

  it("is written with a header and the catalog names as comments", () => {
    expect(paletteToText(ocean, catalog)).toBe(
      [
        "Palette: Ocean",
        "Description: Deep blues.",
        "Tags: blue, sea",
        "",
        "miyuki DB-0726 [dark]  # opaque cobalt",
        "miyuki DB-0149         # silver-lined capri blue",
        "#2a6f97 sea blue",
        "",
      ].join("\n"),
    );
  });

  it("reads back as the same palette, for every preset", () => {
    for (const p of [ocean, ...presets]) {
      const { palette, problems } = read(paletteToText(p, catalog));
      const { id: _, ...rest } = p;
      expect(problems, p.id).toEqual([]);
      expect(palette, p.id).toEqual(rest);
    }
  });
});

describe("reading a palette from text", () => {
  it("takes codes without a brand, lists on one line, and labels after a code", () => {
    const { palette, problems } = read("db-0010, DB-0201; #2A6F97\nmiyuki DB-0726 opaque cobalt (accent)\n11-401 black");
    expect(problems).toEqual([]);
    expect(palette).toEqual({
      name: "Imported palette",
      colors: [
        { bead: "miyuki DB-0010" },
        { bead: "miyuki DB-0201" },
        { rgb: "#2a6f97", name: expect.any(String) },
        { bead: "miyuki DB-0726", role: "accent" },
        { bead: "miyuki 11-401" },
      ],
    });
  });

  it("names a hex color after the nearest catalog color, or by its hex", () => {
    expect(read("#151515").palette?.colors).toEqual([{ rgb: "#151515", name: "black" }]);
    expect(read("#f0f").palette?.colors).toEqual([{ rgb: "#ff00ff", name: "#ff00ff" }]);
  });

  it("skips comments, blank lines and headers it doesn't use", () => {
    const { palette, problems } = read("# my favourites\nPalette: Night\nAuthor: me\n\n#151515 ink  # the darkest\n");
    expect(problems).toEqual([]);
    expect(palette).toEqual({ name: "Night", colors: [{ rgb: "#151515", name: "ink" }] });
  });

  it("says which lines it couldn't use, and keeps the rest", () => {
    const { palette, problems } = read("miyuki DB-0010\nmiyuki DB-9999\nDB-9999\nsparkly\nmiyuki db-0010");
    expect(palette?.colors).toEqual([{ bead: "miyuki DB-0010" }]);
    expect(problems).toEqual([
      { line: 2, message: '"miyuki DB-9999" isn\'t in the catalog' },
      { line: 3, message: '"DB-9999" isn\'t in the catalog' },
      { line: 4, message: '"sparkly" isn\'t a bead code or a #rrggbb color' },
    ]);
  });

  it("asks for the brand when two brands have the code", () => {
    const brand = (id: string) => ({ name: `${id}.yaml`, text: `brand: ${id}\nname: ${id}\nlines:\n  r:\n    name: R\n    shape: round\n    code: "{size}-{color}"\n    sizes:\n      "11": { label: 11/0, outer_diameter: 2, length: 1.5 }\n    colors:\n      "1": { name: one, display: { rgb: "#111111" } }\n` });
    const two = catalogFromFiles([brand("aa"), brand("bb")]);
    expect(paletteFromText("11-1", two).problems[0]).toEqual({ line: 1, message: '"11-1" could be aa 11-1 or bb 11-1: add the brand' });
    expect(paletteFromText("bb 11-1", two).palette?.colors).toEqual([{ bead: "bb 11-1" }]);
  });

  it("gives nothing without a color, and keeps at most 62", () => {
    expect(read("Palette: Empty\n")).toEqual({ problems: [{ line: 0, message: "No colors found" }] });
    const many = Array.from({ length: 70 }, (_, i) => `#${i.toString(16).padStart(2, "0")}0000 c${i}`).join("\n");
    const { palette, problems } = read(many);
    expect(palette?.colors).toHaveLength(62);
    expect(problems[0]?.message).toMatch(/at most 62/);
  });

  it("also reads the preset YAML and JSON, without an id", () => {
    const yaml = "name: Sea\ntags: [Blue]\ncolors:\n  - { bead: miyuki DB-0726 }\n  - { bead: miyuki DB-9999 }\n";
    expect(read(yaml)).toEqual({
      palette: { name: "Sea", tags: ["blue"], colors: [{ bead: "miyuki DB-0726" }] },
      problems: [{ line: 1, message: '"miyuki DB-9999" isn\'t in the catalog' }],
    });
    expect(read('{ "colors": [{ "rgb": "#2a6f97", "name": "sea" }] }').palette).toEqual({ name: "Imported palette", colors: [{ rgb: "#2a6f97", name: "sea" }] });
    expect(read("{ not json").problems[0]?.message).toMatch(/JSON/);
    expect(read("colors: []").problems[0]?.message).toMatch(/at least one color/);
  });
});
