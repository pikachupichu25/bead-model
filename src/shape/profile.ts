// The shape of a pattern from its bead counts: one ring per round, how far
// out and how far up it sits, and how much it ruffles.
// See docs/shape-model.md.
//
// Going once round a worked round, the thread passes every new bead and every
// up bead once, so the row the round lies in is
//     C = Σ length of the new beads + Σ length of the up beads.
// Each round sits about half a bead diameter (Δs) further across the fabric.
//
// A flat piece with k fixed corners has perimeter P(k) × its inradius, where
// P(k) = 2k tan(π/k) (P(3) = 6√3, P(4) = 8, and P → 2π for a circle). So:
//   - radius:  r = C / P
//   - growth:  g = Δr / distance from the round two below (the rows of
//              peyote interlock in pairs of rounds): the cosine of the
//              fabric's angle, 1 flat, 0 a straight wall, below 0 curling in
//   - height:  Δz = ±Δs √(1 − g²) from the round below (Pythagoras)
//   - ruffles: if Δr > distance there is more row than fits flat. The ring
//              goes out by the distance, and the extra length E = C/(P r) − 1
//              makes m waves of height A = (2r/m)√E (a wave z = A sin mθ adds
//              about m²A²/4r² to the length).

import type { ResolvedBead } from "../catalog/catalog.js";
import type { CompiledPattern } from "../pattern/compile.js";
import type { Tension } from "../pattern/load.js";

/**
 * How the thread tension changes the space a bead takes up along the row.
 * `slack` is thread showing between two beads; `squeeze` scales a bead's
 * length, as tight thread tilts beads and nests them into each other. These
 * are first guesses, to be fitted to photos of real pieces.
 */
export const TENSION: Record<Tension, { slack: number; squeeze: number }> = {
  loose: { slack: 0.25, squeeze: 1 },
  normal: { slack: 0.08, squeeze: 1 },
  tight: { slack: 0, squeeze: 0.9 },
};

export type Verdict = "start" | "curls in" | "wall" | "cup" | "flat" | "ruffles";

export interface RoundProfile {
  round: number;
  /** The round whose up beads this round is worked into (undefined for start rounds). */
  parent?: number;
  /** Length of the row through this round's beads, mm. */
  rowLength: number;
  /** Distance across the fabric from the parent round, mm. */
  step: number;
  /** Distance of the ring from the axis (the inradius, for a piece with corners), mm. */
  radius: number;
  /** Height along the axis, mm. Front rounds of a tube go up, back rounds down. */
  height: number;
  /** Growth compared to a flat piece (1 = flat), the cosine of the fabric's angle. Undefined for start rounds. */
  growth?: number;
  /** Angle of the fabric: 0° spreads straight out, 90° goes straight up, above 90° turns back in. */
  angle?: number;
  /** Height of the ruffles, mm (0 when the row fits). */
  ruffle: number;
  /** Number of ruffle waves round the ring. */
  waves: number;
  verdict: Verdict;
}

export interface Profile {
  /** Number of fixed corners (increase points in the same place every round), or undefined for a circle. */
  corners?: number;
  rounds: RoundProfile[];
}

/** Growth values that read as each shape. */
export const GROWTH_BANDS = [
  { max: -0.15, label: "curls in" },
  { max: 0.2, label: "wall" },
  { max: 0.85, label: "cup" },
  { max: 1.15, label: "flat" },
  { max: Infinity, label: "ruffles" },
] as const satisfies readonly { max: number; label: Verdict }[];

export function growthLabel(growth: number): Verdict {
  return GROWTH_BANDS.find((b) => growth <= b.max)!.label;
}

/** Perimeter of a flat piece per unit of inradius: 2π for a circle, 2k tan(π/k) with k corners. */
export function perimeterFactor(corners?: number): number {
  return corners === undefined ? 2 * Math.PI : 2 * corners * Math.tan(Math.PI / corners);
}

