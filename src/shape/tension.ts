// The thread-tension model of the 3D shape. See docs/physics-model-proposal.md.
//
// The piece settles where the tensioned thread is as short as it can be,
// without any two beads overlapping:
//
//     minimize   Σ_k max(0, ℓ_k − δ_k)  +  Σ_ends κ (1 − cos θ)  +  Σ (k/2)·overlap²
//
// - Beads are solid bodies with a center and a hole direction. Each is a
//   rounded cylinder: a core cylinder with a sphere swept over it. Contacts
//   are a stiff penalty on overlap, measured from a ring or two of probe
//   spheres in one bead to the exact surface of the other.
// - The thread is the path from thread.ts. Between two passes it runs straight
//   from the hole face it leaves to the hole face it enters (free thread k, of
//   length ℓ_k). It only pulls, and only once it is longer than its slack δ.
// - The hole is wider than the thread, so the thread can leave a hole off its
//   center, up to the clearance. Inside the hole it runs straight from where
//   it enters to where it leaves, and that counts as thread too.
// - Where the thread bends at a hole face it resists a little (κ, the bending
//   length of the thread): this gives the fabric its bending stiffness.
//
// Tension is the same all along the thread, so only each thread's length
// beyond its slack counts, however long it has to be.
//
// The piece is built step by step, as it is stitched. Each new bead goes in
// its gap, then everything built so far settles: L-BFGS on the energy, so
// every step lowers it. No axis, profile or symmetry is assumed. The springs
// model (shape.ts) stays alongside.

import type { ResolvedBead } from "../catalog/catalog.js";
import type { Tension } from "../pattern/load.js";
import { threadPasses } from "../pattern/thread.js";
import { frameAndMeasure, type Shape, type ShapeModel, type Vec3 } from "./shape.js";

/**
 * Per tension level: `slack`, the thread allowed to stay loose between two
 * beads (mm), and `bendLength`, the thread's bending length √(B/T) (mm). Tight
 * thread has a short bending length, so the beads pull into their tightest
 * packing. First guesses, to be fitted to photos of real pieces.
 */
export const THREAD_TENSION: Record<Tension, { slack: number; bendLength: number }> = {
  loose: { slack: 0.25, bendLength: 0.6 },
  normal: { slack: 0.08, bendLength: 0.25 },
  tight: { slack: 0, bendLength: 0.05 },
};

/** Thread diameter (mm) when the pattern doesn't give one: size D Nymo is about 0.2, 6 lb FireLine 0.15. */
export const THREAD_DIAMETER = 0.2;

/** Rounding of a cylinder bead's edges, as a fraction of its smaller size. */
const EDGE_ROUNDING = 0.12;

/** Solver settings: the most L-BFGS steps when settling each step. */
export const SOLVER = { iterations: 400 };

/** Size of the core and rounding of a bead (mm), from its catalog sizes. */
export interface BeadBody {
  /** Core cylinder: radius and half-length. A round bead's core is a flat disk. */
  coreRadius: number;
  coreHalf: number;
  /** Sphere swept over the core. */
  rounding: number;
  length: number;
  diameter: number;
  hole: number;
  /** Radius of a sphere round the center that holds the whole bead. */
  bound: number;
  /**
   * Spheres that fill out the bead, for contacts: each at `along` the hole
   * and `out` from it, at `angle` round it. Their union is close to the
   * rounded cylinder, and smooth, so the contact energy has a clean gradient.
   */
  probes: { along: number; out: number; angle: number }[];
  probeRadius: number;
}

export function beadBody(bead: ResolvedBead): BeadBody {
  const L = bead.length;
  const D = bead.outerDiameter;
  const roundish = bead.shape === "round" || bead.shape === "demi";
  const rounding = roundish ? Math.min(L, D) / 2 : EDGE_ROUNDING * Math.min(L, D);
  // A round bead: one ring of spheres as long as the bead. A cylinder: two
  // rings of smaller spheres, so its ends are nearly flat.
  const probeRadius = roundish ? Math.min(L, D) / 2 : 0.77 * (Math.min(L, D) / 2);
  const rings = roundish || L / 2 - probeRadius < 0.02 ? [0] : [-(L / 2 - probeRadius), L / 2 - probeRadius];
  const out = Math.max(D / 2 - probeRadius, 0);
  const count = out < 0.05 ? 1 : 8;
  const probes = rings.flatMap((along, r) =>
    Array.from({ length: count }, (_, k) => ({ along, out, angle: (2 * Math.PI * (k + r / 2)) / count })),
  );
  return {
    coreRadius: Math.max(D / 2 - rounding, 0),
    coreHalf: Math.max(L / 2 - rounding, 0),
    rounding,
    length: L,
    diameter: D,
    hole: bead.hole ?? 0.45 * D,
    bound: Math.hypot(D / 2, L / 2),
    probes,
    probeRadius,
  };
}

