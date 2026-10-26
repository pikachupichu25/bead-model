// Palettes: short, named sets of bead colors that go together ("Ocean",
// "Pastel"). Picking one in a designer narrows the colors on offer to that
// set, the way "Only my beads" narrows them to My beads. The presets live in
// catalog/palettes/*.yaml. See docs/preset-palettes.md.

import { parse as parseYaml } from "yaml";
import { type Catalog, findProduct } from "../catalog/catalog.js";
import { catalogColors, type FlatBeadSize } from "../flat/beads.js";
import { deltaE2000, hexToLab } from "../flat/color.js";

/** A catalog product ("miyuki DB-0010"), or a color by display value only. */
export type PaletteColor = { bead: string; role?: PaletteRole } | { rgb: string; name: string; role?: PaletteRole };
export type PaletteRole = "dark" | "light" | "accent";

export interface Palette {
  id: string;
  name: string;
  description?: string;
  colors: PaletteColor[];
}

export class PaletteError extends Error {}

/** How different a catalog color may look and still stand in for a palette color (CIEDE2000). */
export const MAX_DELTA_E = 12;

const ROLES: readonly string[] = ["dark", "light", "accent"];

/** Reads the preset files, in file name order. A palette that can't be read is an error: presets ship with the app. */
export function palettesFromFiles(files: { name: string; text: string }[]): Palette[] {
  const palettes: Palette[] = [];
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const palette = parsePalette(parseYaml(file.text), file.name);
    if (palettes.some((p) => p.id === palette.id)) throw new PaletteError(`${file.name}: palette "${palette.id}" is defined twice`);
    palettes.push(palette);
  }
  return palettes;
}

export function parsePalette(doc: unknown, where: string): Palette {
  const fail = (msg: string): never => {
    throw new PaletteError(`${where}: ${msg}`);
  };
  if (!isRecord(doc)) return fail("expected a palette (id, name, colors)");
  const id = typeof doc.id === "string" && /^[a-z0-9][a-z0-9-]*$/.test(doc.id) ? doc.id : fail("`id` must be lower case letters, digits and dashes");
  const name = typeof doc.name === "string" && doc.name.trim() ? doc.name.trim() : fail("`name` is required");
  if (!Array.isArray(doc.colors) || doc.colors.length === 0) return fail("`colors` must be a list with at least one color");
  const colors = doc.colors.map((raw, i): PaletteColor => {
    const at = `colors[${i}]`;
    if (!isRecord(raw)) return fail(`${at}: expected { bead } or { rgb, name }`);
    const role = raw.role === undefined ? undefined : typeof raw.role === "string" && ROLES.includes(raw.role) ? (raw.role as PaletteRole) : fail(`${at}: role must be ${ROLES.join(", ")}`);
    const extra = role ? { role } : {};
    if (typeof raw.bead === "string" && raw.bead.trim()) return { bead: raw.bead.trim(), ...extra };
    if (typeof raw.rgb === "string" && /^#[0-9a-f]{6}$/i.test(raw.rgb)) {
      const colorName = typeof raw.name === "string" && raw.name.trim() ? raw.name.trim() : fail(`${at}: a color by rgb needs a name`);
      return { rgb: raw.rgb.toLowerCase(), name: colorName, ...extra };
    }
    return fail(`${at}: expected { bead: "<brand> <code>" } or { rgb: "#rrggbb", name }`);
  });
  const description = typeof doc.description === "string" && doc.description.trim() ? { description: doc.description.trim() } : {};
  return { id, name, ...description, colors };
}

/** Warnings about the presets that don't stop them loading: products the catalog doesn't have. */
export function checkPalettes(palettes: Palette[], catalog: Catalog): string[] {
  const warnings: string[] = [];
  for (const palette of palettes) {
    for (const color of palette.colors) {
      if ("bead" in color && !findProduct(catalog, color.bead)?.color) warnings.push(`palette ${palette.id}: "${color.bead}" isn't in the catalog`);
    }
  }
  return warnings;
}

/** A palette color as it looks, whatever the bead size: the catalog's display color, or its own. */
export function paletteSwatches(palette: Palette, catalog: Catalog): { name: string; rgb: string }[] {
  return palette.colors.map((color) => {
    if ("rgb" in color) return { name: color.name, rgb: color.rgb };
    const product = findProduct(catalog, color.bead);
    return { name: product?.color?.name ?? color.bead, rgb: product?.color?.display.rgb ?? "#999999" };
  });
}

/** A palette color in one bead size, as a `beads:` entry, like `ownedColorsFor` gives. */
export interface PaletteMatch {
  entry: unknown;
  name: string;
  rgb: string;
  /** e.g. "DB-0010", or "own" when no catalog color in this size is close enough. */
  code: string;
  /** Set when this isn't the palette's own product: the palette color it stands in for, and how far off it is. */
  nearest?: { name: string; deltaE: number };
}

/**
 * The palette in this bead size:
 * - a `bead:` product of this size is used as it is;
 * - any other color is matched to the nearest catalog color in this size, when it's within MAX_DELTA_E;
 * - a color with no close match becomes a color of my own in this size (`{ color, display }`).
 * Two palette colors that land on the same bead count once.
 */
export function paletteColorsFor(palette: Palette, size: FlatBeadSize, catalog: Catalog): PaletteMatch[] {
  const offered = catalogColors(size).map((c) => ({ ...c, lab: hexToLab(c.rgb) }));
  const sizeText = `${size.brand.id} ${size.line.id} ${size.size.code}`.toLowerCase();
  const out = new Map<string, PaletteMatch>();
  for (const color of palette.colors) {
    const swatch = paletteSwatches({ ...palette, colors: [color] }, catalog)[0]!;
    if ("bead" in color) {
      const product = findProduct(catalog, color.bead);
      const same = product && `${product.brand.id} ${product.line.id} ${product.size.code}`.toLowerCase() === sizeText;
      const exact = same ? offered.find((c) => c.entry.toLowerCase() === color.bead.toLowerCase()) : undefined;
      if (exact) {
        add({ entry: exact.entry, name: exact.name, rgb: exact.rgb, code: codeOf(exact.entry) });
        continue;
      }
      if (!product?.color) continue; // not in the catalog: checkPalettes reports it
    }
    const lab = hexToLab(swatch.rgb);
    let best: { c: (typeof offered)[number]; d: number } | undefined;
    for (const c of offered) {
      const d = deltaE2000(lab, c.lab);
      if (!best || d < best.d) best = { c, d };
    }
    if (best && best.d <= MAX_DELTA_E) {
      add({ entry: best.c.entry, name: best.c.name, rgb: best.c.rgb, code: codeOf(best.c.entry), nearest: { name: swatch.name, deltaE: best.d } });
    } else {
      add({ entry: { color: swatch.name, display: { rgb: swatch.rgb } }, name: swatch.name, rgb: swatch.rgb, code: "own" });
    }
  }
  return [...out.values()];

  function add(match: PaletteMatch): void {
    const key = JSON.stringify(match.entry).toLowerCase();
    if (!out.has(key)) out.set(key, match);
  }
}

function codeOf(entry: string): string {
  return entry.replace(/^\S+\s+/, "");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
