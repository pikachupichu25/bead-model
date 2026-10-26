// Where the designers take the colors they offer from: every catalog color,
// My beads, or a palette. One setting, shared by every designer.

import type { Catalog } from "../catalog/catalog.js";
import { allBeadSizes, catalogColors, type FlatBeadSize, resolveBeadSize } from "../flat/beads.js";
import { type MyBeads, ownedColorsFor, ownedProducts, ownsProduct } from "./my-beads.js";
import { type Palette, type PaletteMatch, paletteColorsFor } from "./palettes.js";

export type ColorSource = "all" | "mine" | `palette:${string}`;

/** Reads a saved setting. Anything else, or a palette that's gone, is "all". */
export function readColorSource(text: string | null | undefined, palettes: Palette[]): ColorSource {
  if (text === "all" || text === "mine") return text;
  if (text?.startsWith("palette:") && paletteOf(text as ColorSource, palettes)) return text as ColorSource;
  return "all";
}

/** Whether text is a color source at all (the account stores it before the palette it names may have synced). */
export function isColorSourceText(text: unknown): text is ColorSource {
  return typeof text === "string" && /^(all|mine|palette:[a-z0-9][a-z0-9-]{0,63})$/.test(text);
}

export function paletteOf(source: ColorSource, palettes: Palette[]): Palette | undefined {
  return source.startsWith("palette:") ? palettes.find((p) => `palette:${p.id}` === source) : undefined;
}

/** The colors a designer offers in this bead size, as `beads:` entries. `mine` says whether My beads has it. */
export function offeredColors(
  source: ColorSource,
  size: FlatBeadSize,
  context: { myBeads: MyBeads; palettes: Palette[]; catalog: Catalog },
): (PaletteMatch & { mine: boolean })[] {
  const { myBeads } = context;
  if (source === "mine") return ownedColorsFor(myBeads, size).map((c) => ({ ...c, mine: true }));
  const palette = paletteOf(source, context.palettes);
  const colors: PaletteMatch[] = palette
    ? paletteColorsFor(palette, size, context.catalog)
    : catalogColors(size).map((c) => ({ entry: c.entry, name: c.name, rgb: c.rgb, code: c.entry.replace(/^\S+\s+/, "") }));
  return colors.map((c) => ({ ...c, mine: isOwned(myBeads, size, c.entry) }));
}

/**
 * The catalog products on offer in any bead size, lower case, for a designer
 * that mixes sizes (the Circular editor): undefined for every catalog color.
 * A palette gives its matches in every size; colors of my own aren't products, so they're left out.
 */
export function offeredProducts(source: ColorSource, context: { myBeads: MyBeads; palettes: Palette[]; catalog: Catalog }): Set<string> | undefined {
  if (source === "all") return undefined;
  if (source === "mine") return ownedProducts(context.myBeads);
  const palette = paletteOf(source, context.palettes);
  if (!palette) return undefined;
  const out = new Set<string>();
  for (const { text } of allBeadSizes(context.catalog)) {
    for (const c of paletteColorsFor(palette, resolveBeadSize(context.catalog, text), context.catalog)) {
      if (typeof c.entry === "string") out.add(c.entry.toLowerCase());
    }
  }
  return out;
}

/** Whether My beads has this `beads:` entry: a product code, or a color of my own in this size. */
export function isOwned(myBeads: MyBeads, size: FlatBeadSize, entry: unknown): boolean {
  if (typeof entry === "string") return ownsProduct(myBeads, entry);
  const text = JSON.stringify(entry);
  return ownedColorsFor(myBeads, size).some((c) => JSON.stringify(c.entry) === text);
}