/** One pass of the thread through a bead: +1 along the bead's hole direction, −1 against it. */
interface Pass {
  bead: number;
  sign: 1 | -1;
}

/** Free thread between two passes. */
interface Segment {
  from: Pass;
  to: Pass;
  slack: number;
  bend: number;
  /** The step whose thread this is. Each step's thread is pulled as one. */
  step: number;
}

/** The piece as built so far: everything settling needs, kept between steps. */
interface Build {
  model: ShapeModel;
  body: BeadBody[];
  x: Vec3[];
  a: Vec3[];
  placed: number[];
  passes: Pass[];
  segments: Segment[];
  passCount: number[];
  /** Thread diameter, mm. */
  thread: number;
  random: () => number;
  /** Solved shape after each step. */
  shapes: Shape[];
}

const builds = new WeakMap<ShapeModel, Build>();

export interface TensionShapeOptions {
  /** Only the beads added up to and including this step (default: all). */
  upToStep?: number;
}

/**
 * The shape of the piece as built up to a step. Steps are built in order and
 * remembered, so stepping through a pattern only solves each step once.
 */
export function buildTensionShape(model: ShapeModel, options: TensionShapeOptions = {}): Shape {
  const lastStep = options.upToStep ?? model.compiled.steps.length - 1;
  let build = builds.get(model);
  if (!build) builds.set(model, (build = startBuild(model)));
  while (build.shapes.length <= lastStep) addStep(build, build.shapes.length);
  return build.shapes[lastStep]!;
}

function startBuild(model: ShapeModel): Build {
  const { compiled, beads } = model;
  const body = compiled.beads.map((b) => beadBody(beads.get(b.key)!));
  return {
    model,
    body,
    x: compiled.beads.map(() => [0, 0, 0]),
    a: compiled.beads.map(() => [1, 0, 0]),
    placed: [],
    passes: [],
    segments: [],
    passCount: compiled.beads.map(() => 0),
    thread: compiled.pattern.threadDiameter ?? THREAD_DIAMETER,
    random: seeded(compiled.beads.length),
    shapes: [],
  };
}

// ---- Adding a step ----

function addStep(build: Build, stepIndex: number): void {
  const { model, x, a, body } = build;
  const { compiled } = model;
  const step = compiled.steps[stepIndex]!;
  const tensionOf = (id: number) =>
    THREAD_TENSION[compiled.rounds.find((r) => r.round === compiled.beads[id]!.round)!.tension];

  if (stepIndex === 0) placeStart(build, step.beads);
  else for (const id of step.beads) placeBead(build, id, step.beads[0]!);
  build.placed.push(...step.beads);

  // The thread of this step carries on from where the last step ended.
  const path = threadPasses(compiled, stepIndex);
  const last = build.passes.at(-1);
  if (last && path[0] === last.bead) path.shift();
  const start = build.passes.length;
  path.forEach((bead, i) => {
    const prev = i > 0 ? path[i - 1]! : last?.bead;
    const next = path[i + 1];
    // Which way the thread goes through: the way it travels from the bead
    // before to the bead after. A new bead's hole direction was set along it.
    const travel = sub(next !== undefined ? x[next]! : x[bead]!, prev !== undefined ? x[prev]! : x[bead]!);
    const sign: 1 | -1 = build.passCount[bead] === 0 || dot(travel, a[bead]!) >= 0 ? 1 : -1;
    build.passes.push({ bead, sign });
    build.passCount[bead]!++;
  });
  for (let k = Math.max(start, 1); k < build.passes.length; k++) {
    const from = build.passes[k - 1]!;
    const to = build.passes[k]!;
    if (from.bead === to.bead) continue;
    // Moving to the other edge of a tube, the thread is woven through the
    // beads between: it doesn't pull straight across.
    if (k === start && !model.contacts.neighbours.get(from.bead)?.has(to.bead)) continue;
    // The thread between two beads takes the tension of the later one.
    const t = tensionOf(Math.max(from.bead, to.bead));
    build.segments.push({ from, to, slack: t.slack, bend: t.bendLength, step: stepIndex });
  }

  // A tube start is a loose loop until the next round pulls it into a band:
  // settling it alone would flatten the zigzag the next round needs.
  const looseLoop = stepIndex === 0 && compiled.pattern.start.kind === "tube";
  if (!looseLoop) settle(build, SOLVER.iterations);

  // Hand out a copy: settling the next step moves the beads again.
  const ids = [...build.placed].sort((p, q) => p - q);
  const position = new Map(ids.map((id) => [id, [...x[id]!] as Vec3]));
  const axis = new Map(ids.map((id) => [id, normalize(a[id]!)]));
  const included = new Set(ids);
  const rounds = compiled.rounds.filter((r) => r.beads.every((id) => included.has(id)));
  let measured = frameAndMeasure(model, rounds, position, axis);
  // Nothing in the physics says which way is up: turn the piece over so its
  // front rounds rise from the start, as the springs model shows it.
  const edgeOf = new Map(compiled.rounds.map((r) => [r.round, r.edge]));
  const lastFront = measured.filter((r) => r.parent !== undefined && edgeOf.get(r.round) !== "back").at(-1);
  if (lastFront && lastFront.height < 0) {
    for (const map of [position, axis]) for (const [id, v] of map) map.set(id, [v[0], -v[1], -v[2]]);
    measured = frameAndMeasure(model, rounds, position, axis);
  }
  // How much thread shows beyond its slack anywhere, as a fraction of a bead length.
  let strain = 0;
  for (const s of build.segments) {
    const { length } = threadEnds(build, s);
    strain = Math.max(strain, (length - s.slack) / body[s.from.bead]!.length);
  }
  build.shapes.push({ ids, position, axis, rounds: measured, strain: Math.max(strain, 0) });
}

