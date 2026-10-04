import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compilePattern } from "../src/pattern/compile.js";
import { describeRound, summarizeStitches } from "../src/pattern/describe.js";
import { parsePattern } from "../src/pattern/load.js";
import { parseStitchList, expandStitches } from "../src/pattern/notation.js";

const summarize = (text: string, gaps: number) => summarizeStitches(expandStitches(parseStitchList(text), gaps));
const reference = (name: string) => compilePattern(parsePattern(readFileSync(`patterns/${name}.peyote.yaml`, "utf8")));

describe("summarizeStitches", () => {
  it("finds the shortest repeat", () => {
    expect(summarize("(2A, 1B*) x3", 9)).toBe("(2A, 1B, 1B) ×3");
    expect(summarize("(1C) x16", 16)).toBe("1C ×16");
    expect(summarize("(0, 0, 2A) x7", 21)).toBe("(0, 0, 2A) ×7");
  });

  it("lists stitches with no repeat as they are", () => {
    expect(summarize("2A, 1A, 1A", 3)).toBe("2A, 1A, 1A");
    expect(summarize("2A", 1)).toBe("2A");
  });
});

describe("describeRound", () => {
  it("describes a center start and a worked round", () => {
    const compiled = reference("03-flat-triangle");
    expect(describeRound(compiled, compiled.rounds[0]!)).toBe("Pick up 3 A and tie them into a ring.");
    expect(describeRound(compiled, compiled.rounds[3]!)).toBe(
      "Work 9 gaps: (2A, 1B, 1B) ×3. Then step up through bead 1.",
    );
  });

  it("describes both rounds of a tube start and back-edge rounds", () => {
    const compiled = reference("02-rivoli-bezel-cup");
    expect(describeRound(compiled, compiled.rounds[0]!)).toMatch(/^Pick up 32 beads, \(1A, 1B\) ×16, and tie/);
    expect(describeRound(compiled, compiled.rounds[1]!)).toMatch(/making round 2/);
    expect(describeRound(compiled, compiled.rounds[5]!)).toMatch(/^On the back edge, work 16 gaps/);
  });
});
