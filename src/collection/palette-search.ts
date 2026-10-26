// Finding a palette among many (presets, my own, ones I used, public ones):
// by words in its name, description, tags, owner or color names, by a tag, or
// by a color it has. The designers' palette menu uses this.

import type { Catalog } from "../catalog/catalog.js";
import { deltaE2000, hexToLab, type Lab } from "../flat/color.js";
import { type Palette, paletteSwatches } from "./palettes.js";

/** Where a palette in the menu comes from. */
export type PaletteKind = "preset" | "mine" | "used" | "public";

export interface PaletteEntry {
  palette: Palette;
  kind: PaletteKind;
  /** A public palette's owner (account id) and display name. */
  owner?: string;
  by?: string;
  /** How its colors look, whatever the bead size. */
  swatches: { name: string; rgb: string }[];
}

export interface PaletteQuery {
  /** Words, all of which must match. A "#rrggbb" word is a color. */
  text: string;
  /** Only palettes with all these tags. */
  tags?: string[];
  /** Only palettes with a color like this one ("#rrggbb"), closest first. */
  color?: string;
}

/** How close a palette's color must be to the one searched for (CIEDE2000). */
export const COLOR_MATCH = 15;
/** How close for a color word ("blue"), which stands for a broad range of colors. */
const WORD_MATCH = 16;

/** Color words people search with, and a color each stands for. */
const COLOR_WORDS: Record<string, string> = {
  red: "#c8102e",
  orange: "#e8661c",
  yellow: "#f2c81a",
  gold: "#c9a24a",
  green: "#2f9a3c",
  lime: "#8cc43c",
  teal: "#1e7070",
  turquoise: "#2aa8a8",
  aqua: "#58b8c4",
  blue: "#2f6cb4",
  navy: "#1c2f7a",
  purple: "#5a2a6a",
  violet: "#6a5acd",
  lilac: "#a68cc0",
  pink: "#f0a0b8",
  brown: "#6a4030",
  beige: "#e0c8a0",
  cream: "#f0e2b8",
  black: "#151515",
  white: "#f6f6f2",
  gray: "#8e9296",
  grey: "#8e9296",
  silver: "#b9bcc0",
};

export function paletteEntry(palette: Palette, kind: PaletteKind, catalog: Catalog, from: { owner?: string; by?: string } = {}): PaletteEntry {
  return { palette, kind, ...from, swatches: paletteSwatches(palette, catalog) };
}

/**
 * The entries that match, in the order given, or closest first when searching
 * by color. Each word must match the name, description, a tag, the owner's
 * name or a color's name, or, for a color word or "#rrggbb", look like one of its colors.
 */
export function searchPalettes(entries: PaletteEntry[], query: PaletteQuery): PaletteEntry[] {
  const words = query.text.toLowerCase().split(/[\s,]+/).filter(Boolean);
  const tags = (query.tags ?? []).map((t) => t.toLowerCase());
  const target = query.color && isHex(query.color) ? hexToLab(query.color) : undefined;
  const scored: { entry: PaletteEntry; distance: number; order: number }[] = [];
  entries.forEach((entry, order) => {
    if (tags.some((t) => !entry.palette.tags?.includes(t))) return;
    const labs = entry.swatches.map((s) => hexToLab(s.rgb));
    if (!words.every((word) => matchesWord(entry, labs, word))) return;
    const distance = target ? closest(labs, target) : 0;
    if (target && distance > COLOR_MATCH) return;
    scored.push({ entry, distance, order });
  });
  return scored.sort((a, b) => a.distance - b.distance || a.order - b.order).map((s) => s.entry);
}

/** The most used tags, most used first, for the menu's tag buttons. */
export function topTags(entries: PaletteEntry[], count = 12): string[] {
  const counts = new Map<string, number>();
  for (const e of entries) for (const t of e.palette.tags ?? []) counts.set(t, (counts.get(t) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, count)
    .map(([t]) => t);
}

function matchesWord(entry: PaletteEntry, labs: Lab[], word: string): boolean {
  if (isHex(word)) return closest(labs, hexToLab(word)) <= COLOR_MATCH;
  const { palette } = entry;
  const texts = [palette.name, palette.description ?? "", entry.by ?? "", ...(palette.tags ?? []), ...entry.swatches.map((s) => s.name)];
  if (texts.some((t) => t.toLowerCase().includes(word))) return true;
  const color = COLOR_WORDS[word];
  return color !== undefined && closest(labs, hexToLab(color)) <= WORD_MATCH;
}

function closest(labs: Lab[], target: Lab): number {
  return labs.reduce((best, lab) => Math.min(best, deltaE2000(lab, target)), Infinity);
}

function isHex(text: string): boolean {
  return /^#[0-9a-f]{6}$/i.test(text);
}
