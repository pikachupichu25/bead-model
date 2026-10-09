// The expected 3D shape of a pattern: every bead's center and hole direction.
// See docs/shape-model.md.
//
// 1. Start from the shape the bead counts predict (profile.ts): each round a
//    ring at the angles of the 2D diagram, rising or spreading out by how
//    much its row grows.
// 2. Relax: repeatedly move pairs of touching beads to their contact distance
//    (contacts.ts), and push apart beads that overlap. Rows with too many
//    beads have nowhere to go but out of the plane, so they ruffle; rows with
//    too few pull the piece into a cup.
// 3. Measure what each round did: how far out and how far up it moved from
//    the round it was worked into, and how wavy it is.
//
// The result is deterministic: the same pattern always gives the same shape.

import type { ResolvedBead } from "../catalog/catalog.js";
import { layoutPattern } from "../diagram/layout.js";
import type { CompiledPattern, CompiledRound } from "../pattern/compile.js";
import { buildContacts, type Contacts, type Link } from "./contacts.js";
import { roundProfiles, type RoundProfile } from "./profile.js";

export type Vec3 = [number, number, number];

export type Verdict = "start" | "flat" | "cup" | "wall" | "curls in" | "wavy";

export interface RoundShape extends RoundProfile {
  /** Mean distance of the round's beads from the axis, mm. */
  radius: number;
  /** Mean height along the axis, mm. Front rounds of a tube go up, back rounds down. */
  height: number;
  /** Spread of the beads' heights (standard deviation), mm. Large means wavy. */
  waviness: number;
  /**
   * Angle of the fabric from two rounds down (or the parent round) to this
   * one: 0° spreads
   * straight out, 90° goes straight up, above 90° turns back in. Undefined
   * for start rounds.
   */
  angle?: number;
  verdict: Verdict;
}

export interface Shape {
  /** The beads in the piece, by id: the whole pattern or the beads up to a step. */
  ids: number[];
  position: Map<number, Vec3>;
  /** Unit vector along each bead's hole. */
  axis: Map<number, Vec3>;
  rounds: RoundShape[];
  /** Largest stretch or squash of any thread link, as a fraction of its length. */
  strain: number;
}

export interface ShapeOptions {
  /** Only the beads added up to and including this step (default: all). */
  upToStep?: number;
  iterations?: number;
}

/**
 * A round is wavy (ruffled, or warped like a saddle) when its heights spread
 * by more than this fraction of a bead's diameter, and by more than a tenth
 * of its radius.
 */
const RUFFLE = 0.3;

/** Everything that doesn't change with the step, so stepping through a pattern stays fast. */
export interface ShapeModel {
  compiled: CompiledPattern;
  beads: Map<string, ResolvedBead>;
  contacts: Contacts;
  profiles: RoundProfile[];
  theta: Map<number, number>;
}

export function shapeModel(compiled: CompiledPattern, beads: Map<string, ResolvedBead>): ShapeModel {
  const layout = layoutPattern(compiled, beads);
  return {
    compiled,
    beads,
    contacts: buildContacts(compiled, beads),
    profiles: roundProfiles(compiled, beads),
    theta: new Map(layout.beads.map((b) => [b.id, b.theta])),
  };
}