/**
 * The start ring: beads in stringing order round a circle, holes along it. A
 * tube start's beads go alternately low (round 1) and high (round 2), the way
 * the next round will pull them.
 */
function placeStart(build: Build, ids: number[]): void {
  const { model, body, x, a } = build;
  const { compiled } = model;
  const ring = [...ids].sort((p, q) => p - q);
  const tension = THREAD_TENSION[compiled.rounds[0]!.tension];
  const circumference = ring.reduce((s, id) => s + body[id]!.length + tension.slack, 0);
  const radius = Math.max(circumference / (2 * Math.PI), 0.6 * Math.max(...ring.map((id) => body[id]!.diameter)));
  const tube = compiled.pattern.start.kind === "tube";
  ring.forEach((id, i) => {
    const t = (2 * Math.PI * (i + 0.5)) / ring.length;
    const lift = tube ? (compiled.beads[id]!.round === 1 ? -1 : 1) * (body[id]!.diameter / 4) : 0;
    x[id] = [radius * Math.cos(t), radius * Math.sin(t), lift + jitter(build, id)];
    a[id] = [-Math.sin(t), Math.cos(t), 0];
  });
}

/**
 * A new bead goes where the thread puts it: in the gap between up beads u
 * and v, with its hole along the thread from u to v.
 *
 * If a bead sits under the gap (the up bead u and v were both stitched
 * round), the new bead rests on it, one bead width further out: that is the
 * peyote column. A pair or more lies end to end, centered over it. Placing
 * it on the line from u to v instead goes wrong where that line cuts across
 * the bead below, as at the corners of a small start ring.
 *
 * With no bead under the gap, it goes on that line, pushed half a bead out
 * from the middle of u's round.
 */
