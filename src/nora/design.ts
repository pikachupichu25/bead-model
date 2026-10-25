// A Nora net design and every edit to it: painting slots and rings, fill,
// symmetry, and the checks that a net would hold together. All edits are pure
// functions, so undo is a stack of designs. See docs/nora-net-spec.md §3–6.

import {
  type Group,
  groupKey,
  groupSize,
  groupSlots,
  parseGroupKey,
  parseSlotKey,
  ringNeighbors,
  type Slot,
  slotGroups,
  slotKey,
} from "./net.js";

export type SymmetryMode = "off" | "left-right" | "up-down" | "both";

export const SYMMETRY_MODES: readonly SymmetryMode[] = ["off", "left-right", "up-down", "both"];

export interface Symmetry {
  mode: SymmetryMode;
  /** The vertical axis runs through this group column. */
  column: number;
  /** The horizontal axis runs through this group row. */
  row: number;
}

export interface NoraDesign {
  title: string;
  /** The one bead size for the piece: "<brand> <line> <size>", e.g. "miyuki round 8". */
  bead: string;
  /** Bead keys used in the slots → `beads:` entry, as in the flat designer. */
  beads: Map<string, unknown>;
  /** Filled slots: "x,y" → bead key. Empty slots are absent. */
  slots: Map<string, string>;
  symmetry: Symmetry;
}

export const DEFAULT_BEAD = "miyuki round 8";

export function emptyDesign(bead = DEFAULT_BEAD, title = "Untitled design"): NoraDesign {
  return {
    title,
    bead,
    beads: new Map([["A", "miyuki 8-402"]]),
    slots: new Map(),
    symmetry: { mode: "left-right", column: 0, row: 0 },
  };
}

// ---- Painting ----

/** Puts `key` in every slot given, or empties them when `key` is undefined. */
export function setSlots(design: NoraDesign, slots: Iterable<Slot>, key: string | undefined): NoraDesign {
  let next: Map<string, string> | undefined;
  for (const { x, y } of slots) {
    const k = slotKey(x, y);
    if (design.slots.get(k) === key) continue;
    next ??= new Map(design.slots);
    if (key === undefined) next.delete(k);
    else next.set(k, key);
  }
  return next ? { ...design, slots: next } : design;
}

/** Recolors every bead connected to `start` through touching beads that has the same bead as it. */
export function floodFill(design: NoraDesign, start: Slot, key: string): NoraDesign {
  const from = design.slots.get(slotKey(start.x, start.y));
  if (from === undefined || from === key) return design;
  const seen = new Set([slotKey(start.x, start.y)]);
  const queue = [start];
  while (queue.length) {
    const slot = queue.pop()!;
    for (const n of ringNeighbors(slot)) {
      const k = slotKey(n.x, n.y);
      if (seen.has(k) || design.slots.get(k) !== from) continue;
      seen.add(k);
      queue.push(n);
    }
  }
  return setSlots(design, [...seen].map(parseSlotKey), key);
}

export function countBeads(design: NoraDesign): Map<string, number> {
  const counts = new Map<string, number>([...design.beads.keys()].map((k) => [k, 0]));
  for (const key of design.slots.values()) counts.set(key, (counts.get(key) ?? 0) + 1);
  return counts;
}

