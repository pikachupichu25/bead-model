import { describe, expect, it } from "vitest";
import { cellCenter, isCell } from "../src/flat/grid.js";
import {
  boundsRect,
  cellsAlong,
  defaultView,
  fitView,
  MAX_BEAD_PX,
  MIN_BEAD_PX,
  rulerStep,
  toMm,
  toScreen,
  turnView,
  visibleRange,
  zoomAt,
} from "../src/flat/view.js";

const delica = { w: 1.3, d: 1.6 };

describe("view", () => {
  it("converts between screen and mm both ways", () => {
    const view = { panX: 30, panY: -12, zoom: 7 };
    const s = toScreen(view, 2, 5);
    expect(toMm(view, s.x, s.y)).toEqual({ x: 2, y: 5 });
  });

  it("starts with cell (0, 0) in the middle", () => {
    const view = defaultView(800, 600, delica);
    expect(toScreen(view, 0, 0)).toEqual({ x: 400, y: 300 });
    expect(view.zoom * delica.d).toBeCloseTo(20);
  });

  it("zooms around the pointer", () => {
    const view = defaultView(800, 600, delica);
    const before = toMm(view, 123, 456);
    const zoomed = zoomAt(view, 2, 123, 456, delica);
    expect(zoomed.zoom).toBeCloseTo(view.zoom * 2);
    const after = toMm(zoomed, 123, 456);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("keeps beads between the smallest and largest size", () => {
    const view = defaultView(800, 600, delica);
    expect(zoomAt(view, 1000, 0, 0, delica).zoom * delica.d).toBeCloseTo(MAX_BEAD_PX);
    expect(zoomAt(view, 0.0001, 0, 0, delica).zoom * delica.d).toBeCloseTo(MIN_BEAD_PX);
  });

  it("fits a piece on screen, centered", () => {
    const rect = boundsRect({ c0: 0, c1: 59, h0: 0, h1: 96 }, delica);
    const view = fitView(rect, 1000, 700, delica, 40);
    const tl = toScreen(view, rect.x0, rect.y0);
    const br = toScreen(view, rect.x1, rect.y1);
    expect(tl.x).toBeGreaterThanOrEqual(39.9);
    expect(tl.y).toBeGreaterThanOrEqual(39.9);
    expect(br.x).toBeLessThanOrEqual(960.1);
    expect(br.y).toBeLessThanOrEqual(660.1);
    expect((tl.x + br.x) / 2).toBeCloseTo(500);
    expect((tl.y + br.y) / 2).toBeCloseTo(350);
  });

  it("lists every column and row on screen", () => {
    const view = { panX: -100, panY: 50, zoom: 10 };
    const range = visibleRange(view, 400, 300, delica);
    for (const [sx, sy] of [[0, 0], [399, 299], [200, 150]] as const) {
      const at = toMm(view, sx, sy);
      expect(at.x / delica.w).toBeGreaterThanOrEqual(range.c0);
      expect(at.x / delica.w).toBeLessThanOrEqual(range.c1);
      expect((2 * at.y) / delica.d).toBeGreaterThanOrEqual(range.h0);
      expect((2 * at.y) / delica.d).toBeLessThanOrEqual(range.h1);
    }
  });
});

describe("cells along a drag", () => {
  it("doesn't skip cells on a fast drag", () => {
    const a = cellCenter({ c: 0, h: 0 }, delica);
    const b = cellCenter({ c: 10, h: 0 }, delica);
    const cells = cellsAlong(a, b, delica);
    expect(cells[0]).toEqual({ c: 0, h: 0 });
    expect(cells.at(-1)).toEqual({ c: 10, h: 0 });
    // Every column in between is touched, and neighbors in the list touch.
    expect(new Set(cells.map((x) => x.c))).toEqual(new Set([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));
    for (const x of cells) expect(isCell(x.c, x.h)).toBe(true);
  });

  it("gives one cell for a click", () => {
    const a = cellCenter({ c: 3, h: 5 }, delica);
    expect(cellsAlong(a, a, delica)).toEqual([{ c: 3, h: 5 }]);
  });
});

it("picks a ruler step that keeps labels apart", () => {
  expect(rulerStep(30)).toBe(1);
  expect(rulerStep(10)).toBe(5);
  expect(rulerStep(2)).toBe(20);
});

describe("turned view", () => {
  const turned = { panX: 400, panY: 300, zoom: 10, turned: true };

  it("turns the design a quarter turn clockwise", () => {
    // A point to the right of the origin in the design shows below it; a point below shows to the left.
    expect(toScreen(turned, 1, 0)).toEqual({ x: 400, y: 310 });
    expect(toScreen(turned, 0, 1)).toEqual({ x: 390, y: 300 });
    const s = toScreen(turned, 3, -2);
    const back = toMm(turned, s.x, s.y);
    expect(back.x).toBeCloseTo(3);
    expect(back.y).toBeCloseTo(-2);
  });

  it("zooms around the pointer and lists the cells on screen", () => {
    const before = toMm(turned, 123, 45);
    const after = toMm(zoomAt(turned, 2, 123, 45, delica), 123, 45);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    const range = visibleRange(turned, 800, 600, delica);
    for (const [sx, sy] of [[0, 0], [799, 599], [799, 0], [0, 599]] as const) {
      const at = toMm(turned, sx, sy);
      expect(at.x / delica.w).toBeGreaterThanOrEqual(range.c0);
      expect(at.x / delica.w).toBeLessThanOrEqual(range.c1);
      expect((2 * at.y) / delica.d).toBeGreaterThanOrEqual(range.h0);
      expect((2 * at.y) / delica.d).toBeLessThanOrEqual(range.h1);
    }
  });

  it("turns and back around the middle of the screen", () => {
    const view = defaultView(800, 600, delica);
    const mid = toMm(view, 400, 300);
    const once = turnView(view, 800, 600);
    expect(once.turned).toBe(true);
    const at = toMm(once, 400, 300);
    expect(at.x).toBeCloseTo(mid.x);
    expect(at.y).toBeCloseTo(mid.y);
    const twice = turnView(once, 800, 600);
    expect(twice.turned).toBe(false);
    expect(twice.panX).toBeCloseTo(view.panX);
    expect(twice.panY).toBeCloseTo(view.panY);
  });

  it("fits a tall piece across the screen", () => {
    const rect = boundsRect({ c0: 0, c1: 9, h0: 0, h1: 199 }, delica);
    const view = fitView(rect, 1000, 400, delica, 20, true);
    const corners = [toScreen(view, rect.x0, rect.y0), toScreen(view, rect.x1, rect.y1)];
    for (const p of corners) {
      expect(p.x).toBeGreaterThanOrEqual(19.9);
      expect(p.x).toBeLessThanOrEqual(980.1);
      expect(p.y).toBeGreaterThanOrEqual(19.9);
      expect(p.y).toBeLessThanOrEqual(380.1);
    }
    // Turned, the piece fills the width rather than the height.
    expect(Math.abs(corners[0]!.x - corners[1]!.x)).toBeGreaterThan(900);
  });
});
