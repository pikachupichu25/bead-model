import { describe, expect, it } from "vitest";
import { deltaE2000, hexToLab, hexToRgb, type Lab, srgbToLinear } from "../src/flat/color.js";

describe("sRGB and Lab", () => {
  it("reads hex colors", () => {
    expect(hexToRgb("#ff8000")).toEqual([255, 128, 0]);
    expect(hexToRgb("#f80")).toEqual([255, 136, 0]);
    expect(() => hexToRgb("red")).toThrow();
  });

  it("undoes the sRGB curve", () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(255)).toBeCloseTo(1);
    expect(srgbToLinear(128)).toBeCloseTo(0.2158, 3);
  });

  it("converts known colors to Lab (D65)", () => {
    const close = (lab: Lab, want: Lab) => lab.forEach((v, i) => expect(v).toBeCloseTo(want[i]!, 1));
    close(hexToLab("#ffffff"), [100, 0, 0]);
    close(hexToLab("#000000"), [0, 0, 0]);
    close(hexToLab("#ff0000"), [53.24, 80.09, 67.2]);
    close(hexToLab("#0000ff"), [32.3, 79.19, -107.86]);
  });
});

describe("CIEDE2000", () => {
  // Test pairs 1, 2, 7, 17 and 25 from Sharma, Wu and Dalal (2005).
  const pairs: [Lab, Lab, number][] = [
    [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
    [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
    [[50, 0, 0], [50, -1, 2], 2.3669],
    [[50, 2.5, 0], [73, 25, -18], 27.1492],
    [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
  ];

  for (const [a, b, want] of pairs) {
    it(`gives ${want} for ${a.join(", ")} vs ${b.join(", ")}`, () => {
      expect(deltaE2000(a, b)).toBeCloseTo(want, 4);
      expect(deltaE2000(b, a)).toBeCloseTo(want, 4);
    });
  }

  it("is zero for the same color", () => {
    expect(deltaE2000([40, 10, -20], [40, 10, -20])).toBe(0);
  });
});