/**
 * Fixed corners: when every worked round has the same number (3 or more) of
 * gaps with more than one bead, the increases stay in place and the piece
 * keeps that many corners. Otherwise the increases move round and it stays round.
 */
export function cornerCount(compiled: CompiledPattern): number | undefined {
  const counts = compiled.rounds.filter((r) => r.stitches.length > 0).map((r) => increasePoints(compiled, r.beads));
  const k = counts[0];
  return k !== undefined && k >= 3 && counts.every((c) => c === k) ? k : undefined;
}

export function roundProfiles(compiled: CompiledPattern, beads: Map<string, ResolvedBead>): Profile {
  const size = (id: number) => beads.get(compiled.beads[id]!.key)!;
  const roundOf = new Map(compiled.rounds.map((r) => [r.round, r]));
  const length = (id: number, tension: Tension) =>
    size(id).length * TENSION[tension].squeeze + TENSION[tension].slack;
  const meanDiameter = (ids: number[]) => ids.reduce((s, id) => s + size(id).outerDiameter, 0) / ids.length;
  const corners = cornerCount(compiled);
  const P = perimeterFactor(corners);
  const isTube = compiled.pattern.start.kind === "tube";

  const out = new Map<number, RoundProfile>();
  let waves = corners ?? 0;
  for (const round of compiled.rounds) {
    const sign = round.edge === "back" ? -1 : 1;
    if (round.stitches.length === 0) {
      // A start ring is one row. A tube's two rounds share it, offset by half a bead.
      const ring = isTube ? [...compiled.rounds[0]!.beads, ...compiled.rounds[1]!.beads] : round.beads;
      const rowLength = ring.reduce((s, id) => s + length(id, round.tension), 0);
      const parent = isTube && round.round === 2 ? 1 : undefined;
      const step = parent ? meanDiameter(ring) / 2 : 0;
      out.set(round.round, {
        round: round.round,
        parent,
        rowLength,
        step,
        radius: rowLength / P,
        height: sign * step,
        ruffle: 0,
        waves: 0,
        verdict: "start",
      });
      continue;
    }

    const parentRound = roundOf.get(compiled.beads[round.upBeads[0]!]!.round)!;
    const ups = round.upBeads.reduce((s, id) => s + length(id, parentRound.tension), 0);
    const rowLength = round.beads.reduce((s, id) => s + length(id, round.tension), 0) + ups;
    const step = (meanDiameter(round.beads) + meanDiameter(parentRound.beads)) / 4;

    // Growth from two rounds down where there is one, else from the parent.
    // The height steps up from the parent at that slope, so odd and even
    // rounds stay on one surface.
    const parent = out.get(parentRound.round)!;
    const grand = parent.parent === undefined ? undefined : out.get(parent.parent);
    const [from, distance] = grand ? [grand, step + parent.step] : [parent, step];
    const growth = (rowLength / P - from.radius) / distance;
    const slope = Math.max(-1, Math.min(1, growth));
    const radius = from.radius + slope * distance;
    const height = parent.height + sign * step * Math.sqrt(1 - slope * slope);

    // Waves sit at the increase points; a round with none keeps the last count.
    waves = Math.max(2, increasePoints(compiled, round.beads) || waves);
    const ruffle = growth > 1 ? ((2 * radius) / waves) * Math.sqrt(rowLength / (P * radius) - 1) : 0;

    out.set(round.round, {
      round: round.round,
      parent: parentRound.round,
      rowLength,
      step,
      radius,
      height,
      growth,
      angle: (Math.acos(slope) * 180) / Math.PI,
      ruffle,
      waves,
      verdict: growthLabel(growth),
    });
  }
  return { corners, rounds: compiled.rounds.map((r) => out.get(r.round)!) };
}

/** Number of gaps in a round with more than one bead. */
function increasePoints(compiled: CompiledPattern, ids: number[]): number {
  return ids.filter((id) => compiled.beads[id]!.slot === 0 && compiled.beads[id]!.slotsInGap > 1).length;
}
