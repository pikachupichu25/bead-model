import { describe, expect, it } from "vitest";
import {
  boundsCells,
  boundsSize,
  canPaint,
  cellAt,
  cellCenter,
  cellKey,
  cellsOutside,
  countBeads,
  emptyCells,
  emptyDesign,
  eraseCells,
  fillEmptyCells,
  type FlatDesign,
  floodFill,
  isCell,
  isValidMove,
  makeUnlimited,
  moveCell,
  neighbors,
  paintCells,
  paintedBounds,
  resize,
  snapMove,
  trim,
} from "../src/flat/grid.js";

const delica = { w: 1.3, d: 1.6 };
const cells = (...list: [number, number][]) => list.map(([c, h]) => ({ c, h }));
const painted = (design: FlatDesign) => [...design.cells.keys()].sort();

describe("cells", () => {
  it("exist only where c + h is even, also for negative coordinates", () => {
    expect(isCell(0, 0)).toBe(true);
    expect(isCell(1, 1)).toBe(true);
    expect(isCell(0, 1)).toBe(false);
    expect(isCell(-1, 3)).toBe(true);
    expect(isCell(-3, -2)).toBe(false);
  });

  it("have six neighbors, all of them cells", () => {
    for (const cell of cells([0, 0], [-1, 1], [5, -3])) {
      const ns = neighbors(cell);
      expect(ns).toHaveLength(6);
      for (const n of ns) expect(isCell(n.c, n.h)).toBe(true);
    }
  });

  it("are placed a bead length apart sideways and half a bead apart between neighboring columns", () => {
    expect(cellCenter({ c: 2, h: 4 }, delica)).toEqual({ x: 2.6, y: 3.2 });
    expect(cellCenter({ c: 1, h: 1 }, delica)).toEqual({ x: 1.3, y: 0.8 });
  });

  it("are found under a point", () => {
    for (const cell of cells([0, 0], [1, 1], [-3, 5], [4, -6])) {
      const { x, y } = cellCenter(cell, delica);
      expect(cellAt(x, y, delica)).toEqual(cell);
      expect(cellAt(x + 0.5, y - 0.6, delica)).toEqual(cell);
    }
  });
});

describe("painting", () => {
  it("paints anywhere on an unlimited canvas, and only inside the bounds once trimmed", () => {
    let design = paintCells(emptyDesign(), cells([0, 0], [-40, 20], [300, -100]), "A");
    expect(design.cells.size).toBe(3);
    design = trim(design);
    expect(canPaint(design, { c: 0, h: 0 })).toBe(true);
    expect(canPaint(design, { c: 301, h: -101 })).toBe(false);
    expect(paintCells(design, cells([301, -101]), "A").cells.size).toBe(3);
  });

  it("skips spots that aren't cells", () => {
    expect(paintCells(emptyDesign(), cells([0, 1]), "A").cells.size).toBe(0);
  });

  it("erases and counts beads", () => {
    let design = paintCells(emptyDesign(), cells([0, 0], [1, 1], [2, 0]), "A");
    design = paintCells(design, cells([1, 1]), "B");
    design = eraseCells(design, cells([2, 0]));
    expect([...countBeads(design)]).toEqual([
      ["A", 1],
      ["B", 1],
    ]);
  });

  it("doesn't change the design it was given", () => {
    const design = emptyDesign();
    paintCells(design, cells([0, 0]), "A");
    expect(design.cells.size).toBe(0);
  });
});

describe("trim", () => {
  const design = paintCells(emptyDesign(), cells([-2, 0], [3, 5], [1, -3]), "A");

  it("cuts the canvas to exactly the painted cells, without moving any", () => {
    const trimmed = trim(design);
    expect(trimmed.bounds).toEqual({ c0: -2, c1: 3, h0: -3, h1: 5 });
    expect(painted(trimmed)).toEqual(painted(design));
    expect(boundsSize(trimmed.bounds!)).toEqual({ columns: 6, rows: 9 });
  });

  it("does nothing on an empty canvas", () => {
    expect(trim(emptyDesign()).bounds).toBeUndefined();
  });

  it("finds the empty cells inside and fills them", () => {
    const trimmed = trim(design);
    const all = [...boundsCells(trimmed.bounds!)];
    // 6 columns × 9 rows: 3 columns have 5 cells, 3 have 4.
    expect(all).toHaveLength(27);
    for (const { c, h } of all) expect(isCell(c, h)).toBe(true);
    expect(emptyCells(trimmed)).toHaveLength(24);
    const filled = fillEmptyCells(trimmed, "B");
    expect(emptyCells(filled)).toHaveLength(0);
    expect(filled.cells.get(cellKey(-2, 0))).toBe("A");
    expect(emptyCells(design)).toEqual([]);
  });

  it("can be undone by making the canvas unlimited again", () => {
    const back = makeUnlimited(trim(design));
    expect(back.bounds).toBeUndefined();
    expect("bounds" in back).toBe(false);
    expect(painted(back)).toEqual(painted(design));
  });
});

