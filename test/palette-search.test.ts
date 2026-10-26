import { describe, expect, it } from "vitest";
import { loadCatalog, loadPalettes } from "../src/catalog/load-files.js";
import { paletteEntry, searchPalettes, topTags } from "../src/collection/palette-search.js";
import { readTags } from "../src/collection/palettes.js";

const catalog = loadCatalog("catalog/beads");
const presets = loadPalettes("catalog/palettes");
const entries = presets.map((p) => paletteEntry(p, "preset", catalog));
const mine = paletteEntry(
  { id: "my-rose", name: "Rose garden", tags: ["flowers"], colors: [{ rgb: "#c48a90", name: "dusty rose" }, { bead: "miyuki DB-0724" }] },
  "public",
  catalog,
  { owner: "u1", by: "Kim" },
);
const all = [...entries, mine];
const ids = (query: Parameters<typeof searchPalettes>[1]) => searchPalettes(all, query).map((e) => e.palette.id);

describe("searching palettes", () => {
  it("finds every palette with no search", () => {
    expect(ids({ text: "" })).toHaveLength(all.length);
  });

  it("finds by name, tag, owner and color name, every word", () => {
    expect(ids({ text: "ocean" })).toEqual(["ocean"]);
    expect(ids({ text: "Holiday" })).toEqual(["christmas"]);
    expect(ids({ text: "kim" })).toEqual(["my-rose"]);
    expect(ids({ text: "dusty" })).toEqual(["my-rose"]);
    expect(ids({ text: "sea cool" })).toEqual(["ocean"]);
    expect(ids({ text: "ocean holiday" })).toEqual([]);
  });

  it("finds by a color word, even when no color is called that", () => {
    expect(ids({ text: "turquoise" })).toContain("ocean");
    expect(ids({ text: "pink" })).toEqual(expect.arrayContaining(["pastel", "my-rose"]));
    expect(ids({ text: "pink" })).not.toContain("forest");
    // A gray isn't blue.
    expect(ids({ text: "blue" })).not.toContain("neutrals");
  });

  it("finds by a picked color, closest first", () => {
    const found = ids({ text: "", color: "#1c2f7a" });
    expect(found[0]).toBe("ocean");
    expect(found).not.toContain("pastel");
    expect(ids({ text: "#1c2f7a" })).toEqual(expect.arrayContaining(["ocean", "rainbow"]));
  });

  it("filters by tags", () => {
    expect(ids({ text: "", tags: ["warm"] })).toEqual(["sunset"]);
    expect(ids({ text: "", tags: ["red", "holiday"] })).toEqual(["christmas"]);
  });

  it("lists the most used tags", () => {
    expect(topTags(all, 3)).toEqual(["black", "green", "red"]);
  });
});

describe("tags", () => {
  it("are kept lower case, without repeats, and never fail", () => {
    expect(readTags(" Ocean, cool ,OCEAN,, summer  days")).toEqual(["ocean", "cool", "summer days"]);
    expect(readTags(["A", 3, "b"])).toEqual(["a", "b"]);
    expect(readTags(undefined)).toEqual([]);
    expect(readTags(Array.from({ length: 20 }, (_, i) => `t${i}`))).toHaveLength(12);
  });
});
