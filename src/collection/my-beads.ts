// "My beads": the beads someone has at home, so a design can be built from
// them only. The list is plain data (kept in the browser's localStorage by the
// web app); this module reads and writes it and turns it into readable text.

import { type Catalog, findProduct } from "../catalog/catalog.js";
import { catalogColors, type FlatBeadSize, resolveBeadSize } from "../flat/beads.js";

/** A catalog bead (product code, e.g. "miyuki DB-0010"), or a color of my own in a catalog bead size. */
export type OwnedBead =
  | { kind: "catalog"; bead: string; amount?: string; note?: string }
  | { kind: "own"; size: string; name: string; rgb: string; amount?: string; note?: string };

export interface MyBeads {
  version: 1;
  beads: OwnedBead[];
}

export class MyBeadsError extends Error {}

export function emptyMyBeads(): MyBeads {
  return { version: 1, beads: [] };
}

/** Identifies a bead in the list: the same product twice, or the same own color in the same size, is one bead. */
export function ownedId(bead: OwnedBead): string {
  return bead.kind === "catalog"
    ? `catalog:${bead.bead.trim().toLowerCase()}`
    : `own:${bead.size.trim().toLowerCase()}:${bead.name.trim().toLowerCase()}`;
}

/** Reads a saved list or a backup file. Entries it can't read are dropped, not fatal. */
export function myBeadsFromJson(text: string): MyBeads {
  let doc: unknown;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new MyBeadsError("this isn't a My beads backup (it isn't JSON)");
  }
  if (!isRecord(doc) || !Array.isArray(doc.beads)) throw new MyBeadsError("this isn't a My beads backup (no `beads` list)");
  const out = emptyMyBeads();
  for (const raw of doc.beads) {
    const bead = readOwnedBead(raw);
    if (bead) out.beads = addOwned(out, bead).beads;
  }
  return out;
}

export function myBeadsToJson(list: MyBeads): string {
  return JSON.stringify(list, null, 2);
}

/** Reads one owned bead, or undefined when it isn't one. */
export function readOwnedBead(raw: unknown): OwnedBead | undefined {
  if (!isRecord(raw)) return undefined;
  const extra = {
    ...(typeof raw.amount === "string" && raw.amount.trim() ? { amount: raw.amount.trim() } : {}),
    ...(typeof raw.note === "string" && raw.note.trim() ? { note: raw.note.trim() } : {}),
  };
  if (raw.kind === "catalog" && typeof raw.bead === "string" && raw.bead.trim()) {
    return { kind: "catalog", bead: raw.bead.trim(), ...extra };
  }
  if (
    raw.kind === "own" &&
    typeof raw.size === "string" &&
    typeof raw.name === "string" &&
    raw.name.trim() &&
    typeof raw.rgb === "string" &&
    /^#[0-9a-f]{6}$/i.test(raw.rgb)
  ) {
    return { kind: "own", size: raw.size.trim(), name: raw.name.trim(), rgb: raw.rgb.toLowerCase(), ...extra };
  }
  return undefined;
}

export function hasOwned(list: MyBeads, bead: OwnedBead): boolean {
  const id = ownedId(bead);
  return list.beads.some((b) => ownedId(b) === id);
}

/** Adds a bead. A bead already in the list stays as it is. */
export function addOwned(list: MyBeads, bead: OwnedBead): MyBeads {
  return hasOwned(list, bead) ? list : { ...list, beads: [...list.beads, bead] };
}

export function removeOwned(list: MyBeads, id: string): MyBeads {
  return { ...list, beads: list.beads.filter((b) => ownedId(b) !== id) };
}

export function updateOwned(list: MyBeads, id: string, change: { amount?: string; note?: string }): MyBeads {
  return {
    ...list,
    beads: list.beads.map((b) => {
      if (ownedId(b) !== id) return b;
      const next = { ...b, ...change };
      if (!next.amount?.trim()) delete next.amount;
      if (!next.note?.trim()) delete next.note;
      return next;
    }),
  };
}

/** Adds every bead of `other` this list doesn't have yet. */
export function mergeMyBeads(list: MyBeads, other: MyBeads): MyBeads {
  return other.beads.reduce(addOwned, list);
}

/** The product codes in the list, lower case, for quick lookups. */
export function ownedProducts(list: MyBeads): Set<string> {
  return new Set(list.beads.flatMap((b) => (b.kind === "catalog" ? [b.bead.trim().toLowerCase()] : [])));
}

export function ownsProduct(list: MyBeads, code: string): boolean {
  return ownedProducts(list).has(code.trim().toLowerCase());
}

/** A bead in the list, with what the page needs to show it. */
export interface OwnedView {
  id: string;
  bead: OwnedBead;
  /** The bead size, as "<brand> <line> <size>" (as `resolveBeadSize` takes it). Missing for a product the catalog doesn't know. */
  size?: string;
  /** e.g. "Miyuki Delica 11/0 (DB)". */
  sizeLabel: string;
  /** e.g. "DB-0010", or "own" for a color of my own. */
  code: string;
  name: string;
  rgb: string;
}

