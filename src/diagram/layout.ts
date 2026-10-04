// Places every bead of a compiled pattern on a flat, top-down diagram.
//
// Each round is a ring. A bead's angle comes from the two up beads it sits
// between, so the peyote offset is kept. The hole runs along the ring, so a
// bead takes up its `length` along the ring and its `outerDiameter` across it.
//
// The ring radius is the larger of:
//   - half a bead further out than the round before (the peyote offset), and
//   - enough circumference to fit this round's beads plus the up beads they
//     sit between.
// This is a diagram, not the real shape: a cup or ruffle still comes out flat
// here (step 4 computes the real 3D form).

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

export function layoutPattern(compiled: CompiledPattern, beads: Map<string, ResolvedBead>): Layout {
  const size = (key: string) => {
    const bead = beads.get(key);
    if (!bead) throw new Error(`bead "${key}" was not resolved`);
    return bead;
  };
  const theta = new Map<number, number>();
  const radius = new Map<number, number>();

  const sumLength = (ids: number[]) => ids.reduce((n, id) => n + size(compiled.beads[id]!.key).length, 0);
  const meanDiameter = (ids: number[]) =>
    ids.reduce((n, id) => n + size(compiled.beads[id]!.key).outerDiameter, 0) / Math.max(ids.length, 1);

  const [first, second] = compiled.rounds;
  if (!first) return { beads: [], radius, extent: 0 };
  const isTube = compiled.pattern.start.kind === "tube";

  // Start ring: beads evenly spaced in stringing order, starting at the top.
  // For a tube, rounds 1 and 2 alternate around the same ring.
  const ring = isTube && second ? interleave(first.beads, second.beads) : first.beads;
  ring.forEach((id, i) => theta.set(id, Math.PI / 2 + (2 * Math.PI * i) / ring.length));
  // Far enough out that neighbouring beads' inner corners don't overlap.
  const meanLength = sumLength(ring) / ring.length;
  const noOverlap = meanDiameter(ring) / 2 + meanLength / (2 * Math.tan(Math.PI / Math.max(ring.length, 3)));
  radius.set(1, Math.max(sumLength(ring) / (2 * Math.PI), noOverlap));
  if (isTube && second) {
    radius.set(2, radius.get(1)! + (meanDiameter(first.beads) + meanDiameter(second.beads)) / 4);
  }

  // Each worked round sits outside the round it was worked from (front edge),
  // or inside it (back edge of a tube).
  let frontRound = isTube ? 2 : 1;
  let backRound = 1;
  for (const round of compiled.rounds) {
    if (round.stitches.length === 0) continue; // start rounds are placed already

    const from = round.edge === "back" ? backRound : frontRound;
    const fromBeads = compiled.rounds.find((r) => r.round === from)!.beads;
    const ring = spaceRound(round.beads, fromBeads);
    round.beads.forEach((id, j) => theta.set(id, ring.angles[j]!));

    const step = (meanDiameter(fromBeads) + meanDiameter(round.beads)) / 4;
    const needed = ring.circumference / (2 * Math.PI);
    const r =
      round.edge === "back"
        ? Math.max(radius.get(from)! - step, step) // keep inner rounds off the center
        : Math.max(radius.get(from)! + step, needed);
    radius.set(round.round, r);
    if (round.edge === "back") backRound = round.round;
    else frontRound = round.round;
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
  const extent = Math.max(...placed.map((p) => p.radius + Math.max(p.radial, p.tangential) / 2));
  return { beads: placed, radius, extent };

  /**
   * Spaces a round's beads evenly around its ring, in pickup order. Beads in
   * the same gap sit side by side; beads in different gaps leave room for the
   * up beads between them. The ring is then turned so each bead sits as close
   * as it can to the middle of its gap.
   */
  function spaceRound(ids: number[], upBeads: number[]): { angles: number[]; circumference: number } {
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
      return (size(bead.key).length + size(next.key).length) / 2 + upLength;
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
    return { angles: even.map((a) => a + turn), circumference };
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
