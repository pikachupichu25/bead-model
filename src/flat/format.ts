// Reads and writes `.flat-peyote.yaml` files. See docs/flat-peyote-spec.md §8.
//
// `rows` is a picture of the grid: one line per drawn row, one character per
// column, each column drawn half a bead higher or lower as `first_column` says.
// Line i, character j is the cell (j, 2i + ((j + p) mod 2)), p = 0 for `high`
// and 1 for `low`. On loading, the grid goes at column p, so the offset is kept.

import { parse as parseYaml, stringify } from "yaml";
import { type Bounds, cellKey, type FlatDesign, mod, normalizeBounds, paintedBounds } from "./grid.js";

export class FlatFormatError extends Error {}

/** Bead keys are one character, so a grid row is one character per bead. */
export function isFlatKey(key: string): boolean {
  return /^[A-Za-z0-9]$/.test(key);
}

export const EMPTY = ".";
export const OUTSIDE = "-";

export function designFromYaml(text: string): FlatDesign {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (e) {
    throw new FlatFormatError(e instanceof Error ? e.message.split("\n")[0]! : String(e));
  }
  if (!isRecord(doc)) throw new FlatFormatError("the file must be a YAML mapping");
  if (doc.kind !== "flat-peyote") throw new FlatFormatError('kind must be "flat-peyote"');
  if (typeof doc.bead !== "string" || !doc.bead.trim()) {
    throw new FlatFormatError('bead is required: the bead size for the whole piece, e.g. "miyuki delica DB"');
  }
  const canvas = doc.canvas ?? "unlimited";
  if (canvas !== "unlimited" && canvas !== "trimmed") throw new FlatFormatError("canvas must be unlimited or trimmed");
  const firstColumn = doc.first_column ?? "high";
  if (firstColumn !== "high" && firstColumn !== "low") throw new FlatFormatError("first_column must be high or low");
  const p = firstColumn === "high" ? 0 : 1;

  if (doc.beads !== undefined && !isRecord(doc.beads)) throw new FlatFormatError("beads must be a mapping");
  const beads = new Map(Object.entries(doc.beads ?? {}));
  for (const key of beads.keys()) {
    if (!isFlatKey(key)) throw new FlatFormatError(`bead key "${key}" must be one letter or digit`);
  }

  const lines = rowLines(doc.rows);
  const width = Math.max(0, ...lines.map((l) => l.length));
  const cells = new Map<string, string>();
  const outside: { i: number; j: number; h: number }[] = [];
  let h0 = Infinity;
  let h1 = -Infinity;
  lines.forEach((line, i) => {
    for (let j = 0; j < width; j++) {
      const ch = line[j] ?? EMPTY;
      const c = j + p;
      const h = 2 * i + mod(c, 2);
      if (ch === OUTSIDE) {
        if (canvas === "trimmed" && i !== lines.length - 1) {
          throw new FlatFormatError(`row ${i + 1}, column ${j + 1}: "${OUTSIDE}" can only be in the last row`);
        }
        outside.push({ i, j, h });
        continue;
      }
      h0 = Math.min(h0, h);
      h1 = Math.max(h1, h);
      if (ch === EMPTY) continue;
      if (!beads.has(ch)) {
        const what = isFlatKey(ch) ? `no bead "${ch}" in beads` : `"${ch}" isn't a bead key, "${EMPTY}" or "${OUTSIDE}"`;
        throw new FlatFormatError(`row ${i + 1}, column ${j + 1}: ${what}`);
      }
      cells.set(cellKey(c, h), ch);
    }
  });

  const design: FlatDesign = {
    title: typeof doc.title === "string" ? doc.title : "Untitled design",
    bead: doc.bead.trim(),
    beads,
    cells,
  };
  if (canvas === "trimmed") {
    if (h1 < h0) throw new FlatFormatError("a trimmed canvas needs at least one row");
    const bad = outside.find((o) => o.h <= h1);
    if (bad) {
      throw new FlatFormatError(
        `row ${bad.i + 1}, column ${bad.j + 1}: "${OUTSIDE}" is inside the canvas. Only the low columns of the last row can be outside it`,
      );
    }
    design.bounds = normalizeBounds({ c0: p, c1: p + width - 1, h0, h1 });
  }
  return design;
}

export function designToYaml(design: FlatDesign): string {
  const lines = [
    "kind: flat-peyote",
    `title: ${scalar(design.title || "Untitled design")}`,
    `bead: ${scalar(design.bead)}`,
    "beads:",
  ];
  for (const [key, spec] of design.beads) lines.push(`  ${key}: ${flow(spec)}`);
  if (design.beads.size === 0) lines[lines.length - 1] = "beads: {}";
  lines.push(`canvas: ${design.bounds ? "trimmed" : "unlimited"}`);

  const region = design.bounds ?? paintedBounds(design);
  if (!region) {
    lines.push("first_column: high", 'rows: ""');
    return lines.join("\n") + "\n";
  }
  lines.push(`first_column: ${mod(region.c0 + region.h0, 2) === 0 ? "high" : "low"}`, "rows: |");
  for (const row of gridRows(design, region)) lines.push(`  ${row}`);
  return lines.join("\n") + "\n";
}

/** The `rows` lines for a region. Trimmed: full lines with `-` past the bottom. Unlimited: trailing empties left off. */
function gridRows(design: FlatDesign, region: Bounds): string[] {
  const p = mod(region.c0 + region.h0, 2);
  const count = Math.floor((region.h1 - region.h0) / 2) + 1;
  const rows: string[] = [];
  for (let i = 0; i < count; i++) {
    let row = "";
    for (let j = 0; j <= region.c1 - region.c0; j++) {
      const h = region.h0 + 2 * i + mod(j + p, 2);
      if (h > region.h1) row += design.bounds ? OUTSIDE : EMPTY;
      else row += design.cells.get(cellKey(region.c0 + j, h)) ?? EMPTY;
    }
    rows.push(design.bounds ? row : row.replace(/\.+$/, ""));
  }
  return rows;
}

function rowLines(rows: unknown): string[] {
  if (rows === undefined || rows === null) return [];
  const lines = Array.isArray(rows) ? rows.map(String) : typeof rows === "string" ? rows.replace(/\s+$/, "").split("\n") : undefined;
  if (!lines) throw new FlatFormatError("rows must be text, one line per row");
  if (lines.length === 1 && lines[0] === "") return [];
  return lines.map((line, i) => {
    const trimmed = line.replace(/\s+$/, "");
    if (/\s/.test(trimmed)) throw new FlatFormatError(`row ${i + 1}: no spaces inside a row, use "${EMPTY}" for an empty cell`);
    return trimmed;
  });
}

function scalar(value: string): string {
  return stringify(value, { lineWidth: 0 }).trimEnd();
}

function flow(value: unknown): string {
  return stringify(value, { collectionStyle: "flow", lineWidth: 0 }).trimEnd();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
