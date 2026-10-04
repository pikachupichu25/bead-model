import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  draftFromYaml,
  draftToYaml,
  emptyDraft,
  newRound,
  nextBeadKey,
  paintBead,
  paintRound,
  renameBeadKey,
  roundRanges,
  startCountProblem,
  writeStitches,
} from "../src/editor/draft.js";
import { compilePattern } from "../src/pattern/compile.js";
import { parsePattern } from "../src/pattern/load.js";
import { parseStitchList } from "../src/pattern/notation.js";

const compile = (yaml: string) => compilePattern(parsePattern(yaml));
const read = (name: string) => readFileSync(`patterns/${name}.peyote.yaml`, "utf8");
const keysOf = (yaml: string) => compile(yaml).beads.map((b) => b.key);

describe("draft YAML round trip", () => {
  for (const name of ["01-flat-circle", "02-rivoli-bezel-cup", "03-flat-triangle", "04-christmas-mug-trinket-box"]) {
    it(`keeps every bead of ${name}`, () => {
      const original = compile(read(name));
      const again = compile(draftToYaml(draftFromYaml(read(name))));
      expect(again.beads).toEqual(original.beads);
      expect(again.pattern.beads).toEqual(original.pattern.beads);
      expect(again.pattern.stepUp).toBe(original.pattern.stepUp);
      expect(again.rounds.map((r) => [r.tension, r.edge, r.note])).toEqual(
        original.rounds.map((r) => [r.tension, r.edge, r.note]),
      );
    });
  }

  it("numbers rounds from the start", () => {
    const draft = draftFromYaml(read("03-flat-triangle"));
    expect(roundRanges(draft)).toEqual([
      { from: 2, to: 2 },
      { from: 3, to: 10 },
    ]);
    expect(roundRanges({ ...draft, start: "tube (1A) x8" })[0]).toEqual({ from: 3, to: 3 });
  });

  it("makes a new draft with just the start ring", () => {
    const ring = compile(draftToYaml(emptyDraft("center", 5, "Five")));
    expect(ring.pattern.title).toBe("Five");
    expect(ring.rounds.map((r) => r.beads.length)).toEqual([5]);
    const tube = compile(draftToYaml(emptyDraft("tube", 24)));
    expect(tube.rounds.map((r) => r.beads.length)).toEqual([12, 12]);
  });

  it("checks the start ring size", () => {
    expect(startCountProblem("center", 3)).toBeUndefined();
    expect(startCountProblem("center", 1)).toMatch(/at least 2/);
    expect(startCountProblem("tube", 16)).toBeUndefined();
    expect(startCountProblem("tube", 15)).toMatch(/even/);
    expect(startCountProblem("tube", 2)).toMatch(/at least 4/);
    expect(startCountProblem("center", 2.5)).toMatch(/whole/);
  });
});

describe("writeStitches", () => {
  const stitches = (text: string) => parseStitchList(text).map((item) => (item.kind === "stitch" ? item.stitch : { picks: [] }));

  it("finds the shortest repeat", () => {
    expect(writeStitches(stitches("2A, 1B, 2A, 1B, 2A, 1B"))).toBe("(2A, 1B) x3");
    expect(writeStitches(stitches("1C, 1C, 1C"))).toBe("(1C) x3");
    expect(writeStitches(stitches("1A, 1B, 1C"))).toBe("1A, 1B, 1C");
    expect(writeStitches(stitches("1A+1B"))).toBe("1A+1B");
    expect(writeStitches(stitches("1C, 1A, 1B, 1A, 1B, 0"))).toBe("1C, (1A, 1B) x2, 0");
  });
});

describe("painting", () => {
  const triangle = read("03-flat-triangle");

  it("changes one bead and splits the range around its round", () => {
    const draft = draftFromYaml(triangle);
    const compiled = compile(triangle);
    const target = compiled.beads.find((b) => b.round === 5 && b.order === 4)!;
    const painted = paintBead(draft, compiled, target.id, "A");
    expect(roundRanges(painted)).toEqual([
      { from: 2, to: 2 },
      { from: 3, to: 4 },
      { from: 5, to: 5 },
      { from: 6, to: 10 },
    ]);
    const before = keysOf(triangle);
    const after = keysOf(draftToYaml(painted));
    expect(after.length).toBe(before.length);
    expect(after.filter((k, i) => k !== before[i])).toHaveLength(before[target.id] === "A" ? 0 : 1);
    expect(after[target.id]).toBe("A");
  });

  it("changes a start bead", () => {
    const yaml = read("02-rivoli-bezel-cup");
    const compiled = compile(yaml);
    const painted = paintBead(draftFromYaml(yaml), compiled, 2, "C");
    expect(keysOf(draftToYaml(painted))[2]).toBe("C");
  });

  it("changes a whole round, keeping the counts", () => {
    const compiled = compile(triangle);
    const painted = paintRound(draftFromYaml(triangle), compiled, 4, "A");
    const after = compile(draftToYaml(painted));
    expect(after.beads.filter((b) => b.round === 4).every((b) => b.key === "A")).toBe(true);
    expect(after.rounds.map((r) => r.beads.length)).toEqual(compiled.rounds.map((r) => r.beads.length));
  });
});

describe("bead keys", () => {
  it("renames a key everywhere, but not longer keys that start the same", () => {
    const draft = { ...emptyDraft(), start: "center 1A, 1A2, 1A", rounds: [newRound("(2A) x3")] };
    const renamed = renameBeadKey(draft, "A", "M");
    expect(renamed.start).toBe("center 1M, 1A2, 1M");
    expect(renamed.rounds[0]!.stitches).toBe("(2M) x3");
    expect(renamed.beads[0]!.key).toBe("M");
  });

  it("picks the next free key", () => {
    expect(nextBeadKey(emptyDraft())).toBe("B");
  });
});
