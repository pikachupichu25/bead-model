// Keeps the picture behind the beads between visits. It is too big for
// localStorage, so it goes in IndexedDB. Storage can be missing or blocked
// (a private window, say); then the picture just lasts until the page closes.

import type { Rect } from "../src/flat/view.js";

export interface StoredBackdrop {
  image: Blob;
  /** Where the picture lies on the canvas, in mm. */
  rect: Rect;
  opacity: number;
  shown: boolean;
}

const DB = "bead-model-flat";
const STORE = "backdrop";
const KEY = "current";

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, act: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | undefined> {
  try {
    const db = await open();
    return await new Promise<T>((resolve, reject) => {
      const req = act(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }).finally(() => db.close());
  } catch {
    return undefined;
  }
}

export async function loadBackdrop(): Promise<StoredBackdrop | undefined> {
  return run<StoredBackdrop | undefined>("readonly", (store) => store.get(KEY));
}

export async function saveBackdrop(backdrop: StoredBackdrop): Promise<void> {
  await run("readwrite", (store) => store.put(backdrop, KEY));
}

export async function clearBackdrop(): Promise<void> {
  await run("readwrite", (store) => store.delete(KEY));
}