function placeBead(build: Build, id: number, firstOfStep: number): void {
  const { model, body, x, a } = build;
  const { compiled, contacts } = model;
  const bead = compiled.beads[id]!;
  const [u, v] = bead.between!;
  const across = sub(x[v]!, x[u]!);
  const out = face(build, u, dot(across, a[u]!) >= 0 ? 1 : -1, +1);
  let into = face(build, v, dot(across, a[v]!) >= 0 ? 1 : -1, -1);
  if (u === v) into = face(build, u, dot(across, a[u]!) >= 0 ? 1 : -1, -1);
  let axis = normalize(sub(into, out));
  if (Math.hypot(...axis) === 0 || u === v) axis = normalize(a[u]!);

  const under = [...(contacts.neighbours.get(u) ?? [])].find(
    (w) => w < firstOfStep && w !== v && contacts.neighbours.get(v)?.has(w) && compiled.beads[w]!.round !== compiled.beads[u]!.round,
  );
  const outwardFrom = (from: Vec3, toward: Vec3): Vec3 => {
    let outward = sub(toward, from);
    outward = sub(outward, scale(axis, dot(outward, axis)));
    if (Math.hypot(...outward) < 1e-9) outward = cross(axis, [0, 0, 1]);
    return normalize(outward);
  };

  let p: Vec3;
  let outward: Vec3;
  if (under !== undefined) {
    outward = outwardFrom(x[under]!, scale(add(x[u]!, x[v]!), 0.5));
    const rest = add(x[under]!, scale(outward, (body[under]!.diameter + body[id]!.diameter) / 2));
    // Beads sharing the gap lie end to end, centered over the bead below.
    const shift = (bead.slot - (bead.slotsInGap - 1) / 2) * body[id]!.length;
    p = add(rest, scale(axis, shift));
  } else {
    const onLine = add(out, scale(sub(into, out), (bead.slot + 1) / (bead.slotsInGap + 1)));
    const round = compiled.rounds.find((r) => r.round === compiled.beads[u]!.round)!.beads;
    const middle = scale(round.reduce<Vec3>((s, w) => add(s, x[w]!), [0, 0, 0]), 1 / round.length);
    outward = outwardFrom(middle, onLine);
    p = add(onLine, scale(outward, body[id]!.diameter / 2));
  }
  // The front of the fabric here: outward × the way the thread runs. It is +z
  // on the start ring and stays on the same side all round a round, so when
  // a round has to leave the plane, every bead of it leans the same way: the
  // side the beader works from. Left to the random nudge alone, beads chose
  // up or down one by one, and a closed bottom turned into a slanted wall
  // that later rounds followed (see docs/fix-hole-clearance.md).
  const front = normalize(cross(outward, axis));
  p = add(p, scale(front, FRONT_LEAN * body[id]!.diameter));
  x[id] = [p[0], p[1], p[2] + jitter(build, id)];
  a[id] = axis;
}

/** How far a new bead starts toward the front of the fabric, as a fraction of its diameter. */
const FRONT_LEAN = 0.1;

/** A small, seeded nudge, so rows with too many beads can buckle out of the plane. */
function jitter(build: Build, id: number): number {
  return 0.03 * build.body[id]!.diameter * (build.random() - 0.5);
}

// ---- Settling ----

/** Center of a hole face. `end` +1 is where the thread leaves on that pass, −1 where it enters. */
function face(build: Build, id: number, sign: number, end: number): Vec3 {
  return add(build.x[id]!, scale(build.a[id]!, (sign * end * build.body[id]!.length) / 2));
}

/**
 * Room for the thread to sit off center in a hole's mouth: how far a thread's
 * center can be from the hole's. Threads that pass more than once pack round
 * each other in the hole, so each can still reach close to the wall. (Lining
 * them up along one diameter, as a first version did, left almost no room in
 * start-ring beads and folded small starts that lie flat in real pieces; see
 * docs/fix-hole-clearance.md.)
 */
function clearance(build: Build, id: number): number {
  return Math.max(0, (build.body[id]!.hole - build.thread) / 2);
}

/**
 * Where a free thread leaves one hole and enters the next: each end moves off
 * the hole's center toward the other, as far as the clearance lets it.
 */
function threadEnds(build: Build, s: Segment): { from: Vec3; to: Vec3; length: number } {
  const i = s.from.bead;
  const j = s.to.bead;
  const fi = face(build, i, s.from.sign, +1);
  const fj = face(build, j, s.to.sign, -1);
  const from = add(fi, offCenter(build.a[i]!, sub(fj, fi), clearance(build, i)));
  const to = add(fj, offCenter(build.a[j]!, sub(from, fj), clearance(build, j)));
  return { from, to, length: distance(from, to) };
}

/** The part of `toward` across the hole, at most `room` long. */
function offCenter(axis: Vec3, toward: Vec3, room: number): Vec3 {
  const across = sub(toward, scale(axis, dot(toward, axis)));
  const len = Math.hypot(...across);
  return len <= room ? across : scale(across, room / len);
}

/**
 * Settles the piece: minimizes its energy with L-BFGS (a quasi-Newton method)
 * and a backtracking line search, so every accepted step lowers the energy.
 * The variables are each bead's center and hole direction.
 */
