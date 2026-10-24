// Keeps "My beads" in this browser's localStorage, shared by every page: the
// list itself and whether the designers offer only those beads.

import { emptyMyBeads, type MyBeads, myBeadsFromJson, myBeadsToJson } from "../src/collection/my-beads.js";

const STORAGE = {
  list: "bead-model:my-beads",
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
    return true;
  } catch {
    return false;
  }
}

export function loadOnlyMine(): boolean {
  try {
    return localStorage.getItem(STORAGE.onlyMine) === "true";
  } catch {
    return false;
  }
}

export function saveOnlyMine(on: boolean): void {
  try {
    localStorage.setItem(STORAGE.onlyMine, String(on));
  } catch {
    // Storage can be off. The setting holds until the page closes.
  }
}

/** Calls back when another tab changes the list or the setting. */
export function onMyBeadsChange(callback: () => void): void {
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key === STORAGE.list || event.key === STORAGE.onlyMine) callback();
  });
}
