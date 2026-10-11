// The expected 3D shape of a pattern: every bead's center and hole direction.
// See docs/shape-model.md.
//
// Each round is a ring from its profile (profile.ts): its radius and height,
// with the beads at the angles of the 2D diagram. A piece with fixed corners
// is a polygon instead of a circle, and a round with more row than fits flat
// ruffles in waves peaking at its increase points.
//
// The result is deterministic, and a round's place doesn't depend on the
// rounds after it, so stepping through a pattern only adds beads.

import type { ResolvedBead } from "../catalog/catalog.js";
import { layoutPattern } from "../diagram/layout.js";
import type { CompiledPattern } from "../pattern/compile.js";
import { type Profile, type RoundProfile, roundProfiles } from "./profile.js";

export type { Verdict } from "./profile.js";
export type Vec3 = [number, number, number];

export interface Shape {
  /** The beads in the piece, by id: the whole pattern or the beads up to a step. */
  ids: number[];
  position: Map<number, Vec3>;
  /** Unit vector along each bead's hole. */
  axis: Map<number, Vec3>;
  /** The rounds in the piece. */
  rounds: RoundProfile[];
}

export interface ShapeOptions {
  /** Only the beads added up to and including this step (default: all). */
  upToStep?: number;
}

/** Everything that doesn't change with the step, so stepping through a pattern stays fast. */
export interface ShapeModel {
  compiled: CompiledPattern;
  beads: Map<string, ResolvedBead>;
  profile: Profile;
  theta: Map<number, number>;
}

export function shapeModel(compiled: CompiledPattern, beads: Map<string, ResolvedBead>): ShapeModel {
  const layout = layoutPattern(compiled, beads);
  return {
    compiled,
    beads,
    profile: roundProfiles(compiled, beads),
    theta: new Map(layout.beads.map((b) => [b.id, b.theta])),
  };
}

export function buildShape(model: ShapeModel, options: ShapeOptions = {}): Shape {
  const { compiled, profile, theta } = model;
  const lastStep = options.upToStep ?? compiled.steps.length - 1;
  const ids = compiled.beads.filter((b) => b.step <= lastStep).map((b) => b.id);
  const included = new Set(ids);
  const rounds = compiled.rounds.filter((r) => r.beads.every((id) => included.has(id)));
  const profileOf = new Map(profile.rounds.map((p) => [p.round, p]));
  const k = profile.corners;

  // Where each round's corners and ruffle peaks are: its first increase, or
  // the last one before it. Rounds before the first increase take the first.
  const phase = new Map<number, number>();
  let last: number | undefined;
  for (const round of compiled.rounds) {
    const first = round.beads.find((id) => compiled.beads[id]!.slotsInGap > 1);
    if (first !== undefined) {
      const gap = round.beads.filter((id) => compiled.beads[id]!.gap === compiled.beads[first]!.gap);
      last = meanAngle(gap.map((id) => theta.get(id)!));
    }
    if (last !== undefined) phase.set(round.round, last);
  }
  const firstPhase = phase.values().next().value ?? 0;

  const position = new Map<number, Vec3>();
  for (const round of rounds) {
    const p = profileOf.get(round.round)!;
    const t0 = phase.get(round.round) ?? firstPhase;
    for (const id of round.beads) {
      const t = theta.get(id)!;
      // Out to the polygon's side: the inradius over the cosine of the angle
      // from the nearest side's middle.
      const r = k === undefined ? p.radius : p.radius / Math.cos(mod(t - t0, (2 * Math.PI) / k) - Math.PI / k);
      const z = p.height + p.ruffle * Math.cos(p.waves * (t - t0));
      position.set(id, [r * Math.cos(t), r * Math.sin(t), z]);
    }
  }

  const axis = new Map(ids.map((id) => [id, holeAxis(compiled, position, id)]));
  return { ids, position, axis, rounds: rounds.map((r) => profileOf.get(r.round)!) };
}

/** Direction of a bead's hole: from the bead before it on the thread to the one after. */
function holeAxis(compiled: CompiledPattern, pos: Map<number, Vec3>, id: number): Vec3 {
  const bead = compiled.beads[id]!;
  let before: number;
  let after: number;
  if (bead.between) {
    before = bead.slot > 0 ? id - 1 : bead.between[0];
    after = bead.slot < bead.slotsInGap - 1 ? id + 1 : bead.between[1];
  } else {
    // A start bead: its neighbours in stringing order round the ring.
    const ring =
      compiled.pattern.start.kind === "tube"
        ? [...compiled.rounds[0]!.beads, ...compiled.rounds[1]!.beads].sort((a, b) => a - b)
        : compiled.rounds[0]!.beads;
    const i = ring.indexOf(id);
    before = ring[(i - 1 + ring.length) % ring.length]!;
    after = ring[(i + 1) % ring.length]!;
  }
  const p = pos.get(id)!;
  const a = pos.get(before);
  const b = pos.get(after);
  const d = a && b && before !== after ? sub(b, a) : [0, 0, 0];
  if (Math.hypot(...d) > 1e-6) return normalize(d as Vec3);
  // Fallback: along the ring.
  return normalize([-p[1], p[0], 0]);
}

function meanAngle(angles: number[]): number {
  return Math.atan2(
    angles.reduce((s, a) => s + Math.sin(a), 0),
    angles.reduce((s, a) => s + Math.cos(a), 0),
  );
}

const mod = (a: number, n: number) => ((a % n) + n) % n;
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
function normalize(a: Vec3): Vec3 {
  const len = Math.hypot(...a);
  return len === 0 ? a : [a[0] / len, a[1] / len, a[2] / len];
}
