import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { compilePattern } from "../src/pattern/compile.js";
import { parsePattern } from "../src/pattern/load.js";
import { threadPasses } from "../src/pattern/thread.js";

const compile = (yaml: string) => compilePattern(parsePattern(yaml));
const reference = (name: string) => compile(readFileSync(`patterns/${name}.peyote.yaml`, "utf8"));

/** Writes passes as round.order labels, e.g. "1.2" for round 1, bead 2. */
function labels(yaml: string | ReturnType<typeof compile>, step: number): string[] {
  const compiled = typeof yaml === "string" ? compile(yaml) : yaml;
  return threadPasses(compiled, step).map((id) => {
    const b = compiled.beads[id]!;
    return `${b.round}.${b.order}`;
  });
}

describe("threadPasses", () => {
  it("goes round a center start and back through the first bead", () => {
    expect(labels("beads: { A: {} }\nstart: center 3A\nrounds: {}", 0)).toEqual(["1.1", "1.2", "1.3", "1.1"]);
  });

  it("strings a tube start in order, then closes the ring", () => {
    const passes = labels(reference("02-rivoli-bezel-cup"), 0);
    expect(passes).toHaveLength(33);
    expect(passes.slice(0, 4)).toEqual(["1.1", "2.2", "1.3", "2.4"]);
    expect(passes[32]).toBe("1.1");
  });

  it("alternates new beads and up beads, then steps up", () => {
    // Round 2: one bead in each of the 3 gaps of the center ring.
    expect(labels("beads: { A: {} }\nstart: center 3A\nrounds:\n  2: (1A) x3", 1)).toEqual([
      "1.1", "2.1", "1.2", "2.2", "1.3", "2.3", "1.1", "2.1",
    ]);
  });

  it("passes a pair together, goes straight across a 0 stitch, and steps up through the whole pair", () => {
    expect(labels("beads: { A: {} }\nstart: center 3A\nrounds:\n  2: 2A, 0, 1A", 1)).toEqual([
      "1.1", "2.1", "2.2", "1.2", "1.3", "2.3", "1.1", "2.1", "2.2",
    ]);
  });

  it("starts the next round from the last bead of the step-up", () => {
    // Flat triangle: round 2 is three pairs. The step-up goes through both
    // beads of the first pair, and round 3 starts from bead 2.
    const compiled = reference("03-flat-triangle");
    expect(labels(compiled, 1).slice(-2)).toEqual(["2.1", "2.2"]);
    expect(labels(compiled, 2)[0]).toBe("2.2");
  });

  it("steps up through only the first bead of a pair with step_up: first", () => {
    const compiled = reference("04-christmas-mug-trinket-box");
    expect(labels(compiled, 1).slice(-2)).toEqual(["1.1", "2.1"]);
    expect(labels(compiled, 2)[0]).toBe("2.1");
  });

  it("steps up through the up beads of leading 0 stitches", () => {
    const yaml = "beads: { A: {} }\nstart: center 3A\nrounds:\n  2: (2A) x3\n  3: (0, 1A) x3";
    expect(labels(yaml, 2)).toEqual([
      "2.2", "2.3", "3.1", "2.4", "2.5", "3.2", "2.6", "2.1", "3.3", "2.2", "2.3", "3.1",
    ]);
  });

  it("works a back-edge round from round 1", () => {
    const passes = labels(reference("02-rivoli-bezel-cup"), 4);
    expect(passes.slice(0, 3)).toEqual(["1.1", "6.1", "1.3"]);
  });
});
