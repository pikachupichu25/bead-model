// What the flat designer prints and lists: for now the bead list with the
// amounts to buy. See docs/flat-peyote-spec.md §9.

import type { ResolvedBead } from "../catalog/catalog.js";
import { countBeads, type FlatDesign } from "./grid.js";

/** Extra beads to buy on top of the count, for breakage and culling. */
export const SPARE = 0.1;

export interface BeadListRow {
  key: string;
  label: string;
  rgb: string;
  count: number;
  /** Grams to buy, when the catalog knows the beads per gram. */
  grams?: number;
}

/**
 * Grams to buy for `count` beads: the count plus 10 % spare, rounded up to
 * the next half gram. undefined when the beads per gram aren't known.
 */
export function gramsToBuy(count: number, beadsPerGram: number | undefined): number | undefined {
  if (!beadsPerGram) return undefined;
  if (count === 0) return 0;
  return Math.ceil(((count * (1 + SPARE)) / beadsPerGram) * 2) / 2;
}

/** Every bead of the design in key order, with its count and grams, and the totals. */
export function beadList(
  design: FlatDesign,
  beads: ReadonlyMap<string, ResolvedBead>,
): { rows: BeadListRow[]; total: { count: number; grams?: number } } {
  const rows = [...countBeads(design)].map(([key, count]) => {
    const bead = beads.get(key);
    return { key, label: bead?.label ?? key, rgb: bead?.display.rgb ?? "#999", count, grams: gramsToBuy(count, bead?.beadsPerGram) };
  });
  const count = rows.reduce((sum, r) => sum + r.count, 0);
  const used = rows.filter((r) => r.count > 0);
  const grams = used.length > 0 && used.every((r) => r.grams !== undefined) ? used.reduce((sum, r) => sum + r.grams!, 0) : undefined;
  return { rows, total: { count, grams } };
}
