// Resolves a flat design's bead size and its `beads:` entries against the
// catalog. A flat piece uses one bead size (docs/flat-peyote-spec.md §2), so
// every product code must belong to it, and own colors take its geometry.

import {
  type BrandSpec,
  type Catalog,
  findProduct,
  type LineSpec,
  nominal,
  type ResolvedBead,
  resolveBeads,
  type Shape,
  type SizeSpec,
} from "../catalog/catalog.js";
import type { BeadBox, FlatDesign } from "./grid.js";

export class FlatBeadError extends Error {}

export interface FlatBeadSize {
  brand: BrandSpec;
  line: LineSpec;
  size: SizeSpec;
  shape: Shape;
  box: BeadBox;
  beadsPerGram?: number;
  /** e.g. "Miyuki Delica 11/0". */
  label: string;
}

/** Looks up "<brand> <line> <size>", e.g. "miyuki delica DB" or "generic cylinder 11/0". */
export function resolveBeadSize(catalog: Catalog, text: string): FlatBeadSize {
  const parts = text.trim().split(/\s+/);
  if (parts.length !== 3) throw new FlatBeadError(`bead "${text}": expected "<brand> <line> <size>", e.g. "miyuki delica DB"`);
  const [brandId, lineId, sizeCode] = parts as [string, string, string];
  const brand = catalog.get(brandId.toLowerCase());
  if (!brand) throw new FlatBeadError(`bead "${text}": no brand "${brandId}" in the catalog`);
  const line = brand.lines.get(lineId);
  if (!line) throw new FlatBeadError(`bead "${text}": ${brand.name} has no line "${lineId}" (${[...brand.lines.keys()].join(", ")})`);
  const size = line.sizes.get(sizeCode);
  if (!size) throw new FlatBeadError(`bead "${text}": ${brand.name} ${line.name} has no size "${sizeCode}" (${[...line.sizes.keys()].join(", ")})`);
  return {
    brand,
    line,
    size,
    shape: line.shape,
    box: { w: nominal(size.length), d: nominal(size.outer_diameter) },
    beadsPerGram: size.beads_per_gram,
    label: `${brand.id === "generic" ? "" : `${brand.name} `}${line.name} ${size.label}`,
  };
}

/**
 * Resolves the bead size and every bead entry. Entries that don't fit the
 * piece's size are listed in `problems` (one per key) and still resolved, so
 * the page can show them.
 */
export function resolveFlatBeads(
  design: FlatDesign,
  catalog: Catalog,
): { size: FlatBeadSize; beads: Map<string, ResolvedBead>; problems: string[] } {
  const size = resolveBeadSize(catalog, design.bead);
  const beads = resolveBeads(Object.fromEntries(design.beads), catalog);
  const problems: string[] = [];
  for (const [key, entry] of design.beads) {
    const resolved = beads.get(key)!;
    const code = productText(entry);
    if (isRecord(entry) && typeof entry.brand === "string") {
      // { brand, line, size, color }
      const same =
        String(entry.brand).toLowerCase() === size.brand.id && entry.line === size.line.id && String(entry.size) === size.size.code;
      if (!same) problems.push(`bead ${key}: ${entry.brand} ${entry.line} ${entry.size} isn't the bead this piece uses (${size.label})`);
      continue;
    }
    if (code === undefined) {
      // A color of my own, in the piece's bead size.
      const name = isRecord(entry) && typeof entry.color === "string" ? entry.color : key;
      beads.set(key, {
        ...resolved,
        label: `${size.label} (${name})`,
        shape: size.shape,
        outerDiameter: size.box.d,
        length: size.box.w,
        hole: size.size.hole === undefined ? undefined : nominal(size.size.hole),
        beadsPerGram: size.beadsPerGram,
        warnings: [],
      });
      continue;
    }
    const product = findProduct(catalog, code);
    if (!product) {
      problems.push(`bead ${key}: "${code}" isn't a product in the catalog`);
    } else if (product.brand !== size.brand || product.line !== size.line || product.size !== size.size) {
      problems.push(
        `bead ${key}: "${code}" is ${product.brand.name} ${product.line.name} ${product.size.label}, but this piece uses ${size.label}`,
      );
    }
  }
  return { size, beads, problems };
}

/** The product code of a catalog entry, or undefined for a color of my own. */
function productText(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry;
  if (isRecord(entry) && typeof entry.bead === "string") return entry.bead;
  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
