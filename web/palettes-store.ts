// Keeps "My palettes" in this browser's localStorage, shared by every page.

import { emptyMyPalettes, type MyPalettes, myPalettesFromJson, myPalettesToJson } from "../src/collection/my-palettes.js";
import type { Palette } from "../src/collection/palettes.js";
import { presetPalettes } from "./presets.js";
import { announceSave } from "./store-events.js";

export const PALETTES_KEY = "bead-model:my-palettes";

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

/** The presets, then my palettes: everything "Colors from" can offer. */
export function allPalettes(): Palette[] {
  return [...presetPalettes, ...loadMyPalettes().palettes];
}