export interface SlotBounds {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** The smallest box of slots around the filled ones. */
export function filledBounds(design: NoraDesign): SlotBounds | undefined {
  if (design.slots.size === 0) return undefined;
  let x0 = Infinity;
  let x1 = -Infinity;
  let y0 = Infinity;
  let y1 = -Infinity;
  for (const k of design.slots.keys()) {
    const { x, y } = parseSlotKey(k);
    x0 = Math.min(x0, x);
    x1 = Math.max(x1, x);
    y0 = Math.min(y0, y);
    y1 = Math.max(y1, y);
  }
  return { x0, x1, y0, y1 };
}

// ---- Symmetry ----

/** A slot and its mirror images for the symmetry mode, without repeats. */
export function mirrorSlots(slot: Slot, symmetry: Symmetry): Slot[] {
  const { mode, column: a, row: b } = symmetry;
  const out = [slot];
  if (mode === "left-right" || mode === "both") out.push({ x: 4 * a - slot.x, y: slot.y });
  if (mode === "up-down" || mode === "both") out.push({ x: slot.x, y: 4 * b - slot.y });
  if (mode === "both") out.push({ x: 4 * a - slot.x, y: 4 * b - slot.y });
  return unique(out, (s) => slotKey(s.x, s.y));
}

/** A group and its mirror images. Mirroring keeps i + j's parity, so 8s land on 8s. */
export function mirrorGroups(group: Group, symmetry: Symmetry): Group[] {
  const { mode, column: a, row: b } = symmetry;
  const out = [group];
  if (mode === "left-right" || mode === "both") out.push({ i: 2 * a - group.i, j: group.j });
  if (mode === "up-down" || mode === "both") out.push({ i: group.i, j: 2 * b - group.j });
  if (mode === "both") out.push({ i: 2 * a - group.i, j: 2 * b - group.j });
  return unique(out, (g) => groupKey(g.i, g.j));
}

/** Every slot given, with its mirror images. */
export function withMirrors(slots: Iterable<Slot>, symmetry: Symmetry): Slot[] {
  return unique([...slots].flatMap((s) => mirrorSlots(s, symmetry)), (s) => slotKey(s.x, s.y));
}

export type Half = "left" | "right" | "top" | "bottom";

/** Copies one half onto the other across the design's axis. Slots on the axis stay. */
export function makeSymmetric(design: NoraDesign, from: Half): NoraDesign {
  const vertical = from === "left" || from === "right";
  const axis = vertical ? 2 * design.symmetry.column : 2 * design.symmetry.row;
  const side = (s: Slot) => Math.sign((vertical ? s.x : s.y) - axis);
  const keep = from === "left" || from === "top" ? -1 : 1;
  const slots = new Map<string, string>();
  for (const [k, key] of design.slots) {
    const s = parseSlotKey(k);
    if (side(s) === -keep) continue;
    slots.set(k, key);
    if (side(s) === keep) {
      const m = vertical ? { x: 2 * axis - s.x, y: s.y } : { x: s.x, y: 2 * axis - s.y };
      slots.set(slotKey(m.x, m.y), key);
    }
  }
  return { ...design, slots };
}

/** Slots whose mirror image, across each axis that is on, holds a different bead (or none). */
export function asymmetricSlots(design: NoraDesign): Slot[] {
  const { mode, column, row } = design.symmetry;
  const mirrors: ((s: Slot) => Slot)[] = [];
  if (mode === "left-right" || mode === "both") mirrors.push((s) => ({ x: 4 * column - s.x, y: s.y }));
  if (mode === "up-down" || mode === "both") mirrors.push((s) => ({ x: s.x, y: 4 * row - s.y }));
  const off = new Map<string, Slot>();
  for (const k of design.slots.keys()) {
    const s = parseSlotKey(k);
    for (const mirror of mirrors) {
      const m = mirror(s);
      const mk = slotKey(m.x, m.y);
      if (design.slots.get(mk) === design.slots.get(k)) continue;
      off.set(k, s);
      off.set(mk, m);
    }
  }
  return [...off.values()];
}

// ---- Stitchability ----

export type GroupState = "empty" | "open" | "complete";

export function groupState(design: NoraDesign, group: Group): GroupState {
  const filled = groupSlots(group).filter((s) => design.slots.has(slotKey(s.x, s.y))).length;
  return filled === 0 ? "empty" : filled === groupSize(group) ? "complete" : "open";
}

/** Every group with at least one filled slot. */
export function touchedGroups(design: NoraDesign): Group[] {
  const keys = new Set<string>();
  for (const k of design.slots.keys()) for (const g of slotGroups(parseSlotKey(k))) keys.add(groupKey(g.i, g.j));
  return [...keys].map(parseGroupKey);
}

/**
 * Beads that no complete group holds: neither of their rings is closed, so
 * they would fall off. A bead held by one closed ring is fine, so the open 8s
 * on the diagonals of a lone flower are not a problem.
 */
export function looseSlots(design: NoraDesign): Slot[] {
  const complete = new Map<string, boolean>();
  const isComplete = (g: Group) => {
    const k = groupKey(g.i, g.j);
    if (!complete.has(k)) complete.set(k, groupState(design, g) === "complete");
    return complete.get(k)!;
  };
  return [...design.slots.keys()].map(parseSlotKey).filter((s) => !slotGroups(s).some(isComplete));
}

/** The rings that aren't closed: open groups with a loose bead in them. Completing any one holds that bead. */
export function openGroups(design: NoraDesign): Group[] {
  const keys = new Set<string>();
  for (const s of looseSlots(design)) for (const g of slotGroups(s)) keys.add(groupKey(g.i, g.j));
  return [...keys].map(parseGroupKey).filter((g) => groupState(design, g) === "open");
}

/** Every complete group, top to bottom then left to right. */
export function completeGroups(design: NoraDesign): Group[] {
  return touchedGroups(design)
    .filter((g) => groupState(design, g) === "complete")
    .sort((a, b) => a.j - b.j || a.i - b.i);
}

/** Fills a group's empty slots with `key`. */
export function completeGroup(design: NoraDesign, group: Group, key: string): NoraDesign {
  return setSlots(design, groupSlots(group).filter((s) => !design.slots.has(slotKey(s.x, s.y))), key);
}

/** Removes a group's beads, except those a complete neighbor needs. */
export function clearGroup(design: NoraDesign, group: Group): NoraDesign {
  const free = groupSlots(group).filter((s) => {
    const other = slotGroups(s).find((g) => g.i !== group.i || g.j !== group.j)!;
    return groupState(design, other) !== "complete";
  });
  return setSlots(design, free, undefined);
}

/** The complete groups joined into parts through shared slots, biggest first. */
export function parts(design: NoraDesign): Group[][] {
  const complete = new Map(completeGroups(design).map((g) => [groupKey(g.i, g.j), g]));
  const seen = new Set<string>();
  const out: Group[][] = [];
  for (const [key, start] of complete) {
    if (seen.has(key)) continue;
    seen.add(key);
    const part = [start];
    for (let n = 0; n < part.length; n++) {
      for (const s of groupSlots(part[n]!)) {
        for (const g of slotGroups(s)) {
          const k = groupKey(g.i, g.j);
          if (!complete.has(k) || seen.has(k)) continue;
          seen.add(k);
          part.push(g);
        }
      }
    }
    out.push(part);
  }
  return out.sort((a, b) => b.length - a.length);
}

// ---- Bead list by ring ----

export interface RingLine {
  group: Group;
  size: 4 | 8;
  /** Its beads in ring order, clockwise from the top. */
  keys: string[];
}

export function ringLines(design: NoraDesign): RingLine[] {
  return completeGroups(design).map((group) => ({
    group,
    size: groupSize(group),
    keys: groupSlots(group).map((s) => design.slots.get(slotKey(s.x, s.y))!),
  }));
}

/** "Ring 0, −1 (4): 3R, 1G". Runs of the same bead are joined, wrapping round the ring. */
export function formatRing(line: RingLine): string {
  const runs: { key: string; n: number }[] = [];
  for (const key of line.keys) {
    const last = runs[runs.length - 1];
    if (last?.key === key) last.n++;
    else runs.push({ key, n: 1 });
  }
  if (runs.length > 1 && runs[0]!.key === runs[runs.length - 1]!.key) runs[0]!.n += runs.pop()!.n;
  const num = (n: number) => String(n).replace("-", "−");
  return `Ring ${num(line.group.i)}, ${num(line.group.j)} (${line.size}): ${runs.map((r) => `${r.n}${r.key}`).join(", ")}`;
}

function unique<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((t) => {
    const k = key(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}