function settle(build: Build, iterations: number): void {
  const { x, a, placed } = build;
  const n = placed.length;
  const z = new Float64Array(6 * n);
  placed.forEach((id, k) => {
    z.set(x[id]!, 6 * k);
    z.set(normalize(a[id]!), 6 * k + 3);
  });
  let pairs = nearPairs(build);
  let pairsAt = Float64Array.from(z);
  const evaluate = (v: Float64Array, grad: Float64Array) => {
    load(build, v);
    return energy(build, pairs, grad);
  };

  const memory: { s: Float64Array; y: Float64Array; rho: number }[] = [];
  let grad = new Float64Array(6 * n);
  let e = evaluate(z, grad);
  for (let it = 0; it < iterations; it++) {
    // Search direction: −H·∇E from the last few steps (two-loop recursion).
    const d = Float64Array.from(grad, (g) => -g);
    const alphas: number[] = [];
    for (let m = memory.length - 1; m >= 0; m--) {
      const { s: sm, y: ym, rho } = memory[m]!;
      const alpha = rho * dotN(sm, d);
      alphas[m] = alpha;
      axpy(d, -alpha, ym);
    }
    if (memory.length > 0) {
      const { s: sm, y: ym } = memory.at(-1)!;
      const gamma = dotN(sm, ym) / dotN(ym, ym);
      for (let i = 0; i < d.length; i++) d[i]! *= gamma;
    } else {
      // First step: move the beads at most 0.05 mm.
      let big = 0;
      for (const v of d) big = Math.max(big, Math.abs(v));
      if (big > 0) for (let i = 0; i < d.length; i++) d[i]! *= 0.05 / big;
    }
    for (let m = 0; m < memory.length; m++) {
      const { s: sm, y: ym, rho } = memory[m]!;
      axpy(d, alphas[m]! - rho * dotN(ym, d), sm);
    }
    let slope = dotN(grad, d);
    if (slope >= 0) {
      // Not downhill: start the memory again from steepest descent.
      memory.length = 0;
      for (let i = 0; i < d.length; i++) d[i] = -grad[i]! * 0.01;
      slope = dotN(grad, d);
    }
    // Never move a bead more than 0.2 mm in one step.
    let big = 0;
    for (let k = 0; k < n; k++) big = Math.max(big, Math.hypot(d[6 * k]!, d[6 * k + 1]!, d[6 * k + 2]!));
    let step = big > 0.2 ? 0.2 / big : 1;

    const next = new Float64Array(6 * n);
    const nextGrad = new Float64Array(6 * n);
    let nextE = Infinity;
    for (let tries = 0; tries < 20; tries++) {
      for (let i = 0; i < next.length; i++) next[i] = z[i]! + step * d[i]!;
      nextE = evaluate(next, nextGrad);
      if (nextE <= e + 1e-4 * step * slope) break;
      step *= 0.5;
    }
    if (!(nextE < e)) {
      if (memory.length === 0) break; // Settled: no downhill step left.
      memory.length = 0;
      load(build, z);
      continue;
    }
    const sk = new Float64Array(6 * n);
    const yk = new Float64Array(6 * n);
    for (let i = 0; i < sk.length; i++) {
      sk[i] = next[i]! - z[i]!;
      yk[i] = nextGrad[i]! - grad[i]!;
    }
    const sy = dotN(sk, yk);
    if (sy > 1e-12) {
      memory.push({ s: sk, y: yk, rho: 1 / sy });
      if (memory.length > 8) memory.shift();
    }
    const change = e - nextE;
    z.set(next);
    grad = Float64Array.from(nextGrad);
    e = nextE;
    if (change < 1e-7 * Math.max(1, Math.abs(e))) break;

    // Keep the hole directions unit length, and look for new contacts once
    // any bead has moved far enough to reach one.
    let moved = 0;
    for (let k = 0; k < n; k++) {
      moved = Math.max(moved, Math.hypot(z[6 * k]! - pairsAt[6 * k]!, z[6 * k + 1]! - pairsAt[6 * k + 1]!, z[6 * k + 2]! - pairsAt[6 * k + 2]!));
    }
    if (moved > 0.25) {
      load(build, z);
      placed.forEach((id, k) => z.set(a[id]!, 6 * k + 3));
      pairs = nearPairs(build);
      pairsAt = Float64Array.from(z);
      e = evaluate(z, grad);
    }
  }
  load(build, z);
}

/** Copies the solver's variables into the beads' centers and (unit) hole directions. */
function load(build: Build, z: Float64Array): void {
  build.placed.forEach((id, k) => {
    build.x[id] = [z[6 * k]!, z[6 * k + 1]!, z[6 * k + 2]!];
    build.a[id] = normalize([z[6 * k + 3]!, z[6 * k + 4]!, z[6 * k + 5]!]);
  });
}

/**
 * The piece's energy, per unit of thread tension (mm), and its gradient with
 * respect to every bead's center and (unnormalized) hole direction:
 *
 *     E = Σ_threads s(ℓ − δ)  +  Σ_ends κ(1 − dir·t)  +  Σ_pairs (k/2)·overlap²
 *
 * s() is the excess thread length, smoothed over its first 0.02 mm. Forces on
 * a bead are gathered as a force at its center and a torque; the torque G
 * becomes the gradient of its hole direction as G × a.
 */
