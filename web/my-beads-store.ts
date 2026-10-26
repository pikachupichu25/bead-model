// Keeps "My beads" in this browser's localStorage, shared by every page: the
// list itself and where the designers take their colors from (every catalog
// color, only my beads, or a palette).

import { type ColorSource, readColorSource } from "../src/collection/color-source.js";
import { emptyMyBeads, type MyBeads, myBeadsFromJson, myBeadsToJson } from "../src/collection/my-beads.js";
import { presetPalettes } from "./presets.js";
import { announceSave, onSynced } from "./store-events.js";

const STORAGE = {
  list: "bead-model:my-beads",
  colorSource: "bead-model:color-source",
  // Older than the color source, and still what syncs with the account (profiles.only_my_beads):
  // "true" when the source is My beads.
  onlyMine: "bead-model:only-my-beads",
};

export function loadMyBeads(): MyBeads {
  try {
    const text = localStorage.getItem(STORAGE.list);
    return text ? myBeadsFromJson(text) : emptyMyBeads();
  } catch {
    return emptyMyBeads();
  }
}

/** False when the browser won't keep it (storage off, as in some private windows). */
export function saveMyBeads(list: MyBeads): boolean {
  try {
    localStorage.setItem(STORAGE.list, myBeadsToJson(list));
    announceSave();
    return true;
  } catch {
    return false;
  }
}

/** Where the designers take their colors from. A browser that only has the older "only my beads" setting gets it from that. */
export function loadColorSource(): ColorSource {
  try {
    const saved = localStorage.getItem(STORAGE.colorSource);
    if (saved !== null) return readColorSource(saved, presetPalettes);
    return localStorage.getItem(STORAGE.onlyMine) === "true" ? "mine" : "all";
  } catch {
    return "all";
  }
}

export function saveColorSource(source: ColorSource): void {
  try {
    localStorage.setItem(STORAGE.colorSource, source);
    localStorage.setItem(STORAGE.onlyMine, String(source === "mine"));
    announceSave();
  } catch {
    // Storage can be off. The setting holds until the page closes.
  }
}

/** Whether the source is My beads: the part of the setting that syncs with the account. */
export function loadOnlyMine(): boolean {
  return loadColorSource() === "mine";
}

/** From the account or a moved site: on picks My beads; off leaves a palette as it is. */
export function saveOnlyMine(on: boolean): void {
  const source = loadColorSource();
  if (on) saveColorSource("mine");
  else if (source === "mine") saveColorSource("all");
}

/** Calls back when another tab, or a sync with the account, changes the list or the setting. */
export function onMyBeadsChange(callback: () => void): void {
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key === STORAGE.list || event.key === STORAGE.colorSource || event.key === STORAGE.onlyMine) callback();
  });
  onSynced(callback);
}
