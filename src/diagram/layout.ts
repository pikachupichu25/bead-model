// Places every bead of a compiled pattern on a flat, top-down diagram.
//
// Each round is its own ring. A bead's angle comes from the two up beads it
// sits between, so the peyote offset shows. The hole runs along the ring, so
// a bead takes up its `length` along the ring and its `outerDiameter` across it.
//
// No two beads overlap. Each ring's radius is the larger of:
//   - far enough outside the ring within it that the beads clear it by
//     `roundGap`, and
//   - far enough out that neighbouring beads in the ring clear each other by
//     `beadGap`.
// Back-edge rounds of a tube go inside round 1, so the radii are worked out
// from the innermost ring outward.
// In a real piece the rounds interlock by half a bead. This is a diagram, not
// the real shape: step 4 computes the real 3D form.

import type { ResolvedBead } from "../catalog/catalog.js";
import type { CompiledPattern } from "../pattern/compile.js";

export interface PlacedBead {
  id: number;
  round: number;
  key: string;
  /** Polar angle in radians, counter-clockwise from +x, with y up. */
  theta: number;
  radius: number;
  /** Center in diagram coordinates (mm, y down for SVG). */
  x: number;
  y: number;
  /** Size across the ring (outer diameter) and along it (length), mm. */
  radial: number;
  tangential: number;
}

export interface Layout {
  beads: PlacedBead[];
  /** Ring radius of each round, mm. */
  radius: Map<number, number>;
  /** Furthest extent from the center, mm. */
  extent: number;
}

export interface LayoutOptions {
  /** Space between the beads of neighbouring rounds, mm. */
  roundGap?: number;
  /** Space between neighbouring beads in a round, mm. */
  beadGap?: number;
}

export const DEFAULT_SPACING: Required<LayoutOptions> = { roundGap: 0.3, beadGap: 0.15 };

