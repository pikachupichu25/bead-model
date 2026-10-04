import { describe, expect, it } from "vitest";
import { expandStitches, formatStitch, parseStitchList } from "../src/pattern/notation.js";

const expand = (text: string, gaps: number) => expandStitches(parseStitchList(text), gaps).map(formatStitch);

describe("parseStitchList", () => {
  it("reads single, pair, mixed and empty stitches", () => {
    expect(expand("1A, 2B, 1A+1B, 0", 4)).toEqual(["1A", "2B", "1A+1B", "0"]);
  });

  it("repeats groups", () => {
    expect(expand("(2A, 1B) x3", 6)).toEqual(["2A", "1B", "2A", "1B", "2A", "1B"]);
  });

  it("allows nested groups and spaces", () => {
    expect(expand("( (1A)x2 , 0 ) x 2", 6)).toEqual(["1A", "1A", "0", "1A", "1A", "0"]);
  });

  it("rejects malformed text", () => {
    expect(() => parseStitchList("2A,")).toThrow(/expected a stitch/);
    expect(() => parseStitchList("(2A x3")).toThrow(/expected "\)"/);
    expect(() => parseStitchList("2A 1B")).toThrow(/unexpected/);
    expect(() => parseStitchList("0A")).toThrow(/at least 1/);
  });
});

describe("expandStitches with * fill", () => {
  it("fills the rest of the gaps at the top level", () => {
    expect(expand("2A, 1B*", 4)).toEqual(["2A", "1B", "1B", "1B"]);
  });

  it("fills each repeat of a group", () => {
    // Flat triangle, round 4: 9 gaps, 3 per side.
    expect(expand("(2A, 1B*) x3", 9)).toEqual(["2A", "1B", "1B", "2A", "1B", "1B", "2A", "1B", "1B"]);
  });

  it("allows a fill of zero", () => {
    expect(expand("(2A, 1B*) x3", 3)).toEqual(["2A", "2A", "2A"]);
  });

  it("rejects fills that don't come out whole and non-negative", () => {
    expect(() => expand("(2A, 1B*) x3", 10)).toThrow(/split evenly/);
    expect(() => expand("2A, 2A, 1B*", 1)).toThrow(/negative/);
    expect(() => expand("1A*, 1B*", 4)).toThrow(/only one/);
  });
});
