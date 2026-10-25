// The two events between the stores and web/sync.ts on one page: a store saved
// something (so sync soon), and sync brought in changes (so re-draw).

const SAVED = "bead-model:saved";
const SYNCED = "bead-model:synced";

let quiet = false;

/** Called by the stores after each save. */
export function announceSave(): void {
  if (!quiet) window.dispatchEvent(new Event(SAVED));
}

export function onSave(callback: () => void): void {
  window.addEventListener(SAVED, callback);
}

/** Saves without announcing: for sync's own writes. */
export function quietly(write: () => void): void {
  quiet = true;
  try {
    write();
  } finally {
    quiet = false;
  }
}

export function announceSynced(): void {
  window.dispatchEvent(new Event(SYNCED));
}

export function onSynced(callback: () => void): void {
  window.addEventListener(SYNCED, callback);
}
