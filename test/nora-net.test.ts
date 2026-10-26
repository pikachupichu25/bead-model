import { describe, expect, it } from "vitest";
import {
  DIAGONAL_ANGLE,
  type Group,
  groupCenter,
  groupOutline,
  groupKey,
  groupSlots,
  isEight,
  isSlot,
  netSize,
  ringNeighbors,
  type Slot,
  slotAngle,
  slotAt,
  slotCenter,
  slotGroups,
  slotKey,
  slotsAlong,
  STRETCH,
} from "../src/nora/net.js";

const net = netSize(3);
const groups: Group[] = [];
for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) groups.push({ i, j });
const slots: Slot[] = [];
for (let x = -7; x <= 7; x++) for (let y = -7; y <= 7; y++) if (isSlot(x, y)) slots.push({ x, y });

const same = (a: Group, b: Group) => a.i === b.i && a.j === b.j;
const neighborsOf = (g: Group) =>
  groupSlots(g).map((s) => slotGroups(s).find((o) => !same(o, g))!);

describe("lattice", () => {
  it("has groups of 8 and 4 like a checkerboard", () => {
    expect(isEight({ i: 0, j: 0 })).toBe(true);
    expect(isEight({ i: 1, j: 0 })).toBe(false);
    expect(isEight({ i: -1, j: -1 })).toBe(true);
    expect(groupSlots({ i: 0, j: 0 })).toHaveLength(8);
    expect(groupSlots({ i: 0, j: 1 })).toHaveLength(4);
  });

  it("puts every slot in exactly the two groups whose rings list it", () => {
    for (const s of slots) {
      const [a, b] = slotGroups(s);
      expect(same(a, b)).toBe(false);
      for (const g of [a, b]) expect(groupSlots(g).some((t) => t.x === s.x && t.y === s.y)).toBe(true);
    }
  });

  it("joins a 4 to four 8s, and an 8 to four 4s and four 8s", () => {
    for (const g of groups) {
      const n = neighborsOf(g);
      const eights = n.filter(isEight).length;
      if (isEight(g)) {
        expect(eights).toBe(4);
        expect(n.length - eights).toBe(4);
      } else {
        expect(eights).toBe(4);
        expect(n).toHaveLength(4);
      }
      expect(new Set(n.map((o) => groupKey(o.i, o.j))).size).toBe(n.length);
    }
  });

  it("gives each slot four ring neighbors", () => {
    for (const s of slots) expect(new Set(ringNeighbors(s).map((t) => slotKey(t.x, t.y))).size).toBe(4);
  });
});

describe("geometry", () => {
  // Before the stretch: undo it to check the layout the net is built from.
  const flat = (s: Slot) => {
    const p = slotCenter(s, net);
    return { x: p.x, y: p.y / STRETCH };
  };

  it("makes neighboring beads of a group of 4 one bead apart before the stretch", () => {
    const ring = groupSlots({ i: 1, j: 0 }).map(flat);
    for (let n = 0; n < 4; n++) {
      const a = ring[n]!;
      const b = ring[(n + 1) % 4]!;
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(net.d);
    }
  });

  it("puts an 8's side beads one bead out across and its corners 0.85 as far", () => {
    const ring = groupSlots({ i: 0, j: 0 }).map(flat);
    for (let n = 0; n < 8; n++) {
      const dx = Math.abs(ring[n]!.x);
      const dy = Math.abs(ring[n]!.y);
      if (n % 2 === 0) expect(Math.max(dx, dy)).toBeCloseTo(net.d);
      else {
        expect(dx).toBeCloseTo(dy);
        expect(dx / net.d).toBeCloseTo(0.854, 3);
      }
    }
  });

  it("stretches the net up and down, so an 8 is taller than wide", () => {
    expect(net.H).toBeCloseTo(STRETCH * net.L);
    const ring = groupSlots({ i: 0, j: 0 }).map((s) => slotCenter(s, net));
    expect(ring[0]!.y).toBeCloseTo(-STRETCH * net.d);
    expect(ring[2]!.x).toBeCloseTo(net.d);
    // Three beads still nearly touch along the top: the top bead and its corners.
    expect(Math.hypot(ring[1]!.x - ring[0]!.x, ring[1]!.y - ring[0]!.y)).toBeLessThan(net.d);
  });

  it("turns beads along their edges, the diagonals steeper than 45°", () => {
    expect(slotAngle({ x: 2, y: 1 })).toBe(0);
    expect(slotAngle({ x: 1, y: 2 })).toBe(Math.PI / 2);
    expect(slotAngle({ x: 1, y: 1 })).toBe(-DIAGONAL_ANGLE);
    expect(slotAngle({ x: 3, y: 1 })).toBe(DIAGONAL_ANGLE);
    expect(DIAGONAL_ANGLE).toBeGreaterThan(Math.PI / 4);
    // A diagonal bead lies along the edge between its two neighbors' outline corners.
    const [a, b] = [groupOutline({ i: 0, j: 0 }, net)[1]!, groupOutline({ i: 0, j: 0 }, net)[2]!];
    expect(Math.atan2(b.y - a.y, b.x - a.x)).toBeCloseTo(DIAGONAL_ANGLE);
  });

  it("finds the slot under its own bead, and nothing in the middle of an 8", () => {
    for (const s of slots) expect(slotAt(slotCenter(s, net), net)).toEqual(s);
    expect(slotAt(groupCenter({ i: 0, j: 0 }, net), net)).toBeUndefined();
  });

  it("skips no slots on a fast drag", () => {
    const along = slotsAlong(slotCenter({ x: -1, y: 0 }, net), slotCenter({ x: 5, y: 0 }, net), net);
    expect(along.map((s) => s.x)).toEqual([-1, 1, 3, 5]);
  });
});