function energy(build: Build, pairs: [number, number][], out: Float64Array): number {
  const { x, a, body, placed } = build;
  const index = new Map(placed.map((id, k) => [id, k]));
  const force = placed.map((): Vec3 => [0, 0, 0]);
  const torque = placed.map((): Vec3 => [0, 0, 0]);
  /** dE/d(point) = f, for a point of bead id. */
  const at = (id: number, point: Vec3, f: Vec3) => {
    const k = index.get(id)!;
    force[k] = add(force[k]!, f);
    torque[k] = add(torque[k]!, cross(sub(point, x[id]!), f));
  };
  let e = 0;
  // Where the thread enters and leaves each pass, for the thread inside the hole.
  const ends = new Map<Pass, { into?: Vec3; out?: Vec3 }>();

  for (const s of build.segments) {
    const i = s.from.bead;
    const j = s.to.bead;
    const { from, to, length } = threadEnds(build, s);
    ends.set(s.from, { ...ends.get(s.from), out: from });
    ends.set(s.to, { ...ends.get(s.to), into: to });
    if (length < 1e-9) continue;
    const t = scale(sub(to, from), 1 / length);
    const excess = length - s.slack;
    if (excess > 0) {
      const w = SMOOTH;
      e += excess < w ? (excess * excess) / (2 * w) : excess - w / 2;
      const pull = scale(t, Math.min(1, excess / w));
      at(i, from, scale(pull, -1));
      at(j, to, pull);
    }
    if (s.bend > 0) {
      // Bending where the thread leaves i and enters j: κ(1 − dir·e/q), with
      // q = √(ℓ² + r²), so very short thread spreads its bend over the beads.
      const q = Math.sqrt(length * length + BEND_SPREAD * BEND_SPREAD);
      const span = sub(to, from);
      for (const [id, sign] of [
        [i, s.from.sign],
        [j, s.to.sign],
      ] as const) {
        const dir = scale(a[id]!, sign);
        const along = dot(dir, span);
        e += s.bend * (1 - along / q);
        // ∂E/∂span = −κ (dir/q − (dir·span) span/q³)
        const g = scale(sub(scale(dir, 1 / q), scale(span, along / q ** 3)), -s.bend);
        at(j, to, g);
        at(i, from, scale(g, -1));
        // ∂E/∂a = −κ sign span/q, as a torque a × ∂E/∂a.
        const k = index.get(id)!;
        torque[k] = add(torque[k]!, cross(a[id]!, scale(span, (-s.bend * sign) / q)));
      }
    }
  }

  // The thread inside each hole runs straight from where it enters to where
  // it leaves. Off center at both ends on opposite sides, it runs across the
  // hole and is longer than the bead: so a bead turned against its thread
  // costs thread, however much room the hole gives.
  for (const [pass, { into, out }] of ends) {
    const id = pass.bead;
    const half = scale(a[id]!, (pass.sign * body[id]!.length) / 2);
    const p = into ?? sub(x[id]!, half);
    const q = out ?? add(x[id]!, half);
    const span = sub(q, p);
    const length = Math.hypot(...span);
    if (length < 1e-9) continue;
    e += length - body[id]!.length;
    const t = scale(span, 1 / length);
    at(id, q, t);
    at(id, p, scale(t, -1));
  }

  e += contactEnergy(build, pairs, index, force, torque);

  placed.forEach((id, k) => {
    const g = cross(torque[k]!, a[id]!);
    out.set(force[k]!, 6 * k);
    out.set(g, 6 * k + 3);
  });
  return e;
}

/**
 * Contacts: each probe sphere of one bead pressing into the other bead,
 * energy (k/2)·overlap². Adds the forces and torques; returns the energy.
 * Written with flat arrays and no allocation: it is most of the solver's time.
 */
