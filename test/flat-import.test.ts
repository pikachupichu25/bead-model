import { describe, expect, it } from "vitest";
import { hexToLab, hexToRgb } from "../src/flat/color.js";
import { isCell } from "../src/flat/grid.js";
import { importCells, importRows, matchColors, type Pixels, sampleCells } from "../src/flat/import.js";

const delica = { w: 1.3, d: 1.6 };

/** A picture drawn by a function of (x, y) → "#rrggbb" or null for transparent. */
function picture(width: number, height: number, color: (x: number, y: number) => string | null): Pixels {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const hex = color(x, y);
      const p = (y * width + x) * 4;
      if (hex === null) continue;
      data.set([...hexToRgb(hex), 255], p);
    }
  }
  return { width, height, data };
}

const usedHexes = (palette: string[], used: { index: number }[]) => used.map((u) => palette[u.index]).sort();

describe("size", () => {
  it("keeps the picture's proportions for the bead's shape", () => {
    // A square picture 60 Delicas wide: 2 · 60 · 1.30 / 1.60 − 1 ≈ 97 rows (spec §6.3).
    expect(importRows(500, 500, 60, delica)).toBe(97);
    expect(importRows(1000, 500, 60, delica)).toBe(48);
    expect(importRows(1000, 1, 3, delica)).toBe(1);
  });

  it("lists the cells of the piece, all of them real cells", () => {
    const cells = importCells(5, 4);
    expect(cells).toHaveLength(10);
    for (const { c, h } of cells) {
      expect(isCell(c, h)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(0);
      expect(c).toBeLessThan(5);
    }
  });
});

describe("sampling", () => {
  it("averages each bead's part of the picture in linear light", () => {
    // Fine black and white stripes average to a light grey, not sRGB 50 % (#808080).
    const stripes = picture(80, 80, (x) => (x % 2 ? "#000000" : "#ffffff"));
    const s = sampleCells(stripes, 8, 10, delica);
    const L = s.labs[0]!;
    expect(L).toBeGreaterThan(70);
    expect(L).toBeLessThan(80);
  });

  it("leaves transparent parts empty", () => {
    const half = picture(40, 40, (x) => (x < 20 ? null : "#c00000"));
    const s = sampleCells(half, 10, importRows(40, 40, 10, delica), delica);
    s.cells.forEach(({ c }, i) => {
      if (c < 4) expect(Number.isNaN(s.labs[i * 3]!)).toBe(true);
      if (c > 5) expect(Number.isNaN(s.labs[i * 3]!)).toBe(false);
    });
  });
});

describe("matching", () => {
  const bw = ["#000000", "#ffffff", "#808080", "#c00000"];

  it("gives one color for a solid picture", () => {
    const s = sampleCells(picture(30, 30, () => "#d01010"), 10, 10, delica);
    const m = matchColors(s, bw.map(hexToLab), 10);
    expect(usedHexes(bw, m.used)).toEqual(["#c00000"]);
    expect(m.used[0]!.count).toBe(s.cells.length);
  });

  it("gives exactly the two colors of a two-color picture", () => {
    const s = sampleCells(picture(60, 60, (x) => (x < 30 ? "#000000" : "#ffffff")), 10, 15, delica);
    const m = matchColors(s, bw.map(hexToLab), 10);
    // Cells straddling the middle average to grey, so allow it only there.
    const colors = new Set([...m.assign].map((p) => bw[p]));
    expect(colors.has("#000000") && colors.has("#ffffff")).toBe(true);
    expect(colors.has("#c00000")).toBe(false);
    expect(m.meanDeltaE).toBeLessThan(5);
  });

  it("matches empty cells to nothing", () => {
    const s = sampleCells(picture(40, 40, (x) => (x < 20 ? null : "#ffffff")), 10, 10, delica);
    const m = matchColors(s, bw.map(hexToLab), 10);
    s.cells.forEach(({ c }, i) => {
      if (c < 4) expect(m.assign[i]).toBe(-1);
      else if (c > 5) expect(m.assign[i]).toBe(1);
    });
  });

  it("never uses more colors than the limit", () => {
    const rainbow = picture(64, 64, (x, y) => `#${[x * 4, y * 4, 255 - x * 2].map((v) => v.toString(16).padStart(2, "0")).join("")}`);
    const palette = Array.from({ length: 40 }, (_, i) => `#${[(i * 53) % 256, (i * 97) % 256, (i * 31) % 256].map((v) => v.toString(16).padStart(2, "0")).join("")}`);
    const s = sampleCells(rainbow, 30, 30, delica);
    for (const limit of [1, 2, 5, 12]) {
      const m = matchColors(s, palette.map(hexToLab), limit);
      expect(m.used.length).toBeLessThanOrEqual(limit);
      expect(m.used.reduce((sum, u) => sum + u.count, 0)).toBe(s.cells.length);
    }
  });

  it("keeps a small red dot on a blue field, which keeping the most used colors would lose", () => {
    // A field of three close blues, with a small red dot in the middle.
    const blues = ["#2040c0", "#2848c8", "#1838b8"];
    const pic = picture(60, 60, (x, y) => (Math.abs(x - 30) < 5 && Math.abs(y - 30) < 5 ? "#d02020" : blues[Math.floor(x / 20)]!));
    const palette = [...blues, "#d02020"];
    const s = sampleCells(pic, 30, importRows(60, 60, 30, delica), delica);

    const all = matchColors(s, palette.map(hexToLab), 10);
    // Red is the least used color, so keeping the two most used would drop it.
    expect(palette[all.used.at(-1)!.index]).toBe("#d02020");

    const two = matchColors(s, palette.map(hexToLab), 2);
    expect(usedHexes(palette, two.used)).toContain("#d02020");
  });

  it("handles an empty palette and an empty picture", () => {
    const s = sampleCells(picture(10, 10, () => null), 4, 4, delica);
    expect(matchColors(s, bw.map(hexToLab), 4).used).toEqual([]);
    expect(matchColors(s, [], 4).used).toEqual([]);
  });
});