export function layoutPattern(
  compiled: CompiledPattern,
  beads: Map<string, ResolvedBead>,
  options: LayoutOptions = {},
): Layout {
  const { roundGap, beadGap } = { ...DEFAULT_SPACING, ...options };
  const size = (key: string) => {
    const bead = beads.get(key);
    if (!bead) throw new Error(`bead "${key}" was not resolved`);
    return bead;
  };
  const theta = new Map<number, number>();
  const radius = new Map<number, number>();
  const sizeOf = (id: number) => size(compiled.beads[id]!.key);

  const [first, second] = compiled.rounds;
  if (!first) return { beads: [], radius, extent: 0 };
  const isTube = compiled.pattern.start.kind === "tube";

  // Angles first: they depend only on the order of the beads, not on the radii.
  // Start ring: beads evenly spaced in stringing order, starting at the top.
  // For a tube, rounds 1 and 2 alternate around the ring, each on its own radius.
  const ring = isTube && second ? interleave(first.beads, second.beads) : first.beads;
  ring.forEach((id, i) => theta.set(id, Math.PI / 2 + (2 * Math.PI * i) / ring.length));
  // Each worked round is worked from the outermost round so far (front edge),
  // or the innermost (back edge of a tube).
  const front: number[] = [isTube ? 2 : 1];
  const back: number[] = [];
  for (const round of compiled.rounds) {
    if (round.stitches.length === 0) continue; // start rounds are placed already
    const angles = spaceRound(round.beads, round.upBeads);
    round.beads.forEach((id, j) => theta.set(id, angles[j]!));
    (round.edge === "back" ? back : front).push(round.round);
  }

  // Then radii, from the inside out. Back-edge rounds sit inside round 1, so
  // start with the innermost one; round 1 then has to fit around them.
  let inner: number | undefined;
  for (const round of [...back].reverse()) {
    const r = ringRadius(beadsOf(round));
    radius.set(round, inner === undefined ? r : Math.max(r, outsideOf(beadsOf(inner), beadsOf(round))));
    inner = round;
  }
  const r1 = ringRadius(first.beads);
  radius.set(1, inner === undefined ? r1 : Math.max(r1, outsideOf(beadsOf(inner), first.beads)));
  // Front-edge rounds (round 2 of a tube start included) go outward.
  for (const [i, round] of front.entries()) {
    if (round === 1) continue;
    const from = i === 0 ? 1 : front[i - 1]!;
    radius.set(round, Math.max(outsideOf(beadsOf(from), beadsOf(round)), ringRadius(beadsOf(round))));
  }

  const placed = compiled.beads.map((bead): PlacedBead => {
    const t = theta.get(bead.id)!;
    const r = radius.get(bead.round)!;
    const s = size(bead.key);
    return {
      id: bead.id,
      round: bead.round,
      key: bead.key,
      theta: t,
      radius: r,
      x: r * Math.cos(t),
      y: -r * Math.sin(t),
      radial: s.outerDiameter,
      tangential: s.length,
    };
  });
  const extent = Math.max(...placed.map((p) => Math.hypot(p.radius + p.radial / 2, p.tangential / 2)));
  return { beads: placed, radius, extent };

  /**
   * The smallest radius at which a ring's beads, at their angles, don't touch.
   * Neighbours come closest at their inner corners, so each pair needs
   *   (r - D/2) sin(Δ/2) ≥ (L/2) cos(Δ/2) + beadGap/2
   * where Δ is the angle between them, D the larger diameter and L the larger length.
   */
  function ringRadius(ids: number[]): number {
    const sorted = [...ids].sort((a, b) => theta.get(a)! - theta.get(b)!);
    let r = Math.max(...ids.map((id) => sizeOf(id).outerDiameter / 2));
    sorted.forEach((id, i) => {
      if (sorted.length < 2) return;
      const next = sorted[(i + 1) % sorted.length]!;
      let delta = theta.get(next)! - theta.get(id)!;
      if (delta <= 0) delta += 2 * Math.PI;
      if (delta >= Math.PI) return; // on opposite sides: they can't touch
      const d = Math.max(sizeOf(id).outerDiameter, sizeOf(next).outerDiameter);
      const l = Math.max(sizeOf(id).length, sizeOf(next).length);
      r = Math.max(r, d / 2 + ((l / 2) * Math.cos(delta / 2) + beadGap / 2) / Math.sin(delta / 2));
    });
    return r;
  }

  /** Radius for a ring outside `inner`: its beads' inner faces clear the inner ring's outer corners. */
  function outsideOf(inner: number[], outer: number[]): number {
    const r = radius.get(compiled.beads[inner[0]!]!.round)!;
    const reach = Math.max(...inner.map((id) => Math.hypot(r + sizeOf(id).outerDiameter / 2, sizeOf(id).length / 2)));
    return reach + roundGap + Math.max(...outer.map((id) => sizeOf(id).outerDiameter / 2));
  }

  function beadsOf(round: number): number[] {
    return compiled.rounds.find((r) => r.round === round)!.beads;
  }

  /**
   * Spaces a round's beads evenly around its ring, in pickup order. Beads in
   * the same gap sit side by side; beads in different gaps leave room for the
   * up beads between them. The ring is then turned so each bead sits as close
   * as it can to the middle of its gap.
   */
  function spaceRound(ids: number[], upBeads: number[]): number[] {
    const round = ids.map((id) => compiled.beads[id]!);
    const gaps = upBeads.length;

    // Distance from each bead to the next, going round, in mm. Going from a
    // bead in gap g to one in gap h passes the up beads g+1 .. h.
    const spacing = round.map((bead, j) => {
      const isLast = j === round.length - 1;
      const next = round[isLast ? 0 : j + 1]!;
      const crossed = isLast ? next.gap! + gaps - bead.gap! : next.gap! - bead.gap!;
      let upLength = 0;
      for (let k = 1; k <= crossed; k++) {
        upLength += size(compiled.beads[upBeads[(bead.gap! + k) % gaps]!]!.key).length;
      }
      return (size(bead.key).length + size(next.key).length) / 2 + upLength + beadGap * (crossed + 1);
    });
    const circumference = spacing.reduce((a, b) => a + b, 0);

    // Evenly spaced angles, then turned to best match where each bead's gap is.
    const even: number[] = [];
    let total = 0;
    for (const s of spacing) {
      even.push((2 * Math.PI * total) / circumference);
      total += s;
    }
    let sin = 0;
    let cos = 0;
    round.forEach((bead, j) => {
      const d = gapMiddle(bead) - even[j]!;
      sin += Math.sin(d);
      cos += Math.cos(d);
    });
    const turn = Math.atan2(sin, cos);
    return even.map((a) => a + turn);
  }

  /** The angle between a bead's two up beads, where it would sit if it were alone in its gap. */
  function gapMiddle(bead: { between?: [number, number]; slot: number; slotsInGap: number }): number {
    const [left, right] = bead.between!;
    const a = theta.get(left)!;
    let b = theta.get(right)!;
    while (b <= a) b += 2 * Math.PI; // the gap runs counter-clockwise from left to right
    return a + ((bead.slot + 1) / (bead.slotsInGap + 1)) * (b - a);
  }
}

function interleave(odd: number[], even: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < Math.max(odd.length, even.length); i++) {
    if (i < odd.length) out.push(odd[i]!);
    if (i < even.length) out.push(even[i]!);
  }
  return out;
}
