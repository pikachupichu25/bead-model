// The flat peyote designer's grid and design. See docs/flat-peyote-spec.md §1–3.
//
// A cell is (c, h): c is the column, h the stitched row counted in half beads.
// A cell exists only where c + h is even, so neighboring columns are offset by
// half a bead. The offset is tied to absolute coordinates, so trimming and
// moving never flip which columns sit high.
//
// Edits are pure functions FlatDesign → FlatDesign, like src/editor/draft.ts.

export interface Cell {
  c: number;
  h: number;
}

/** Inclusive: columns c0..c1, stitched rows h0..h1. */
export interface Bounds {
  c0: number;
  c1: number;
  h0: number;
  h1: number;
}

export interface FlatDesign {
  title: string;
  /** The one bead size for the piece: "<brand> <line> <size>", e.g. "miyuki delica DB". */
  bead: string;
  /** Bead key → `beads:` entry (a product code, or a mapping with a display color). In key order. */
  beads: Map<string, unknown>;
  /** Painted cells: "c,h" → bead key. Empty cells are absent. */
  cells: Map<string, string>;
  /** undefined = unlimited canvas. */
  bounds?: Bounds;
}

/** Bead size in mm: w across the column (the bead's length), d down it (its outer diameter). */
export interface BeadBox {
  w: number;
  d: number;
}

export function emptyDesign(bead = "miyuki delica DB", title = "Untitled design"): FlatDesign {
  return { title, bead, beads: new Map([["A", "miyuki DB-0010"]]), cells: new Map() };
}

// ---- Cells ----

export function isCell(c: number, h: number): boolean {
  return Number.isInteger(c) && Number.isInteger(h) && mod(c + h, 2) === 0;
}

export function cellKey(c: number, h: number): string {
  return `${c},${h}`;
}

export function parseCellKey(key: string): Cell {
  const [c, h] = key.split(",").map(Number);
  return { c: c!, h: h! };
}

/** The six cells touching (c, h). */
export function neighbors({ c, h }: Cell): Cell[] {
  return [
    { c, h: h - 2 },
    { c: c - 1, h: h - 1 },
    { c: c + 1, h: h - 1 },
    { c: c - 1, h: h + 1 },
    { c: c + 1, h: h + 1 },
    { c, h: h + 2 },
  ];
}

/** Center of a cell in mm, y down. */
export function cellCenter({ c, h }: Cell, box: BeadBox): { x: number; y: number } {
  return { x: c * box.w, y: (h * box.d) / 2 };
}

/** The cell under a point in mm. */
export function cellAt(x: number, y: number, box: BeadBox): Cell {
  const c = Math.round(x / box.w);
  const parity = mod(c, 2);
  const h = parity + 2 * Math.round(((2 * y) / box.d - parity) / 2);
  return { c, h };
}

// ---- Bounds ----

export function inBounds(b: Bounds, { c, h }: Cell): boolean {
  return c >= b.c0 && c <= b.c1 && h >= b.h0 && h <= b.h1;
}

/** Columns and stitched rows. */
export function boundsSize(b: Bounds): { columns: number; rows: number } {
  return { columns: b.c1 - b.c0 + 1, rows: b.h1 - b.h0 + 1 };
}

/** Every cell inside the bounds, row by row from the top. */
export function* boundsCells(b: Bounds): Generator<Cell> {
  for (let h = b.h0; h <= b.h1; h++) {
    for (let c = b.c0 + mod(b.c0 + h, 2); c <= b.c1; c += 2) yield { c, h };
  }
}

/** The bounds trim would give: the smallest rectangle holding every painted cell. */
export function paintedBounds(design: FlatDesign): Bounds | undefined {
  let b: Bounds | undefined;
  for (const key of design.cells.keys()) {
    const { c, h } = parseCellKey(key);
    if (!b) b = { c0: c, c1: c, h0: h, h1: h };
    else b = { c0: Math.min(b.c0, c), c1: Math.max(b.c1, c), h0: Math.min(b.h0, h), h1: Math.max(b.h1, h) };
  }
  return b;
}

/**
 * Tightens h0 and h1 to rows that hold a cell. Only a one-column canvas can
 * have a row with no cell (every other row misses its only column).
 */
export function normalizeBounds(b: Bounds): Bounds {
  if (b.c0 !== b.c1) return b;
  const h0 = mod(b.c0 + b.h0, 2) === 0 ? b.h0 : b.h0 + 1;
  const h1 = mod(b.c0 + b.h1, 2) === 0 ? b.h1 : b.h1 - 1;
  return { ...b, h0, h1: Math.max(h0, h1) };
}

