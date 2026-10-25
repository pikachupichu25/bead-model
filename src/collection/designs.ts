// "My designs": every design someone has made, in any technique, plus the
// designs they pinned (their own or the examples). The list is plain data (kept
// in the browser's localStorage by the web app); this module reads and writes
// it, and orders and searches the feed on the Home page.

/** The techniques, as the designers name them: circular peyote (the Editor), flat peyote and the Nora net. */
export type DesignKind = "peyote" | "flat" | "nora";

export const DESIGN_KINDS: readonly DesignKind[] = ["peyote", "flat", "nora"];

export const KIND_LABELS: Record<DesignKind, string> = {
  peyote: "Circular peyote",
  flat: "Flat peyote",
  nora: "Nora net",
};

export interface SavedDesign {
  id: string;
  kind: DesignKind;
  title: string;
  /** The design file, as the designer downloads it. */
  yaml: string;
  /** When it was made and last changed, in ms since 1970. */
  created: number;
  updated: number;
}

export interface MyDesigns {
  version: 1;
  designs: SavedDesign[];
  /** Pinned design ids, newest pin first: a saved design's id, or an example's ("example:flat:heart-band"). */
  pinned: string[];
}

export class MyDesignsError extends Error {}

export function emptyMyDesigns(): MyDesigns {
  return { version: 1, designs: [], pinned: [] };
}

export function newDesignId(now = Date.now(), random = Math.random()): string {
  return `d${now.toString(36)}${Math.floor(random * 36 ** 4).toString(36).padStart(4, "0")}`;
}

export function exampleId(kind: DesignKind, name: string): string {
  return `example:${kind}:${name}`;
}

/** Reads a saved list. Entries it can't read are dropped, not fatal. */
export function myDesignsFromJson(text: string): MyDesigns {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new MyDesignsError("this isn't a My designs list (it isn't JSON)");
  }
  if (!isRecord(doc) || !Array.isArray(doc.designs)) throw new MyDesignsError("this isn't a My designs list (no `designs` list)");
  const out = emptyMyDesigns();
  for (const raw of doc.designs) {
    const design = readDesign(raw);
    if (design && !findDesign(out, design.id)) out.designs.push(design);
  }
  if (Array.isArray(doc.pinned)) out.pinned = [...new Set(doc.pinned.filter((p): p is string => typeof p === "string"))];
  return out;
}

export function myDesignsToJson(list: MyDesigns): string {
  return JSON.stringify(list);
}

function readDesign(raw: unknown): SavedDesign | undefined {
  if (!isRecord(raw)) return undefined;
  const { id, kind, title, yaml, created, updated } = raw;
  if (typeof id !== "string" || !id || typeof yaml !== "string") return undefined;
  if (typeof kind !== "string" || !(DESIGN_KINDS as readonly string[]).includes(kind)) return undefined;
  const made = typeof created === "number" && Number.isFinite(created) ? created : 0;
  return {
    id,
    kind: kind as DesignKind,
    title: typeof title === "string" && title.trim() ? title.trim() : "Untitled design",
    yaml,
    created: made,
    updated: typeof updated === "number" && Number.isFinite(updated) ? updated : made,
  };
}

export function findDesign(list: MyDesigns, id: string): SavedDesign | undefined {
  return list.designs.find((d) => d.id === id);
}

/** Adds the design, or replaces the one with its id. */
export function putDesign(list: MyDesigns, design: SavedDesign): MyDesigns {
  const others = list.designs.filter((d) => d.id !== design.id);
  return { ...list, designs: [...others, design] };
}

/** Takes the design out, and its pin with it. */
export function removeDesign(list: MyDesigns, id: string): MyDesigns {
  return { ...list, designs: list.designs.filter((d) => d.id !== id), pinned: list.pinned.filter((p) => p !== id) };
}

export function isPinned(list: MyDesigns, id: string): boolean {
  return list.pinned.includes(id);
}

/** Pins (as the newest pin) or unpins. */
export function setPinned(list: MyDesigns, id: string, on: boolean): MyDesigns {
  const pinned = list.pinned.filter((p) => p !== id);
  return { ...list, pinned: on ? [id, ...pinned] : pinned };
}

/** A design on the Home page or the profile: one of mine, or an example that comes with the app. */
export interface FeedItem {
  id: string;
  kind: DesignKind;
  title: string;
  yaml: string;
  /** Missing for an example. */
  updated?: number;
  example?: boolean;
}

/** Pinned first (newest pin first), then mine by last change (newest first), then the examples by title. */
export function orderFeed(items: readonly FeedItem[], pinned: readonly string[]): FeedItem[] {
  const pin = new Map(pinned.map((id, i) => [id, i]));
  return [...items].sort((a, b) => {
    const pa = pin.get(a.id) ?? Infinity;
    const pb = pin.get(b.id) ?? Infinity;
    if (pa !== pb) return pa - pb;
    if (!!a.example !== !!b.example) return a.example ? 1 : -1;
    return (b.updated ?? 0) - (a.updated ?? 0) || a.title.localeCompare(b.title);
  });
}

/** Whether every word of the query is in the title or the technique's name (case doesn't matter). */
export function matchesDesign(item: Pick<FeedItem, "title" | "kind">, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const text = `${item.title} ${KIND_LABELS[item.kind]}`.toLowerCase();
  return words.every((w) => text.includes(w));
}

/** The `title:` line of a design file. */
export function titleOfYaml(text: string): string | undefined {
  return /^title:\s*(.+?)\s*$/m.exec(text)?.[1]?.replace(/^["']|["']$/g, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