export function buildShape(model: ShapeModel, options: ShapeOptions = {}): Shape {
  const { compiled, beads, contacts, profiles, theta } = model;
  const lastStep = options.upToStep ?? compiled.steps.length - 1;
  const ids = compiled.beads.filter((b) => b.step <= lastStep).map((b) => b.id);
  const included = new Set(ids);
  const rounds = compiled.rounds.filter((r) => r.beads.every((id) => included.has(id)));
  const size = (id: number) => beads.get(compiled.beads[id]!.key)!;
  const profileOf = new Map(profiles.map((p) => [p.round, p]));
  const edgeSign = new Map(compiled.rounds.map((r) => [r.round, r.edge === "back" ? -1 : 1]));

  // 1. Starting guess: walk the profile out from the start ring.
  const ring = new Map<number, { radius: number; height: number }>();
  for (const round of rounds) {
    const p = profileOf.get(round.round)!;
    if (p.parent === undefined) {
      ring.set(round.round, { radius: p.rowLength / (2 * Math.PI), height: 0 });
      continue;
    }
    const from = ring.get(p.parent)!;
    const slope = Math.max(-1, Math.min(1, p.growth ?? 0));
    ring.set(round.round, {
      radius: Math.max(from.radius + slope * p.step, p.step),
      height: from.height + edgeSign.get(round.round)! * p.step * Math.sqrt(1 - slope * slope),
    });
  }
  const random = seeded(compiled.beads.length);
  const pos = new Map<number, Vec3>();
  for (const round of rounds) {
    const { radius, height } = ring.get(round.round)!;
    for (const id of round.beads) {
      const t = theta.get(id)!;
      // A little noise, so rows with too many beads can buckle out of the plane.
      const jitter = 0.05 * size(id).outerDiameter * (random() - 0.5);
      pos.set(id, [radius * Math.cos(t), radius * Math.sin(t), height + jitter]);
    }
  }

  // 2. Relax.
  const links = contacts.links.filter((l) => included.has(l.a) && included.has(l.b));
  const reach = new Map(ids.map((id) => [id, (0.95 * Math.min(size(id).outerDiameter, size(id).length)) / 2]));
  const iterations = options.iterations ?? 600;
  for (let i = 0; i < iterations; i++) {
    for (const link of links) satisfy(pos, link);
    if (i % 3 === 0) separate(pos, ids, reach);
  }

  // 3. Turn the piece so its axis points up, then measure.
  const measured = frameAndMeasure(model, rounds, pos);
  const axis = new Map(ids.map((id) => [id, holeAxis(compiled, pos, id)]));
  const strain = Math.max(
    0,
    ...links
      .filter((l) => l.kind === "thread")
      .map((l) => Math.abs(distance(pos.get(l.a)!, pos.get(l.b)!) - l.rest) / l.rest),
  );

  return { ids, position: pos, axis, rounds: measured, strain };
}

/**
 * Turns a solved piece (in place) so the start ring's center is at the origin
 * and the piece's axis along z, then measures each round. Hole directions in
 * `axes`, if given, are turned with it. Shared by both 3D models.
 */
export function frameAndMeasure(
  model: ShapeModel,
  rounds: CompiledRound[],
  pos: Map<number, Vec3>,
  axes?: Map<number, Vec3>,
): RoundShape[] {
  const { compiled, beads, profiles } = model;
  const size = (id: number) => beads.get(compiled.beads[id]!.key)!;
  const profileOf = new Map(profiles.map((p) => [p.round, p]));
  const edgeSign = new Map(compiled.rounds.map((r) => [r.round, r.edge === "back" ? -1 : 1]));

  const frame = startFrame(compiled, rounds, pos);
  const origin = frame([0, 0, 0]);
  for (const id of pos.keys()) pos.set(id, frame(pos.get(id)!));
  if (axes) for (const id of axes.keys()) axes.set(id, sub(frame(axes.get(id)!), origin));

  const measured = new Map<number, RoundShape>();
  for (const round of rounds) {
    const p = profileOf.get(round.round)!;
    const radii = round.beads.map((id) => Math.hypot(pos.get(id)![0], pos.get(id)![1]));
    const heights = round.beads.map((id) => pos.get(id)![2]);
    const shape: RoundShape = {
      ...p,
      radius: mean(radii),
      height: mean(heights),
      waviness: Math.sqrt(mean(heights.map((h) => (h - mean(heights)) ** 2))),
      verdict: "start",
    };
    const parent = p.parent === undefined ? undefined : measured.get(p.parent);
    if (parent && round.stitches.length > 0) {
      // Over two rounds where it can, like the growth.
      const from = (parent.parent === undefined ? undefined : measured.get(parent.parent)) ?? parent;
      const rise = (shape.height - from.height) * edgeSign.get(round.round)!;
      shape.angle = (Math.atan2(Math.abs(rise), shape.radius - from.radius) * 180) / Math.PI;
      const diameter = mean(round.beads.map((id) => size(id).outerDiameter));
      shape.verdict =
        shape.waviness > Math.max(RUFFLE * diameter, 0.1 * shape.radius)
          ? "wavy"
          : shape.angle < 25
            ? "flat"
            : shape.angle < 65
              ? "cup"
              : shape.angle < 115
                ? "wall"
                : "curls in";
    }
    measured.set(round.round, shape);
  }

  return rounds.map((r) => measured.get(r.round)!);
}

/** Moves both beads of a link along the line between them, toward its rest length. */
function satisfy(pos: Map<number, Vec3>, link: Link): void {
  const a = pos.get(link.a)!;
  const b = pos.get(link.b)!;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const dz = b[2] - a[2];
  const len = Math.hypot(dx, dy, dz) || 1e-9;
  const k = ((len - link.rest) / len) * link.stiffness * 0.5;
  a[0] += dx * k;
  a[1] += dy * k;
  a[2] += dz * k;
  b[0] -= dx * k;
  b[1] -= dy * k;
  b[2] -= dz * k;
}