/** Whether a bead can go in this cell: always on an unlimited canvas, inside the bounds otherwise. */
export function canPaint(design: FlatDesign, cell: Cell): boolean {
  return isCell(cell.c, cell.h) && (!design.bounds || inBounds(design.bounds, cell));
}

// ---- Painting ----

/** Paints the cells with a bead. Cells that can't be painted are skipped. */
export function paintCells(design: FlatDesign, cells: Iterable<Cell>, key: string): FlatDesign {
  const next = new Map(design.cells);
  for (const cell of cells) if (canPaint(design, cell)) next.set(cellKey(cell.c, cell.h), key);
  return { ...design, cells: next };
}

export function eraseCells(design: FlatDesign, cells: Iterable<Cell>): FlatDesign {
  const next = new Map(design.cells);
  for (const { c, h } of cells) next.delete(cellKey(c, h));
  return { ...design, cells: next };
}

/**
 * Fills the connected cells holding the same bead as `start` (or the same
 * empty) through the six neighbors. The fill stays inside the bounds, or on an
 * unlimited canvas inside the painted area, so it can't spread forever. A start
 * outside that area changes nothing.
 */
export function floodFill(design: FlatDesign, start: Cell, key: string): FlatDesign {
  const limit = design.bounds ?? paintedBounds(design);
  if (!limit || !isCell(start.c, start.h) || !inBounds(limit, start)) return design;
  const target = design.cells.get(cellKey(start.c, start.h));
  if (target === key) return design;
  const next = new Map(design.cells);
  const seen = new Set([cellKey(start.c, start.h)]);
  const queue = [start];
  while (queue.length > 0) {
    const cell = queue.pop()!;
    next.set(cellKey(cell.c, cell.h), key);
    for (const n of neighbors(cell)) {
      const k = cellKey(n.c, n.h);
      if (seen.has(k) || !inBounds(limit, n) || design.cells.get(k) !== target) continue;
      seen.add(k);
      queue.push(n);
    }
  }
  return { ...design, cells: next };
}

/** Bead key → number of beads, in the order of `design.beads`, then any unknown keys. */
export function countBeads(design: FlatDesign): Map<string, number> {
  const counts = new Map<string, number>([...design.beads.keys()].map((k) => [k, 0]));
  for (const key of design.cells.values()) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

// ---- Canvas: trim, empty cells, resize ----

/** Cuts the canvas down to the painted cells. Nothing moves. With nothing painted, nothing changes. */
export function trim(design: FlatDesign): FlatDesign {
  const bounds = paintedBounds(design);
  return bounds ? { ...design, bounds } : design;
}

/** Cells inside the bounds with no bead. None on an unlimited canvas. */
export function emptyCells(design: FlatDesign): Cell[] {
  if (!design.bounds) return [];
  return [...boundsCells(design.bounds)].filter(({ c, h }) => !design.cells.has(cellKey(c, h)));
}

export function fillEmptyCells(design: FlatDesign, key: string): FlatDesign {
  return paintCells(design, emptyCells(design), key);
}

/** Painted cells that resizing to these bounds would delete. */
export function cellsOutside(design: FlatDesign, bounds: Bounds): Cell[] {
  return [...design.cells.keys()].map(parseCellKey).filter((cell) => !inBounds(bounds, cell));
}

/** Gives the canvas new bounds, deleting the cells outside them. */
export function resize(design: FlatDesign, bounds: Bounds): FlatDesign {
  const b = normalizeBounds(bounds);
  if (b.c1 < b.c0 || b.h1 < b.h0) throw new RangeError("bounds must hold at least one cell");
  const cells = new Map([...design.cells].filter(([key]) => inBounds(b, parseCellKey(key))));
  return { ...design, cells, bounds: b };
}

export function makeUnlimited(design: FlatDesign): FlatDesign {
  const { bounds: _, ...rest } = design;
  return rest;
}

// ---- Moving blocks ----

/** A block of cells can move by (dc, dh) only if the offset stays the same: dc + dh even. */
export function isValidMove(dc: number, dh: number): boolean {
  return Number.isInteger(dc) && Number.isInteger(dh) && mod(dc + dh, 2) === 0;
}

/**
 * The nearest valid move to a drag of `dc` columns and `dh` half beads
 * (both may be fractional). Moving one column sideways also moves half a bead.
 */
export function snapMove(dc: number, dh: number): { dc: number; dh: number } {
  const c = Math.round(dc);
  const parity = mod(c, 2);
  return { dc: c, dh: parity + 2 * Math.round((dh - parity) / 2) };
}

export function moveCell({ c, h }: Cell, dc: number, dh: number): Cell {
  if (!isValidMove(dc, dh)) throw new RangeError(`can't move by (${dc}, ${dh}): it would break the offset`);
  return { c: c + dc, h: h + dh };
}

// ---- Helpers ----

export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}