function contactEnergy(
  build: Build,
  pairs: [number, number][],
  index: Map<number, number>,
  force: Vec3[],
  torque: Vec3[],
): number {
  const { x, a, body, placed } = build;
  // Probe centers of every bead, once.
  const start = new Map<number, number>();
  let total = 0;
  for (const id of placed) {
    start.set(id, total);
    total += body[id]!.probes.length;
  }
  const probe = new Float64Array(3 * total);
  for (const id of placed) {
    const [u, v] = across(a[id]!);
    const c = x[id]!;
    const axis = a[id]!;
    let o = 3 * start.get(id)!;
    for (const { along, out, angle } of body[id]!.probes) {
      const cu = out * Math.cos(angle);
      const cv = out * Math.sin(angle);
      for (let d = 0; d < 3; d++) probe[o + d] = c[d]! + along * axis[d]! + cu * u[d]! + cv * v[d]!;
      o += 3;
    }
  }

  let e = 0;
  const push = (id: number, px: number, py: number, pz: number, fx: number, fy: number, fz: number) => {
    const k = index.get(id)!;
    const F = force[k]!;
    const T = torque[k]!;
    const c = x[id]!;
    const rx = px - c[0];
    const ry = py - c[1];
    const rz = pz - c[2];
    F[0] += fx;
    F[1] += fy;
    F[2] += fz;
    T[0] += ry * fz - rz * fy;
    T[1] += rz * fx - rx * fz;
    T[2] += rx * fy - ry * fx;
  };
  for (const [i, j] of pairs) {
    const ci = x[i]!;
    const cj = x[j]!;
    const reach = body[i]!.bound + body[j]!.bound;
    if ((ci[0] - cj[0]) ** 2 + (ci[1] - cj[1]) ** 2 + (ci[2] - cj[2]) ** 2 > reach * reach) continue;
    for (let side = 0; side < 2; side++) {
      const p = side === 0 ? i : j;
      const q = side === 0 ? j : i;
      const c = x[q]!;
      const axis = a[q]!;
      const { coreRadius, coreHalf, rounding, bound } = body[q]!;
      const radius = body[p]!.probeRadius;
      const near = (bound + radius) ** 2;
      const first = start.get(p)!;
      const count = body[p]!.probes.length;
      for (let k = first; k < first + count; k++) {
        const px = probe[3 * k]!;
        const py = probe[3 * k + 1]!;
        const pz = probe[3 * k + 2]!;
        const dx = px - c[0];
        const dy = py - c[1];
        const dz = pz - c[2];
        if (dx * dx + dy * dy + dz * dz > near) continue;
        // Signed distance to bead q (a rounded cylinder), and its gradient n.
        const along = dx * axis[0] + dy * axis[1] + dz * axis[2];
        let rx = dx - along * axis[0];
        let ry = dy - along * axis[1];
        let rz = dz - along * axis[2];
        const r = Math.hypot(rx, ry, rz);
        if (r > 1e-9) {
          rx /= r;
          ry /= r;
          rz /= r;
        } else {
          [rx, ry, rz] = across(axis)[0];
        }
        const sign = along >= 0 ? 1 : -1;
        const ez = Math.abs(along) - coreHalf;
        const er = r - coreRadius;
        let distance: number;
        let nx: number;
        let ny: number;
        let nz: number;
        if (ez > 0 && er > 0) {
          const len = Math.hypot(ez, er);
          distance = len - rounding;
          nx = (sign * axis[0] * ez + rx * er) / len;
          ny = (sign * axis[1] * ez + ry * er) / len;
          nz = (sign * axis[2] * ez + rz * er) / len;
        } else if (ez > er) {
          distance = ez - rounding;
          nx = sign * axis[0];
          ny = sign * axis[1];
          nz = sign * axis[2];
        } else {
          distance = er - rounding;
          nx = rx;
          ny = ry;
          nz = rz;
        }
        const overlap = radius - distance;
        if (overlap <= 0) continue;
        e += (CONTACT / 2) * overlap * overlap;
        // ∂E/∂probe = −k·overlap·n: pushes the probe out of q, and q away.
        const f = -CONTACT * overlap;
        push(p, px, py, pz, f * nx, f * ny, f * nz);
        push(q, px, py, pz, -f * nx, -f * ny, -f * nz);
      }
    }
  }
  return e;
}

/** Excess thread length over which the pull eases in (mm), so the energy is smooth. */
const SMOOTH = 0.02;
/** Length over which a very short thread spreads its bend (mm). */
const BEND_SPREAD = 0.3;
/** Stiffness of contacts, per unit of thread tension (1/mm): overlap of about 1/CONTACT mm per unit force. */
const CONTACT = 400;

const dotN = (p: Float64Array, q: Float64Array) => {
  let sum = 0;
  for (let i = 0; i < p.length; i++) sum += p[i]! * q[i]!;
  return sum;
};
const axpy = (y: Float64Array, k: number, p: Float64Array) => {
  for (let i = 0; i < y.length; i++) y[i]! += k * p[i]!;
};

