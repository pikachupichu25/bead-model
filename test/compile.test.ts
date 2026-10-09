import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compilePattern } from "../src/pattern/compile.js";
import { parsePattern, PatternError } from "../src/pattern/load.js";

const compile = (yaml: string) => compilePattern(parsePattern(yaml));
const reference = (name: string) => compile(readFileSync(`patterns/${name}.peyote.yaml`, "utf8"));
const counts = (yaml: string) => compile(yaml).rounds.map((r) => r.beads.length);

/** Runs `fn` and returns the issues of the PatternError it throws. */
function issues(fn: () => unknown): string[] {
  try {
    fn();
  } catch (e) {
    if (e instanceof PatternError) return e.issues;
    throw e;
  }
  throw new Error("expected a PatternError");
}

describe("reference patterns", () => {
  it("flat triangle grows by 3 beads per round", () => {
    const counts = reference("03-flat-triangle").rounds.map((r) => r.beads.length);
    expect(counts).toEqual([3, 6, 9, 12, 15, 18, 21, 24, 27, 30]);
  });

  it("flat triangle stacks each corner pair inside the corner pair before it", () => {
    const compiled = reference("03-flat-triangle");
    for (const round of compiled.rounds.slice(2)) {
      const pairs = round.beads.map((id) => compiled.beads[id]!).filter((b) => b.slotsInGap === 2);
      expect(pairs).toHaveLength(6);
      for (const bead of pairs) {
        const [left, right] = bead.between!.map((id) => compiled.beads[id]!);
        // Both up beads are the two beads of one pair in the round before.
        expect([left!.slotsInGap, right!.slotsInGap, left!.gap === right!.gap]).toEqual([2, 2, true]);
      }
    }
  });

  it("starts each round's gaps after the bead the step-up comes out of", () => {
    const compiled = reference("03-flat-triangle");
    const round3 = compiled.rounds[2]!;
    // Up bead 1 is bead 2 of round 2, the end of the step-up through the first pair.
    expect(compiled.beads[round3.upBeads[0]!]!.order).toBe(2);
  });

  it("flat circle matches the source counts", () => {
    const compiled = reference("01-flat-circle");
    expect(compiled.rounds.map((r) => r.beads.length)).toEqual([7, 7, 7, 14, 7, 21, 14]);
    expect(compiled.warnings).toEqual([expect.stringMatching(/^round 7: 14 of 21 stitches are 0/)]);
  });

  it("bezel works rounds 6 and 7 from the back edge", () => {
    const compiled = reference("02-rivoli-bezel-cup");
    const round6 = compiled.rounds.find((r) => r.round === 6)!;
    const upRound = compiled.beads[compiled.beads[round6.beads[0]!]!.between![0]]!.round;
    expect(upRound).toBe(1);
    expect(compiled.beads.filter((b) => b.round === 1).every((b) => b.key === "A")).toBe(true);
    expect(compiled.beads.filter((b) => b.round === 2).every((b) => b.key === "B")).toBe(true);
  });

  it("trinket box puts a pair in gap 1", () => {
    const compiled = reference("04-christmas-mug-trinket-box");
    expect(compiled.rounds.map((r) => r.beads.length)).toEqual([3, 4, 5]);
    const [first, second] = compiled.rounds[1]!.beads.map((id) => compiled.beads[id]!);
    expect([first!.gap, second!.gap]).toEqual([0, 0]);
  });
});

describe("steps", () => {
  it("makes a tube start's two rounds one step, numbered in stringing order", () => {
    const compiled = reference("02-rivoli-bezel-cup");
    expect(compiled.steps.map((s) => s.rounds.map((r) => r.round))).toEqual([[1, 2], [3], [4], [5], [6], [7]]);
    const first = compiled.steps[0]!.beads.map((id) => compiled.beads[id]!);
    expect(first).toHaveLength(32);
    expect(first.map((b) => b.order)).toEqual(Array.from({ length: 32 }, (_, i) => i + 1));
    expect(first.slice(0, 4).map((b) => `${b.key}${b.round}`)).toEqual(["A1", "B2", "A1", "B2"]);
    expect(first.every((b) => b.step === 0)).toBe(true);
  });

  it("makes every round of a center start its own step", () => {
    const compiled = reference("03-flat-triangle");
    expect(compiled.steps).toHaveLength(compiled.rounds.length);
    expect(compiled.steps.every((s, i) => s.rounds[0] === compiled.rounds[i] && s.beads === s.rounds[0]!.beads)).toBe(
      true,
    );
  });
});

