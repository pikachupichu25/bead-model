// Which beads touch in the finished piece, and how far apart their centers
// are. The 3D solver (relax.ts) holds every pair at that distance.
// See docs/shape-model.md.
//
// Three kinds of link:
//   - thread: two beads the thread passes between, so their ends touch. Beads
//     in the same round lie end to end; beads in neighbouring rounds sit side
//     by side, half a bead apart across the row (the peyote offset).
//   - column: a bead that is alone in its gap rests on the bead directly below
//     it, two rounds down. This is what makes peyote fabric hold its shape
//     in its own plane.
//   - gap: a bead alone in its gap holds its two up beads apart by its own
//     length. Smaller beads pull the up beads closer, which is how a round of
//     15/0s curls a bezel inward.
//   - bend: the bead below that one, so a column of beads stays straight
//     unless something pulls it round. Much weaker than the others.

import type { ResolvedBead } from "../catalog/catalog.js";
import type { CompiledPattern } from "../pattern/compile.js";
import type { Tension } from "../pattern/load.js";
import { threadPasses } from "../pattern/thread.js";

export type LinkKind = "thread" | "column" | "gap" | "bend";

export interface Link {
  a: number;
  b: number;
  kind: LinkKind;
  /** Distance between the two bead centers, mm. */
  rest: number;
  /** How much of the error is corrected per solver pass (0 to 1). */
  stiffness: number;
}

/**
 * How the thread tension changes the space a bead takes up along the thread.
 * `slack` is thread showing between two beads; `squeeze` scales a bead's
 * length, as tight thread tilts beads and nests them into each other. These
 * are first guesses, to be fitted to photos of real pieces.
 */
export const TENSION: Record<Tension, { slack: number; squeeze: number }> = {
  loose: { slack: 0.25, squeeze: 1 },
  normal: { slack: 0.08, squeeze: 1 },
  tight: { slack: 0, squeeze: 0.9 },
};

export const STIFFNESS: Record<LinkKind, number> = { thread: 1, column: 0.9, gap: 0.5, bend: 0.06 };

/**
 * Stiffness of a thread link to a bead that shares its gap (a pair or more).
 * Increase beads tilt and splay, and thread shows between them, so they give
 * way first when a row has too few or too many beads.
 */
export const SHARED_GAP_STIFFNESS = 0.2;

export interface Contacts {
  links: Link[];
  /** For each bead, the bead directly below it two rounds down, if any. */
  below: Map<number, number>;
  /** Thread neighbours of each bead. */
  neighbours: Map<number, Set<number>>;
}

export function buildContacts(compiled: CompiledPattern, beads: Map<string, ResolvedBead>): Contacts {
  const size = (id: number) => beads.get(compiled.beads[id]!.key)!;
  const tensionOf = new Map(compiled.rounds.map((r) => [r.round, r.tension]));
  const links: Link[] = [];
  const neighbours = new Map<number, Set<number>>();
  const seen = new Set<string>();

  // Thread links, from the path the thread takes in every step. A bead's
  // effective length depends on the tension of the round it was added in;
  // the thread between two beads takes the tension of the later one.
  const length = (id: number) => size(id).length * TENSION[tensionOf.get(compiled.beads[id]!.round)!].squeeze;
  compiled.steps.forEach((_, stepIndex) => {
    const passes = threadPasses(compiled, stepIndex);
    for (let i = 1; i < passes.length; i++) {
      const [a, b] = [passes[i - 1]!, passes[i]!];
      const key = a < b ? `${a}-${b}` : `${b}-${a}`;
      if (a === b || seen.has(key)) continue;
      seen.add(key);
      const later = compiled.beads[Math.max(a, b)]!;
      const along = (length(a) + length(b)) / 2 + TENSION[tensionOf.get(later.round)!].slack;
      const sameRound = compiled.beads[a]!.round === compiled.beads[b]!.round;
      const across = sameRound ? 0 : (size(a).outerDiameter + size(b).outerDiameter) / 4;
      const shared = compiled.beads[a]!.slotsInGap > 1 || compiled.beads[b]!.slotsInGap > 1;
      const stiffness = shared ? SHARED_GAP_STIFFNESS : STIFFNESS.thread;
      links.push({ a, b, kind: "thread", rest: Math.hypot(along, across), stiffness });
      for (const [x, y] of [
        [a, b],
        [b, a],
      ] as const) {
        if (!neighbours.has(x)) neighbours.set(x, new Set());
        neighbours.get(x)!.add(y);
      }
    }
  });

  // Column links. A bead alone in its gap sits between up beads u and v. If u
  // and v were added in neighbouring gaps, they share the up bead w they were
  // stitched around, and w is directly below the new bead.
  const below = new Map<number, number>();
  for (const bead of compiled.beads) {
    if (!bead.between || bead.slotsInGap !== 1) continue;
    const [u, v] = bead.between;
    if (u === v) continue;
    // Up beads that already touch end to end (a center ring, or a pair being
    // split) stay touching: the new bead sits on top of them, not between.
    if (!neighbours.get(u)?.has(v)) {
      const t = TENSION[tensionOf.get(bead.round)!];
      const span = (length(u) + length(v)) / 2 + length(bead.id) + 2 * t.slack;
      links.push({ a: u, b: v, kind: "gap", rest: span, stiffness: STIFFNESS.gap });
    }
    const roundOfU = compiled.beads[u]!.round;
    const shared = [...(neighbours.get(u) ?? [])].filter(
      (w) => w < bead.id && w !== v && neighbours.get(v)?.has(w) && compiled.beads[w]!.round !== roundOfU,
    );
    if (shared.length !== 1) continue;
    const w = shared[0]!;
    below.set(bead.id, w);
    const rest = (size(bead.id).outerDiameter + size(w).outerDiameter) / 2;
    links.push({ a: w, b: bead.id, kind: "column", rest, stiffness: STIFFNESS.column });
  }

  // Bend links: a bead and the bead two below it, held a straight column apart.
  for (const [top, mid] of below) {
    const bottom = below.get(mid);
    if (bottom === undefined) continue;
    const rest =
      size(top).outerDiameter / 2 + size(mid).outerDiameter + size(bottom).outerDiameter / 2;
    links.push({ a: bottom, b: top, kind: "bend", rest, stiffness: STIFFNESS.bend });
  }

  return { links, below, neighbours };
}
