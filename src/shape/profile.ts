// What the bead counts alone say about the shape, before any 3D solving.
// See docs/shape-model.md.
//
// Going once round a worked round, the thread passes every new bead and every
// up bead once, so the row the round lies in is about
//     row length = Σ length of the new beads + Σ length of the up beads.
// Each round sits about half a bead diameter (Δs) further across the fabric.
// A flat circle grows its circumference by 2π for each unit of radius, so
//     growth = (row length − row length of the round below) / (2π Δs)
// is 1 for a flat circle, 0 for a straight tube wall, below 0 for an edge that
// curls inward, and above 1 when there are more beads than a flat circle can
// hold: the piece ruffles, unless the increases stay at fixed corners (a
// triangle lies flat up to about 1.65).
//
// Peyote works in pairs of rounds (a round of pairs, then a round that splits
// or skips them), so growth is measured over two rounds where it can be.

import type { ResolvedBead } from "../catalog/catalog.js";
import type { CompiledPattern, CompiledRound } from "../pattern/compile.js";
import { TENSION } from "./contacts.js";

export interface RoundProfile {
  round: number;
  /** The round whose up beads this round is worked into (undefined for start rounds). */
  parent?: number;
  /** Length of the row through this round's beads, mm. */
  rowLength: number;
  /** Distance across the fabric from the parent round, mm. */
  step: number;
  /** Growth compared to a flat circle (1 = flat). Undefined for start rounds. */
  growth?: number;
}

/**
 * Growth values that read as each shape. The one set of cut-offs: the 3D
 * verdicts use them too, through growth = cos(angle of the fabric).
 */
export const GROWTH_BANDS = [
  { max: -0.15, label: "curls in" },
  { max: 0.2, label: "wall" },
  { max: 0.85, label: "cup" },
  { max: 1.15, label: "flat" },
  { max: Infinity, label: "ruffles or corners" },
] as const;

export function growthLabel(growth: number): string {
  return GROWTH_BANDS.find((b) => growth <= b.max)!.label;
}

export function roundProfiles(compiled: CompiledPattern, beads: Map<string, ResolvedBead>): RoundProfile[] {
  const size = (id: number) => beads.get(compiled.beads[id]!.key)!;
  const roundOf = new Map(compiled.rounds.map((r) => [r.round, r]));
  const length = (id: number, round: CompiledRound) =>
    size(id).length * TENSION[round.tension].squeeze + TENSION[round.tension].slack;
  const meanDiameter = (ids: number[]) => ids.reduce((s, id) => s + size(id).outerDiameter, 0) / ids.length;

  const out = new Map<number, RoundProfile>();
  const isTube = compiled.pattern.start.kind === "tube";
  for (const round of compiled.rounds) {
    if (round.stitches.length === 0) {
      // A start ring is one row. A tube's two rounds share it, offset by half a bead.
      const ring = isTube ? [...compiled.rounds[0]!.beads, ...compiled.rounds[1]!.beads] : round.beads;
      const rowLength = ring.reduce((s, id) => s + length(id, round), 0);
      const parent = isTube && round.round === 2 ? 1 : undefined;
      const step = parent ? meanDiameter(ring) / 2 : 0;
      out.set(round.round, { round: round.round, parent, rowLength, step });
      continue;
    }
    const parentRound = roundOf.get(compiled.beads[round.upBeads[0]!]!.round)!;
    const ups = round.upBeads.reduce((s, id) => s + length(id, parentRound), 0);
    const rowLength = round.beads.reduce((s, id) => s + length(id, round), 0) + ups;
    const step = (meanDiameter(round.beads) + meanDiameter(parentRound.beads)) / 4;
    out.set(round.round, { round: round.round, parent: parentRound.round, rowLength, step });
  }

  // Growth over two rounds where there are two to measure across, else one.
  for (const profile of out.values()) {
    if (profile.parent === undefined || roundOf.get(profile.round)!.stitches.length === 0) continue;
    const parent = out.get(profile.parent)!;
    const grand = parent.parent === undefined ? undefined : out.get(parent.parent);
    const [from, distance] = grand ? [grand, profile.step + parent.step] : [parent, profile.step];
    profile.growth = (profile.rowLength - from.rowLength) / (2 * Math.PI * distance);
  }
  return compiled.rounds.map((r) => out.get(r.round)!);
}