/** Every bead in the list, by bead size (in catalog order), then by code. */
export function groupMyBeads(list: MyBeads, catalog: Catalog): { size?: string; label: string; beads: OwnedView[] }[] {
  const order = sizeOrder(catalog);
  const groups = new Map<string, { size?: string; label: string; beads: OwnedView[] }>();
  for (const bead of list.beads) {
    const view = viewOf(bead, catalog);
    const key = view.size ?? "?";
    const group = groups.get(key) ?? { size: view.size, label: view.sizeLabel, beads: [] };
    group.beads.push(view);
    groups.set(key, group);
  }
  for (const group of groups.values()) {
    group.beads.sort((a, b) => Number(a.bead.kind === "own") - Number(b.bead.kind === "own") || a.code.localeCompare(b.code) || a.name.localeCompare(b.name));
  }
  return [...groups.values()].sort((a, b) => (order.get(a.size ?? "") ?? 1e9) - (order.get(b.size ?? "") ?? 1e9));
}

function viewOf(bead: OwnedBead, catalog: Catalog): OwnedView {
  const id = ownedId(bead);
  if (bead.kind === "own") {
    let sizeLabel = bead.size;
    try {
      sizeLabel = sizeName(resolveBeadSize(catalog, bead.size));
    } catch {
      // A size the catalog no longer has: show it as written.
    }
    return { id, bead, size: bead.size, sizeLabel, code: "own", name: bead.name, rgb: bead.rgb };
  }
  const product = findProduct(catalog, bead.bead);
  if (!product) return { id, bead, sizeLabel: "Not in the catalog", code: bead.bead, name: "", rgb: "#999999" };
  const { brand, line, size, color } = product;
  const sizeText = `${brand.id} ${line.id} ${size.code}`;
  return {
    id,
    bead,
    size: sizeText,
    sizeLabel: sizeName(resolveBeadSize(catalog, sizeText)),
    code: bead.bead.replace(/^\S+\s+/, ""),
    name: color?.name ?? "",
    rgb: color?.display.rgb ?? "#999999",
  };
}

/** "Miyuki Delica 11/0 (DB)": the size label, with the size code when it says something different. */
function sizeName(size: FlatBeadSize): string {
  return `${size.label}${size.size.code !== size.size.label ? ` (${size.size.code})` : ""}`;
}

function sizeOrder(catalog: Catalog): Map<string, number> {
  const order = new Map<string, number>();
  for (const brand of catalog.values()) {
    for (const line of brand.lines.values()) {
      for (const size of line.sizes.values()) order.set(`${brand.id} ${line.id} ${size.code}`, order.size);
    }
  }
  return order;
}

/** The bead sizes the list has at least one bead in, as "<brand> <line> <size>". */
export function ownedSizes(list: MyBeads, catalog: Catalog): Set<string> {
  return new Set(groupMyBeads(list, catalog).flatMap((g) => (g.size ? [g.size] : [])));
}

/**
 * The beads in the list that come in this bead size, as `beads:` entries for a
 * flat design: a product code for a catalog bead, `{ color, display }` for a
 * color of my own.
 */
export function ownedColorsFor(list: MyBeads, size: FlatBeadSize): { entry: unknown; name: string; rgb: string; code: string }[] {
  const owned = ownedProducts(list);
  const sizeText = `${size.brand.id} ${size.line.id} ${size.size.code}`;
  const catalogOwned = catalogColors(size)
    .filter((c) => owned.has(c.entry.toLowerCase()))
    .map((c) => ({ entry: c.entry as unknown, name: c.name, rgb: c.rgb, code: c.entry.replace(/^\S+ /, "") }));
  const own = list.beads.flatMap((b) =>
    b.kind === "own" && b.size.toLowerCase() === sizeText.toLowerCase()
      ? [{ entry: { color: b.name, display: { rgb: b.rgb } } as unknown, name: b.name, rgb: b.rgb, code: "own" }]
      : [],
  );
  return [...catalogOwned, ...own];
}

/**
 * The list as text for people: one block per bead size, one line per bead,
 * with the amount and note when they're filled in.
 *
 *   My beads
 *   Exported 24 Oct 2026 · 3 beads in 2 sizes
 *
 *   Miyuki Delica 11/0 (DB) · 2 beads
 *     DB-0010  black              10 g
 *     own      dusty rose #c48a90  for the whale
 */
export function myBeadsText(list: MyBeads, catalog: Catalog, exported = new Date()): string {
  const groups = groupMyBeads(list, catalog);
  const count = list.beads.length;
  const date = exported.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  const lines = ["My beads", `Exported ${date} · ${plural(count, "bead")} in ${plural(groups.length, "size")}`];
  if (count === 0) lines.push("", "(No beads yet.)");
  for (const group of groups) {
    lines.push("", `${group.label} · ${plural(group.beads.length, "bead")}`);
    const rows = group.beads.map((b) => [b.code, b.bead.kind === "own" ? `${b.name} ${b.rgb}` : b.name, b.bead.amount ?? "", b.bead.note ?? ""]);
    const widths = [0, 1, 2].map((i) => Math.max(...rows.map((r) => r[i]!.length)));
    for (const row of rows) {
      const cells = row.map((cell, i) => (i < 3 ? cell.padEnd(widths[i]!) : cell));
      lines.push(`  ${cells.join("  ")}`.trimEnd());
    }
  }
  return `${lines.join("\n")}\n`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
