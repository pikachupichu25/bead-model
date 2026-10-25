// Reads and writes `.nora.yaml` files. See docs/nora-net-spec.md §7.1.
//
// `slots` is the slot grid, one line per y and one character per x, starting
// at `origin` (the slot of the first character of the first line). `+` marks
// a group's middle (x and y both even), `.` an empty slot.

import { parse as parseYaml, stringify } from "yaml";
import { isFlatKey } from "../flat/format.js";
import { filledBounds, type NoraDesign, SYMMETRY_MODES, type SymmetryMode } from "./design.js";
import { isSlot, slotKey } from "./net.js";

export class NoraFormatError extends Error {}

export const EMPTY = ".";
export const HOLE = "+";

export function designFromYaml(text: string): NoraDesign {
  let doc: unknown;
  try {
    doc = parseYaml(text);
  } catch (e) {
    throw new NoraFormatError(e instanceof Error ? e.message.split("\n")[0]! : String(e));
  }
  if (!isRecord(doc)) throw new NoraFormatError("the file must be a YAML mapping");
  if (doc.kind !== "nora-net") throw new NoraFormatError('kind must be "nora-net"');
  if (typeof doc.bead !== "string" || !doc.bead.trim()) {
    throw new NoraFormatError('bead is required: the bead size for the whole piece, e.g. "miyuki round 8"');
  }

  if (doc.beads !== undefined && !isRecord(doc.beads)) throw new NoraFormatError("beads must be a mapping");
  const beads = new Map(Object.entries(doc.beads ?? {}));
  for (const key of beads.keys()) {
    if (!isFlatKey(key)) throw new NoraFormatError(`bead key "${key}" must be one letter or digit`);
  }

  const sym = doc.symmetry ?? {};
  if (!isRecord(sym)) throw new NoraFormatError("symmetry must be a mapping: { mode, column, row }");
  const mode = sym.mode ?? "off";
  if (!SYMMETRY_MODES.includes(mode as SymmetryMode)) throw new NoraFormatError(`symmetry mode must be one of ${SYMMETRY_MODES.join(", ")}`);
  const column = sym.column ?? 0;
  const row = sym.row ?? 0;
  if (!Number.isInteger(column) || !Number.isInteger(row)) throw new NoraFormatError("symmetry column and row must be whole numbers");

  const origin = doc.origin ?? [0, 0];
  if (!Array.isArray(origin) || origin.length !== 2 || !origin.every(Number.isInteger)) {
    throw new NoraFormatError("origin must be [x, y], the slot of the first character, in whole numbers");
  }
  const [x0, y0] = origin as [number, number];

  const slots = new Map<string, string>();
  slotLines(doc.slots).forEach((line, n) => {
    const y = y0 + n;
    // Lines may be left short; the missing characters are empty slots or holes.
    for (let m = 0; m < line.length; m++) {
      const x = x0 + m;
      const ch = line[m]!;
      const where = `slots line ${n + 1}, character ${m + 1}`;
      if (!isSlot(x, y)) {
        if (ch !== HOLE) throw new NoraFormatError(`${where}: "${HOLE}" expected (the middle of a group). Is the line shifted?`);
        continue;
      }
      if (ch === HOLE) throw new NoraFormatError(`${where}: "${HOLE}" is only for the middle of a group. Is the line shifted?`);
      if (ch === EMPTY) continue;
      if (!beads.has(ch)) {
        const what = isFlatKey(ch) ? `no bead "${ch}" in beads` : `"${ch}" isn't a bead key, "${EMPTY}" or "${HOLE}"`;
        throw new NoraFormatError(`${where}: ${what}`);
      }
      slots.set(slotKey(x, y), ch);
    }
  });

  return {
    title: typeof doc.title === "string" ? doc.title : "Untitled design",
    bead: doc.bead.trim(),
    beads,
    slots,
    symmetry: { mode: mode as SymmetryMode, column: column as number, row: row as number },
  };
}

export function designToYaml(design: NoraDesign): string {
  const { mode, column, row } = design.symmetry;
  const lines = [
    "kind: nora-net",
    `title: ${scalar(design.title || "Untitled design")}`,
    `bead: ${scalar(design.bead)}`,
    "beads:",
  ];
  for (const [key, spec] of design.beads) lines.push(`  ${key}: ${flow(spec)}`);
  if (design.beads.size === 0) lines[lines.length - 1] = "beads: {}";
  lines.push(`symmetry: { mode: ${mode}, column: ${column}, row: ${row} }`);

  const b = filledBounds(design);
  if (!b) {
    lines.push('slots: ""');
    return lines.join("\n") + "\n";
  }
  lines.push(`origin: [${b.x0}, ${b.y0}]`, "slots: |");
  for (let y = b.y0; y <= b.y1; y++) {
    let line = "";
    for (let x = b.x0; x <= b.x1; x++) line += isSlot(x, y) ? (design.slots.get(slotKey(x, y)) ?? EMPTY) : HOLE;
    lines.push(`  ${line.replace(/[.+]+$/, "")}`);
  }
  return lines.join("\n") + "\n";
}

function slotLines(slots: unknown): string[] {
  if (slots === undefined || slots === null) return [];
  const lines = Array.isArray(slots) ? slots.map(String) : typeof slots === "string" ? slots.replace(/\s+$/, "").split("\n") : undefined;
  if (!lines) throw new NoraFormatError("slots must be text, one line per row of slots");
  if (lines.length === 1 && lines[0] === "") return [];
  return lines.map((line, n) => {
    const trimmed = line.replace(/\s+$/, "");
    if (/\s/.test(trimmed)) throw new NoraFormatError(`slots line ${n + 1}: no spaces inside a line, use "${EMPTY}" for an empty slot`);
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
