// Keeps "My palettes" in this browser's localStorage, shared by every page,
// and the public palettes I picked in a designer, so they stay in Colors from.

import { emptyMyPalettes, type MyPalettes, myPalettesFromJson, myPalettesToJson, type PublicPalette } from "../src/collection/my-palettes.js";
import { type Palette, parsePalette } from "../src/collection/palettes.js";
import { presetPalettes } from "./presets.js";
import { announceSave } from "./store-events.js";

export const PALETTES_KEY = "bead-model:my-palettes";
/** Public palettes picked in a designer, newest first. Kept in this browser only, not synced. */
const USED_KEY = "bead-model:used-palettes";
const MAX_USED = 20;

export function loadMyPalettes(): MyPalettes {
  try {
    const text = localStorage.getItem(PALETTES_KEY);
    return text ? myPalettesFromJson(text) : emptyMyPalettes();
  } catch {
    return emptyMyPalettes();
  }
}

/** False when the browser won't keep them (storage off, as in some private windows). */
export function saveMyPalettes(list: MyPalettes): boolean {
  try {
    localStorage.setItem(PALETTES_KEY, myPalettesToJson(list));
    announceSave();
    return true;
  } catch {
    return false;
  }
}

/** The public palettes I picked, newest first. */
export function loadUsedPalettes(): PublicPalette[] {
  try {
    const raw = JSON.parse(localStorage.getItem(USED_KEY) ?? "[]") as unknown;
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((u: Partial<PublicPalette>) => {
      try {
        const palette = parsePalette(u.palette, "used palette");
        return typeof u.owner === "string" ? [{ owner: u.owner, by: typeof u.by === "string" ? u.by : "", updated: Number(u.updated) || 0, palette }] : [];
      } catch {
        return [];
      }
    });
  } catch {
    return [];
  }
}

/** Keeps a public palette I picked, so "Colors from" can name it. */
export function rememberUsedPalette(used: PublicPalette): void {
  const list = [used, ...loadUsedPalettes().filter((u) => !(u.owner === used.owner && u.palette.id === used.palette.id))].slice(0, MAX_USED);
  try {
    localStorage.setItem(USED_KEY, JSON.stringify(list));
  } catch {
    // Without storage it holds until the page closes.
  }
}

/** The presets, my palettes, then the public ones I picked: everything "Colors from" can offer. */
export function allPalettes(): Palette[] {
  const mine = loadMyPalettes().palettes;
  const used = loadUsedPalettes().map((u) => u.palette).filter((p) => !mine.some((m) => m.id === p.id));
  return [...presetPalettes, ...mine, ...used];
}