describe("resize", () => {
  const design = trim(paintCells(emptyDesign(), cells([0, 0], [5, 9]), "A"));

  it("deletes only the cells outside the new bounds", () => {
    const bounds = { c0: 0, c1: 3, h0: 0, h1: 9 };
    expect(cellsOutside(design, bounds)).toEqual(cells([5, 9]));
    const smaller = resize(design, bounds);
    expect(painted(smaller)).toEqual([cellKey(0, 0)]);
    expect(smaller.bounds).toEqual(bounds);
  });

  it("can grow the canvas", () => {
    const bigger = resize(design, { c0: -2, c1: 8, h0: -4, h1: 12 });
    expect(painted(bigger)).toEqual(painted(design));
  });

  it("keeps a one-column canvas on rows that have its cells", () => {
    expect(resize(design, { c0: 1, c1: 1, h0: 0, h1: 6 }).bounds).toEqual({ c0: 1, c1: 1, h0: 1, h1: 5 });
  });

  it("refuses bounds with no cells", () => {
    expect(() => resize(design, { c0: 3, c1: 2, h0: 0, h1: 4 })).toThrow(RangeError);
  });
});

describe("flood fill", () => {
  // A ring of A around one empty cell at (2, 2).
  const ring = paintCells(emptyDesign(), neighbors({ c: 2, h: 2 }), "A");

  it("fills connected cells of the same bead", () => {
    const filled = floodFill(paintCells(ring, cells([10, 10]), "A"), { c: 2, h: 0 }, "B");
    const counts = countBeads(filled);
    expect(counts.get("B")).toBe(6);
    expect(counts.get("A")).toBe(1);
  });

  it("fills empty space only inside the painted area on an unlimited canvas", () => {
    const filled = floodFill(ring, { c: 2, h: 2 }, "B");
    expect(filled.cells.get(cellKey(2, 2))).toBe("B");
    // Outside the ring but inside its bounds, the empty corners join up; nothing outside the bounds is touched.
    const b = paintedBounds(ring)!;
    for (const key of filled.cells.keys()) {
      const [c, h] = key.split(",").map(Number) as [number, number];
      expect(c >= b.c0 && c <= b.c1 && h >= b.h0 && h <= b.h1).toBe(true);
    }
  });

  it("does nothing outside the painted area", () => {
    expect(floodFill(ring, { c: 50, h: 50 }, "B")).toBe(ring);
  });

  it("does nothing on an empty canvas", () => {
    const design = emptyDesign();
    expect(floodFill(design, { c: 0, h: 0 }, "B")).toBe(design);
  });
});

describe("moving blocks", () => {
  it("keeps the offset: dc + dh must be even", () => {
    expect(isValidMove(1, 1)).toBe(true);
    expect(isValidMove(2, 0)).toBe(true);
    expect(isValidMove(1, 0)).toBe(false);
    expect(() => moveCell({ c: 0, h: 0 }, 1, 0)).toThrow(RangeError);
    expect(moveCell({ c: 0, h: 0 }, -1, 3)).toEqual({ c: -1, h: 3 });
  });

  it("snaps a drag to the nearest valid move", () => {
    expect(snapMove(1.2, 0.1)).toEqual({ dc: 1, dh: 1 });
    expect(snapMove(2.4, 0.4)).toEqual({ dc: 2, dh: 0 });
    expect(snapMove(-1, -0.2)).toEqual({ dc: -1, dh: -1 });
    for (const [dc, dh] of [[0.3, 5.7], [-3.6, -2.2], [7, 7]] as const) {
      const move = snapMove(dc, dh);
      expect(isValidMove(move.dc, move.dh)).toBe(true);
    }
  });
});