describe("bead placement", () => {
  it("puts each bead between the two up beads of its gap, wrapping round", () => {
    const compiled = compile("beads: { A: {} }\nstart: center 3A\nrounds:\n  2: 1A, 0, 2A");
    const added = compiled.rounds[1]!.beads.map((id) => compiled.beads[id]!);
    expect(added.map((b) => [b.between, b.gap, b.slot, b.slotsInGap])).toEqual([
      [[0, 1], 0, 0, 1],
      [[2, 0], 2, 0, 2],
      [[2, 0], 2, 1, 2],
    ]);
  });

  it("orders pickups as written, including mixed stitches", () => {
    const compiled = compile("beads: { A: {}, B: {} }\nstart: center 2A\nrounds:\n  2: 1A+1B, 1B");
    expect(compiled.rounds[1]!.beads.map((id) => compiled.beads[id]!.key)).toEqual(["A", "B", "B"]);
  });
});

describe("validation", () => {
  it("checks the counting rule", () => {
    expect(issues(() => compile("beads: { A: {} }\nstart: center 3A\nrounds:\n  2: (1A) x4"))).toEqual([
      "round 2: lists 4 stitches, but the round before added 3 beads, so there are 3 gaps",
    ]);
  });

  it("stops after the first broken round instead of reporting knock-on errors", () => {
    const yaml = "beads: { A: {} }\nstart: center 3A\nrounds:\n  2: (1A) x4\n  3: (1A) x4";
    expect(issues(() => compile(yaml))).toHaveLength(1);
  });

  it("rejects undefined bead keys", () => {
    expect(issues(() => compile("beads: { A: {} }\nstart: center 3A\nrounds:\n  2: (1Z) x3"))).toEqual([
      'round 2: bead "Z" is not defined in `beads`',
    ]);
  });

  it("rejects an odd tube", () => {
    expect(issues(() => compile("beads: { A: {} }\nstart: tube (1A) x7\nrounds:\n  3: (1A) x3"))[0]).toMatch(
      /even number of beads, got 7/,
    );
  });

  it("rejects edge: back without a tube", () => {
    const yaml = "beads: { A: {} }\nstart: center 3A\nrounds:\n  2: { stitches: (1A) x3, edge: back }";
    expect(issues(() => compile(yaml))).toEqual(["round 2: edge: back needs a tube start"]);
  });

  it("rejects a round that adds nothing", () => {
    expect(issues(() => compile("beads: { A: {} }\nstart: center 3A\nrounds:\n  2: (0) x3"))).toEqual([
      "round 2: every stitch is 0, so nothing is added",
    ]);
  });

  it("rejects missing and repeated rounds", () => {
    expect(issues(() => compile("beads: { A: {} }\nstart: center 3A\nrounds:\n  3: (1A) x3"))).toEqual([
      "round 2: missing (the next listed round is 3)",
    ]);
    expect(issues(() => compile("beads: { A: {} }\nstart: tube (1A) x6\nrounds:\n  2: (1A) x3"))).toEqual([
      "round 2: listed twice (or it overlaps the start ring)",
    ]);
  });

  it("checks a stated start count", () => {
    expect(issues(() => parsePattern('beads: { A: {} }\nstart: "tube 6: (1A) x4"\nrounds: {}'))[0]).toMatch(
      /says 6 beads but lists 4/,
    );
  });

  it("reports file-level problems together", () => {
    expect(issues(() => parsePattern("title: x"))).toHaveLength(3);
  });
});

describe("ranges", () => {
  it("applies one instruction to each round of a range", () => {
    expect(counts("beads: { A: {} }\nstart: center 3A\nrounds:\n  2-4: (1A*) x3")).toEqual([3, 3, 3, 3]);
  });
});

describe("round cycles", () => {
  const head = "title: t\nbeads:\n  A: { size: 11/0, shape: cylinder, color: x }\nstart: center (1A) x4\nrounds:\n";

  it("repeats a list of rounds in order over the range", () => {
    expect(counts(`${head}  2: (2A) x4\n  3-6:\n    - (1A, 0) x4\n    - (2A) x4\n`)).toEqual([4, 8, 4, 8, 4, 8]);
  });

  it("takes options on the rounds in a cycle", () => {
    const compiled = compile(`${head}  2-3:\n    - (1A) x4\n    - { stitches: "(1A) x4", tension: tight }\n`);
    expect(compiled.rounds.map((r) => r.tension)).toEqual(["normal", "normal", "tight"]);
  });

  it("rejects a range that isn't a whole number of repeats", () => {
    expect(issues(() => parsePattern(`${head}  2-4: [(1A) x4, (1A) x4]\n`))).toEqual([
      "round 2-4: the range covers 3 rounds, which is not a whole number of repeats of 2 rounds",
    ]);
  });

  it("names the round when a cycle entry is wrong", () => {
    expect(issues(() => parsePattern(`${head}  2-3: [(1A) x4, { tension: tight }]\n`))).toEqual([
      "round 2-3: round 3: expected a stitch string, or a mapping with `stitches`",
    ]);
  });

  it("Moo Deng holds a steady 8/14 wall", () => {
    expect(reference("05-moo-deng").rounds.map((r) => r.beads.length)).toEqual([
      4, 4, 8, 8, 14, ...Array(6).fill([8, 14]).flat(),
    ]);
  });
});
