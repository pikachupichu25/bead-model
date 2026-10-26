// "My palettes": palettes someone saved themselves, from a design's colors or
// from their beads. Same shape as the presets, plus who may see them. Kept in
// the browser's localStorage by the web app, and synced with the account.
// See docs/preset-palettes.md.

import { type Palette, type PaletteColor, PaletteError, parsePalette } from "./palettes.js";

/** Who may see a palette: only its owner, or anyone (with an account to share from). */
export type Visibility = "private" | "public";

export interface MyPalette extends Palette {
  visibility: Visibility;
}

export interface MyPalettes {
  version: 1;
  palettes: MyPalette[];
}

/** A public palette as anyone can read it: whose it is (an account id and the display name), and when it last changed. */
export interface PublicPalette {
  owner: string;
  /** The owner's display name, or "" when they haven't set one. */
  by: string;
  updated: number;
  palette: Palette;
}

/** What Browse palettes gets: a page of public palettes, newest first, and where the next page starts. */
export interface PublicPalettePage {
  palettes: PublicPalette[];
  next?: number;
}

/** A design has at most 62 bead colors, so a palette never needs more. */
export const MAX_COLORS = 62;
export const MAX_PALETTE_NAME = 80;
export const MAX_DESCRIPTION = 200;

/** My palettes' ids start with this; presets' ids never do. */
const MY_PREFIX = "my-";

export function emptyMyPalettes(): MyPalettes {
  return { version: 1, palettes: [] };
}

export function isMyPaletteId(id: string): boolean {
  return id.startsWith(MY_PREFIX) && id.length <= 64;
}

/** A new id, e.g. "my-k3x9f2a7q1". */
export function newPaletteId(random: () => number = Math.random): string {
  let id = MY_PREFIX;
  for (let i = 0; i < 10; i++) id += "0123456789abcdefghijklmnopqrstuvwxyz"[Math.floor(random() * 36)];
  return id;
}

/**
 * Reads one of my palettes, or undefined when it isn't one. Anything but
 * `visibility: public` reads as private, so a damaged file never shares a palette.
 */
export function readMyPalette(raw: unknown): MyPalette | undefined {
  let palette: Palette;
  try {
    palette = parsePalette(raw, "palette");
  } catch (err) {
    if (err instanceof PaletteError) return undefined;
    throw err;
  }
  if (!isMyPaletteId(palette.id) || palette.name.length > MAX_PALETTE_NAME || (palette.description?.length ?? 0) > MAX_DESCRIPTION) return undefined;
  if (palette.colors.length > MAX_COLORS) return undefined;
  const visibility: Visibility = (raw as { visibility?: unknown }).visibility === "public" ? "public" : "private";
  return { ...palette, visibility };
}

/** Reads a saved list. Palettes it can't read are dropped, not fatal. */
export function myPalettesFromJson(text: string): MyPalettes {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    return emptyMyPalettes();
  }
  const raw = typeof doc === "object" && doc !== null && Array.isArray((doc as { palettes?: unknown }).palettes) ? (doc as { palettes: unknown[] }).palettes : [];
  return raw.reduce<MyPalettes>((list, p) => {
    const palette = readMyPalette(p);
    return palette && !findMyPalette(list, palette.id) ? { ...list, palettes: [...list.palettes, palette] } : list;
  }, emptyMyPalettes());
}

export function myPalettesToJson(list: MyPalettes): string {
  return JSON.stringify(list, null, 2);
}

export function findMyPalette(list: MyPalettes, id: string): MyPalette | undefined {
  return list.palettes.find((p) => p.id === id);
}

/** Adds a palette, or replaces the one with its id. */
export function putMyPalette(list: MyPalettes, palette: MyPalette): MyPalettes {
  const at = list.palettes.findIndex((p) => p.id === palette.id);
  return { ...list, palettes: at < 0 ? [...list.palettes, palette] : list.palettes.map((p, i) => (i === at ? palette : p)) };
}

export function removeMyPalette(list: MyPalettes, id: string): MyPalettes {
  return { ...list, palettes: list.palettes.filter((p) => p.id !== id) };
}

/**
 * Adds the palettes of a backup this list doesn't have yet, each as private:
 * making a palette public is a choice made on the account, not something a file can do.
 */
export function mergeMyPalettes(list: MyPalettes, other: MyPalettes): MyPalettes {
  return other.palettes.reduce((l, p) => (findMyPalette(l, p.id) ? l : putMyPalette(l, { ...p, visibility: "private" })), list);
}

/**
 * A new private palette from `beads:` entries (a design's beads, or my beads in
 * a size): product codes stay products, colors of my own keep their color. Undefined when none can be used.
 */
export function paletteFromEntries(name: string, entries: unknown[], id = newPaletteId()): MyPalette | undefined {
  const colors: PaletteColor[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    const color = colorOf(entry);
    const key = color && JSON.stringify(color).toLowerCase();
    if (!color || seen.has(key!)) continue;
    seen.add(key!);
    colors.push(color);
  }
  if (colors.length === 0) return undefined;
  return { id, name: name.trim().slice(0, MAX_PALETTE_NAME) || "My palette", colors: colors.slice(0, MAX_COLORS), visibility: "private" };
}

/** A copy of someone's palette, to keep as my own: a new id, private. */
export function copyPalette(palette: Palette, id = newPaletteId()): MyPalette {
  const description = palette.description ? { description: palette.description } : {};
  return { id, name: palette.name, ...description, colors: palette.colors.slice(0, MAX_COLORS), visibility: "private" };
}

function colorOf(entry: unknown): PaletteColor | undefined {
  if (typeof entry === "string" && entry.trim()) return { bead: entry.trim() };
  if (typeof entry !== "object" || entry === null) return undefined;
  const e = entry as { bead?: unknown; color?: unknown; display?: { rgb?: unknown } };
  if (typeof e.bead === "string" && e.bead.trim()) return { bead: e.bead.trim() };
  const rgb = e.display?.rgb;
  if (typeof rgb === "string" && /^#[0-9a-f]{6}$/i.test(rgb)) {
    const name = typeof e.color === "string" && e.color.trim() ? e.color.trim() : rgb.toLowerCase();
    return { rgb: rgb.toLowerCase(), name };
  }
  return undefined;
}
