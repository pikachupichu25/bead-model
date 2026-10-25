import { describe, expect, it } from "vitest";
import {
  emptyMyDesigns,
  exampleId,
  type FeedItem,
  findDesign,
  isPinned,
  matchesDesign,
  MyDesignsError,
  myDesignsFromJson,
  myDesignsToJson,
  newDesignId,
  orderFeed,
  putDesign,
  removeDesign,
  type SavedDesign,
  setPinned,
  titleOfYaml,
} from "../src/collection/designs.js";

const design = (id: string, updated: number, extra: Partial<SavedDesign> = {}): SavedDesign => ({
  id,
  kind: "flat",
  title: `Design ${id}`,
  yaml: `title: Design ${id}\n`,
  created: updated,
  updated,
  ...extra,
});

describe("my designs list", () => {
  it("adds a design, and replaces it by id", () => {
    let list = putDesign(emptyMyDesigns(), design("a", 1));
    list = putDesign(list, design("b", 2));
    list = putDesign(list, design("a", 3, { title: "Renamed" }));
    expect(list.designs.map((d) => d.id).sort()).toEqual(["a", "b"]);
    expect(findDesign(list, "a")?.title).toBe("Renamed");
  });

  it("takes a deleted design's pin with it", () => {
    let list = putDesign(emptyMyDesigns(), design("a", 1));
    list = setPinned(list, "a", true);
    list = setPinned(list, exampleId("peyote", "07-whale"), true);
    list = removeDesign(list, "a");
    expect(list.designs).toEqual([]);
    expect(list.pinned).toEqual(["example:peyote:07-whale"]);
  });

  it("pins newest first, and unpins", () => {
    let list = setPinned(emptyMyDesigns(), "a", true);
    list = setPinned(list, "b", true);
    list = setPinned(list, "a", true);
    expect(list.pinned).toEqual(["a", "b"]);
    list = setPinned(list, "a", false);
    expect(isPinned(list, "a")).toBe(false);
    expect(list.pinned).toEqual(["b"]);
  });

  it("round-trips through JSON", () => {
    const list = setPinned(putDesign(emptyMyDesigns(), design("a", 5)), "a", true);
    expect(myDesignsFromJson(myDesignsToJson(list))).toEqual(list);
  });

  it("drops entries it can't read, and repeated ids", () => {
    const text = JSON.stringify({
      version: 1,
      designs: [design("a", 1), { id: "b", kind: "crochet", yaml: "" }, { id: "c", kind: "nora" }, { ...design("a", 9), title: "  " }, "x"],
      pinned: ["a", 3, "a"],
    });
    const list = myDesignsFromJson(text);
    expect(list.designs.map((d) => d.id)).toEqual(["a"]);
    expect(list.designs[0]!.updated).toBe(1);
    expect(list.pinned).toEqual(["a"]);
  });

  it("names a design with no title", () => {
    const list = myDesignsFromJson(JSON.stringify({ designs: [{ id: "a", kind: "nora", yaml: "", title: "" }] }));
    expect(list.designs[0]!.title).toBe("Untitled design");
  });

  it("refuses what isn't a list", () => {
    expect(() => myDesignsFromJson("nope")).toThrow(MyDesignsError);
    expect(() => myDesignsFromJson("{}")).toThrow(MyDesignsError);
  });

  it("makes ids that differ", () => {
    expect(newDesignId(1000, 0.1)).not.toBe(newDesignId(1000, 0.2));
    expect(newDesignId(1000, 0.1)).toMatch(/^d[0-9a-z]+$/);
  });
});

describe("the feed", () => {
  const item = (id: string, updated?: number, example = false): FeedItem => ({ id, kind: "peyote", title: id, yaml: "", updated, ...(example && { example }) });

  it("puts pins first, then mine newest first, then the examples by title", () => {
    const items = [item("old", 1), item("zebra", undefined, true), item("new", 5), item("apple", undefined, true), item("mid", 3)];
    expect(orderFeed(items, ["zebra", "old"]).map((i) => i.id)).toEqual(["zebra", "old", "new", "mid", "apple"]);
  });

  it("searches the title and the technique, every word", () => {
    const whale = { title: "Whale", kind: "peyote" as const };
    expect(matchesDesign(whale, "wha")).toBe(true);
    expect(matchesDesign(whale, "circular whale")).toBe(true);
    expect(matchesDesign(whale, "flat whale")).toBe(false);
    expect(matchesDesign({ title: "Flower", kind: "nora" }, "NORA")).toBe(true);
  });

  it("reads a design file's title", () => {
    expect(titleOfYaml("format: x\ntitle: \"Heart band\"\nbead: y\n")).toBe("Heart band");
    expect(titleOfYaml("bead: y\n")).toBeUndefined();
  });
});
