import { describe, expect, it } from "vitest";
import {
  type Group,
  groupCenter,
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
  it("makes neighboring beads of a group of 4 exactly one bead apart", () => {
    const ring = groupSlots({ i: 1, j: 0 }).map((s) => slotCenter(s, net));
    for (let n = 0; n < 4; n++) {
      const a = ring[n]!;
      const b = ring[(n + 1) % 4]!;
      expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeCloseTo(net.d);
    }
  });

  it("puts a group's beads the same distance from its middle", () => {
    for (const g of [{ i: 0, j: 0 }, { i: 1, j: 0 }, { i: -2, j: 3 }]) {
      const c = groupCenter(g, net);
      const r = groupSlots(g).map((s) => {
        const p = slotCenter(s, net);
        return Math.hypot(p.x - c.x, p.y - c.y);
      });
      // The middles of an octagon's sides are all one apothem away; for a square, half its side.
      for (const v of r) expect(v).toBeCloseTo(isEight(g) ? net.L - net.e / 2 : net.e / 2);
    }
  });

  it("turns beads along their edges", () => {
    expect(slotAngle({ x: 2, y: 1 })).toBe(0);
    expect(slotAngle({ x: 1, y: 2 })).toBe(Math.PI / 2);
    expect(slotAngle({ x: 1, y: 1 })).toBe(-Math.PI / 4);
    expect(slotAngle({ x: 3, y: 1 })).toBe(Math.PI / 4);
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
