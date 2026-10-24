import { describe, expect, it } from "vitest";
import { loadCatalog } from "../src/catalog/load-files.js";
import {
  addOwned,
  emptyMyBeads,
  groupMyBeads,
  mergeMyBeads,
  type MyBeads,
  MyBeadsError,
  myBeadsFromJson,
  myBeadsText,
  myBeadsToJson,
  ownedColorsFor,
  ownedId,
  ownedSizes,
  ownsProduct,
  removeOwned,
  updateOwned,
} from "../src/collection/my-beads.js";
import { resolveBeadSize } from "../src/flat/beads.js";

const catalog = loadCatalog("catalog/beads");

const list = (): MyBeads =>
  [
    { kind: "catalog", bead: "miyuki DB-0010", amount: "10 g" },
    { kind: "catalog", bead: "miyuki DB-0035" },
    { kind: "own", size: "miyuki delica DB", name: "dusty rose", rgb: "#c48a90", note: "for the whale" },
    { kind: "catalog", bead: "miyuki DBM-0010" },
  ].reduce((l, b) => addOwned(l, b as MyBeads["beads"][number]), emptyMyBeads());

describe("my beads", () => {
  it("keeps one entry per bead", () => {
    const l = addOwned(list(), { kind: "catalog", bead: "Miyuki db-0010" });
    expect(l.beads).toHaveLength(4);
    expect(ownsProduct(l, "MIYUKI DB-0010")).toBe(true);
    expect(ownsProduct(l, "miyuki DB-0201")).toBe(false);
  });

  it("updates and removes beads", () => {
    const id = ownedId({ kind: "catalog", bead: "miyuki DB-0035" });
    let l = updateOwned(list(), id, { amount: "2 tubes" });
    expect(l.beads[1]).toEqual({ kind: "catalog", bead: "miyuki DB-0035", amount: "2 tubes" });
    l = updateOwned(l, id, { amount: " " });
    expect(l.beads[1]).toEqual({ kind: "catalog", bead: "miyuki DB-0035" });
    expect(removeOwned(l, id).beads).toHaveLength(3);
  });

  it("round-trips through JSON and drops entries it can't read", () => {
    expect(myBeadsFromJson(myBeadsToJson(list()))).toEqual(list());
    const read = myBeadsFromJson(JSON.stringify({ beads: [{ kind: "catalog", bead: "toho TR-11-49F" }, { kind: "own", name: "x", size: "a", rgb: "red" }, 3] }));
    expect(read.beads).toEqual([{ kind: "catalog", bead: "toho TR-11-49F" }]);
    expect(() => myBeadsFromJson("not json")).toThrow(MyBeadsError);
    expect(() => myBeadsFromJson("{}")).toThrow(/no `beads` list/);
  });

  it("merges a backup without losing beads", () => {
    const other = addOwned(emptyMyBeads(), { kind: "catalog", bead: "miyuki DB-0010", amount: "other" });
    const merged = mergeMyBeads(list(), addOwned(other, { kind: "catalog", bead: "miyuki DB-0201" }));
    expect(merged.beads).toHaveLength(5);
    expect(merged.beads[0]!.amount).toBe("10 g");
  });

  it("groups beads by size", () => {
    const groups = groupMyBeads(list(), catalog);
    expect(groups.map((g) => g.label)).toEqual(["Miyuki Delica 11/0 (DB)", "Miyuki Delica 10/0 (DBM)"]);
    expect(groups[0]!.beads.map((b) => b.code)).toEqual(["DB-0010", "DB-0035", "own"]);
    expect(ownedSizes(list(), catalog)).toEqual(new Set(["miyuki delica DB", "miyuki delica DBM"]));
  });

  it("lists the beads a flat design in one size can use", () => {
    const colors = ownedColorsFor(list(), resolveBeadSize(catalog, "miyuki delica DB"));
    expect(colors.map((c) => c.entry)).toEqual(["miyuki DB-0010", "miyuki DB-0035", { color: "dusty rose", display: { rgb: "#c48a90" } }]);
    expect(ownedColorsFor(list(), resolveBeadSize(catalog, "toho round 11"))).toEqual([]);
  });

  it("writes readable text", () => {
    expect(myBeadsText(list(), catalog, new Date(2026, 9, 24))).toBe(
      [
        "My beads",
        "Exported 24 Oct 2026 · 4 beads in 2 sizes",
        "",
        "Miyuki Delica 11/0 (DB) · 3 beads",
        "  DB-0010  black               10 g",
        "  DB-0035  galvanized silver",
        "  own      dusty rose #c48a90        for the whale",
        "",
        "Miyuki Delica 10/0 (DBM) · 1 bead",
        "  DBM-0010  black",
        "",
      ].join("\n"),
    );
  });
});