/** Pushes apart any two beads closer than their reach allows, using a grid so it stays fast. */
function separate(pos: Map<number, Vec3>, ids: number[], reach: Map<number, number>): void {
  const cell = 2 * Math.max(...reach.values());
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) => `${x},${y},${z}`;
  for (const id of ids) {
    const p = pos.get(id)!;
    const k = key(Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell));
    const list = grid.get(k);
    if (list) list.push(id);
    else grid.set(k, [id]);
  }
  for (const id of ids) {
    const p = pos.get(id)!;
    const [cx, cy, cz] = [Math.floor(p[0] / cell), Math.floor(p[1] / cell), Math.floor(p[2] / cell)];
    for (let x = cx - 1; x <= cx + 1; x++)
      for (let y = cy - 1; y <= cy + 1; y++)
        for (let z = cz - 1; z <= cz + 1; z++) {
          for (const other of grid.get(key(x, y, z)) ?? []) {
            if (other <= id) continue;
            const min = reach.get(id)! + reach.get(other)!;
            const q = pos.get(other)!;
            const d = distance(p, q);
            if (d >= min) continue;
            satisfy(pos, { a: id, b: other, kind: "thread", rest: min, stiffness: 1 });
          }
        }
  }
}

/**
 * A transform that puts the start ring's center at the origin and the piece's
 * axis along z, keeping +z on the side the front rounds were built toward.
 *
 * The axis is the sum of every round's normal. Each round's normal is as long
 * as twice the area it encloses, so big rounds count for more. A small start
 * ring can sit tilted to the rest of the piece (a 4-bead ring does), and
 * taking the axis from it alone would tip a straight tube over.
 */
function startFrame(
  compiled: CompiledPattern,
  rounds: CompiledRound[],
  pos: Map<number, Vec3>,
): (p: Vec3) => Vec3 {
  const isTube = compiled.pattern.start.kind === "tube";
  const ring = isTube
    ? [...compiled.rounds[0]!.beads, ...compiled.rounds[1]!.beads].sort((a, b) => a - b)
    : compiled.rounds[0]!.beads;
  const points = ring.map((id) => pos.get(id)!);
  const center = points.reduce<Vec3>((s, p) => [s[0] + p[0], s[1] + p[1], s[2] + p[2]], [0, 0, 0]).map(
    (v) => v / points.length,
  ) as Vec3;
  // A tube start's two rounds are one ring; the rest go round in pickup order.
  // Rounds can be stitched either way round, so each normal is turned to +z
  // (the way the starting guess built the piece) before adding.
  const rings = [ring, ...rounds.filter((r) => r.stitches.length > 0).map((r) => r.beads)];
  let n = rings.reduce<Vec3>((sum, ids) => {
    const m = newell(ids.map((id) => pos.get(id)!));
    return add(sum, m[2] < 0 ? scale(m, -1) : m);
  }, [0, 0, 0]);
  n = normalize(n);
  if (Math.hypot(...n) === 0) n = [0, 0, 1];
  // An orthonormal frame (u, v, n) with u as close to the old x axis as it can be.
  let u: Vec3 = sub([1, 0, 0], scale(n, n[0]));
  if (Math.hypot(...u) < 1e-6) u = sub([0, 1, 0], scale(n, n[1]));
  u = normalize(u);
  const v = cross(n, u);
  return (p) => {
    const d = sub(p, center);
    return [dot(d, u), dot(d, v), dot(d, n)];
  };
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

function seeded(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const scale = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const distance = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
/** Newell's method: the normal of a closed polygon, as long as twice its area. */
function newell(points: Vec3[]): Vec3 {
  let n: Vec3 = [0, 0, 0];
  points.forEach((p, i) => {
    const q = points[(i + 1) % points.length]!;
    n = [
      n[0] + (p[1] - q[1]) * (p[2] + q[2]),
      n[1] + (p[2] - q[2]) * (p[0] + q[0]),
      n[2] + (p[0] - q[0]) * (p[1] + q[1]),
    ];
  });
  return n;
}
function normalize(a: Vec3): Vec3 {
  const len = Math.hypot(...a);
  return len === 0 ? a : scale(a, 1 / len);
}
