// Keeps "My designs" in this browser's localStorage, shared by every page, and
// remembers which saved design each designer has open.

import {
  type DesignKind,
  emptyMyDesigns,
  findDesign,
  type MyDesigns,
  myDesignsFromJson,
  myDesignsToJson,
  newDesignId,
  putDesign,
} from "../src/collection/designs.js";

const STORAGE = {
  list: "bead-model:my-designs",
  open: (kind: DesignKind) => `bead-model:open-design:${kind}`,
};

export function loadMyDesigns(): MyDesigns {
  try {
    const text = localStorage.getItem(STORAGE.list);
    return text ? myDesignsFromJson(text) : emptyMyDesigns();
  } catch {
    return emptyMyDesigns();
  }
}

/** False when the browser won't keep it (storage off, or full). */
export function saveMyDesigns(list: MyDesigns): boolean {
  try {
    localStorage.setItem(STORAGE.list, myDesignsToJson(list));
    return true;
  } catch {
    return false;
  }
}

/** Calls back when another tab changes the list. */
export function onMyDesignsChange(callback: () => void): void {
  window.addEventListener("storage", (event) => {
    if (event.key === null || event.key === STORAGE.list) callback();
  });
}

/**
 * What a designer is asked for in its address: `#design=<id>` (one of mine),
 * `#example=<name>` or `#new`. Clears it, so a reload keeps the work.
 */
export function takeDesignHash(): { design?: string; example?: string; isNew: boolean } {
  const params = new URLSearchParams(location.hash.slice(1));
  const design = params.get("design") ?? undefined;
  const example = params.get("example") ?? undefined;
  const isNew = params.has("new");
  if (design || example || isNew) history.replaceState(null, "", location.pathname + location.search);
  return { design, example, isNew };
}

/**
 * The design a designer has open, as an entry in My designs. A new design or
 * an example only becomes one of mine once it differs from how it started.
 */
export interface OpenDesign {
  readonly id: string | undefined;
  /** Opens one of mine. */
  open(id: string): void;
  /** Starts something that isn't saved yet (a new design, an example). `yaml` is how it starts. */
  start(yaml?: string): void;
  /** Saves the design. False when the browser won't keep it. */
  save(title: string, yaml: string, empty?: boolean): boolean;
}

export function openDesign(kind: DesignKind): OpenDesign {
  let id = read(STORAGE.open(kind));
  let pristine: string | undefined;
  const remember = (next: string | undefined) => {
    id = next;
    try {
      if (next) localStorage.setItem(STORAGE.open(kind), next);
      else localStorage.removeItem(STORAGE.open(kind));
    } catch {
      // Without storage there is nothing to remember it in.
    }
  };
  return {
    get id() {
      return id;
    },
    open(next) {
      pristine = undefined;
      remember(next);
    },
    start(yaml) {
      pristine = yaml;
      remember(undefined);
    },
    save(title, yaml, empty = false) {
      // Read fresh each time: another tab may have changed other designs.
      const list = loadMyDesigns();
      const saved = id ? findDesign(list, id) : undefined;
      if (saved?.yaml === yaml && saved.title === title) return true;
      if (!saved && (empty || yaml === pristine)) return true;
      const now = Date.now();
      const design = { id: saved?.id ?? newDesignId(now), kind, title, yaml, created: saved?.created ?? now, updated: now };
      if (!saveMyDesigns(putDesign(list, design))) return false;
      if (design.id !== id) remember(design.id);
      return true;
    },
  };
}

function read(key: string): string | undefined {
  try {
    return localStorage.getItem(key) ?? undefined;
  } catch {
    return undefined;
  }
}