/** Pairs of beads close enough to touch soon, from a grid so it stays fast. */
function nearPairs(build: Build): [number, number][] {
  const { x, body, placed } = build;
  const margin = 0.6;
  const cell = 2 * Math.max(...placed.map((id) => body[id]!.bound)) + margin;
  const grid = new Map<string, number[]>();
  const cellOf = (p: Vec3) => p.map((v) => Math.floor(v / cell));
  for (const id of placed) {
    const k = cellOf(x[id]!).join(",");
    const list = grid.get(k);
    if (list) list.push(id);
    else grid.set(k, [id]);
  }
  const pairs: [number, number][] = [];
  for (const id of placed) {
    const [cx, cy, cz] = cellOf(x[id]!);
    for (let i = cx! - 1; i <= cx! + 1; i++)
      for (let j = cy! - 1; j <= cy! + 1; j++)
        for (let k = cz! - 1; k <= cz! + 1; k++)
          for (const other of grid.get(`${i},${j},${k}`) ?? []) {
            if (other <= id) continue;
            if (distance(x[id]!, x[other]!) < body[id]!.bound + body[other]!.bound + margin) pairs.push([id, other]);
          }
  }
  return pairs;
}

/** Centers of a bead's probe spheres, in space. */
function probePoints(build: Build, id: number): Vec3[] {
  const c = build.x[id]!;
  const axis = build.a[id]!;
  const [u, v] = across(axis);
  return build.body[id]!.probes.map(({ along, out, angle }) =>
    add(add(c, scale(axis, along)), add(scale(u, out * Math.cos(angle)), scale(v, out * Math.sin(angle)))),
  );
}

/** Two unit vectors across a hole direction, chosen smoothly from it. */
function across(axis: Vec3): [Vec3, Vec3] {
  const ref: Vec3 = Math.abs(axis[0]) < 0.6 ? [1, 0, 0] : [0, 1, 0];
  const u = normalize(sub(ref, scale(axis, dot(ref, axis))));
  return [u, cross(axis, u)];
}

/**
 * Signed distance from a point to a bead's surface (a rounded cylinder;
 * negative inside), and the outward direction of increasing distance.
 */
function signedDistance(build: Build, id: number, point: Vec3): { distance: number; normal: Vec3 } {
  const c = build.x[id]!;
  const axis = build.a[id]!;
  const { coreRadius, coreHalf, rounding } = build.body[id]!;
  const d = sub(point, c);
  const along = dot(d, axis);
  const radial = sub(d, scale(axis, along));
  const r = Math.hypot(...radial);
  const outward = r > 1e-9 ? scale(radial, 1 / r) : across(axis)[0];
  const end = scale(axis, along >= 0 ? 1 : -1);
  const dz = Math.abs(along) - coreHalf;
  const dr = r - coreRadius;
  if (dz > 0 && dr > 0) {
    const len = Math.hypot(dz, dr);
    return { distance: len - rounding, normal: add(scale(end, dz / len), scale(outward, dr / len)) };
  }
  if (dz > dr) return { distance: dz - rounding, normal: end };
  return { distance: dr - rounding, normal: outward };
}

/** The deepest overlap of any probe into another bead (mm). */
function deepestOverlap(build: Build): number {
  let deepest = 0;
  for (const [i, j] of nearPairs(build)) {
    for (const [p, q] of [
      [i, j],
      [j, i],
    ] as const) {
      for (const point of probePoints(build, p)) {
        deepest = Math.max(deepest, build.body[p]!.probeRadius - signedDistance(build, q, point).distance);
      }
    }
  }
  return deepest;
}

// ---- Small helpers ----

function seeded(seed: number): () => number {
  let s = (seed * 2654435761) >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 4294967296;
  };
}

const add = (p: Vec3, q: Vec3): Vec3 => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];
const sub = (p: Vec3, q: Vec3): Vec3 => [p[0] - q[0], p[1] - q[1], p[2] - q[2]];
const scale = (p: Vec3, k: number): Vec3 => [p[0] * k, p[1] * k, p[2] * k];
const dot = (p: Vec3, q: Vec3) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
const cross = (p: Vec3, q: Vec3): Vec3 => [p[1] * q[2] - p[2] * q[1], p[2] * q[0] - p[0] * q[2], p[0] * q[1] - p[1] * q[0]];
const distance = (p: Vec3, q: Vec3) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
function normalize(p: Vec3): Vec3 {
  const len = Math.hypot(...p);
  return len === 0 ? p : scale(p, 1 / len);
}

/**
 * For tests and tuning: every free thread's length beyond its slack, and the
 * deepest overlap of any two beads, in the piece as built so far (mm).
 */
export function tensionReport(model: ShapeModel): {
  threads: { from: number; to: number; extra: number }[];
  overlap: number;
} {
  const build = builds.get(model);
  if (!build) return { threads: [], overlap: 0 };
  const threads = build.segments.map((s) => ({
    from: s.from.bead,
    to: s.to.bead,
    extra: threadEnds(build, s).length - s.slack,
  }));
  return { threads, overlap: deepestOverlap(build) };
}
