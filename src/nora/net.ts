// The Nora net: an octagon-and-square tiling with one bead on each edge. Its
// squares are groups of 4 and its octagons groups of 8, and every bead is
// shared by two groups. See docs/nora-net-spec.md §1–2.
//
// Group (i, j) is an 8 when i + j is even and a 4 when it is odd. Slots are on
// a grid twice as fine: group (i, j) is at (2i, 2j), and (x, y) is a slot when
// x and y are not both even.

export interface Slot {
  x: number;
  y: number;
}

export interface Group {
  i: number;
  j: number;
}

export interface Point {
  x: number;
  y: number;
}

export function mod(n: number, m: number): number {
  return ((n % m) + m) % m;
}

export function isSlot(x: number, y: number): boolean {
  return mod(x, 2) === 1 || mod(y, 2) === 1;
}

export function slotKey(x: number, y: number): string {
  return `${x},${y}`;
}

export function parseSlotKey(key: string): Slot {
  const [x, y] = key.split(",").map(Number) as [number, number];
  return { x, y };
}

export function groupKey(i: number, j: number): string {
  return `${i},${j}`;
}

export function parseGroupKey(key: string): Group {
  const [i, j] = key.split(",").map(Number) as [number, number];
  return { i, j };
}

export function isEight({ i, j }: Group): boolean {
  return mod(i + j, 2) === 0;
}

export function groupSize(group: Group): 4 | 8 {
  return isEight(group) ? 8 : 4;
}

export function isDiagonal({ x, y }: Slot): boolean {
  return mod(x, 2) === 1 && mod(y, 2) === 1;
}

/** The two groups a slot's bead belongs to. A side slot joins a 4 and an 8, a diagonal slot two 8s. */
export function slotGroups({ x, y }: Slot): [Group, Group] {
  const xOdd = mod(x, 2) === 1;
  const yOdd = mod(y, 2) === 1;
  if (xOdd && !yOdd) return [{ i: (x - 1) / 2, j: y / 2 }, { i: (x + 1) / 2, j: y / 2 }];
  if (!xOdd && yOdd) return [{ i: x / 2, j: (y - 1) / 2 }, { i: x / 2, j: (y + 1) / 2 }];
  const i = (x - 1) / 2;
  const j = (y - 1) / 2;
  return mod(i + j, 2) === 0 ? [{ i, j }, { i: i + 1, j: j + 1 }] : [{ i: i + 1, j }, { i, j: j + 1 }];
}

/** A group's slots in ring order: clockwise from the top. */
export function groupSlots({ i, j }: Group): Slot[] {
  const x = 2 * i;
  const y = 2 * j;
  if (!isEight({ i, j })) {
    return [{ x, y: y - 1 }, { x: x + 1, y }, { x, y: y + 1 }, { x: x - 1, y }];
  }
  return [
    { x, y: y - 1 },
    { x: x + 1, y: y - 1 },
    { x: x + 1, y },
    { x: x + 1, y: y + 1 },
    { x, y: y + 1 },
    { x: x - 1, y: y + 1 },
    { x: x - 1, y },
    { x: x - 1, y: y - 1 },
  ];
}

/** The slots next to this one in either of its groups' rings: the beads it touches. */
export function ringNeighbors(slot: Slot): Slot[] {
  const out: Slot[] = [];
  for (const group of slotGroups(slot)) {
    const ring = groupSlots(group);
    const at = ring.findIndex((s) => s.x === slot.x && s.y === slot.y);
    out.push(ring[mod(at - 1, ring.length)]!, ring[mod(at + 1, ring.length)]!);
  }
  return out;
}

// ---- Geometry ----

/**
 * Sizes in mm for a bead of diameter d. The edge e = √2 · d makes the beads of
 * a group of 4 just touch; L is the distance between neighboring groups.
 */
export interface NetSize {
  d: number;
  e: number;
  L: number;
}

export function netSize(d: number): NetSize {
  return { d, e: Math.SQRT2 * d, L: (1 + Math.SQRT2) * d };
}

export function groupCenter({ i, j }: Group, net: NetSize): Point {
  return { x: i * net.L, y: j * net.L };
}

/** Where a slot's bead sits: on the middle of its edge. */
export function slotCenter(slot: Slot, net: NetSize): Point {
  if (isDiagonal(slot)) return { x: (slot.x * net.L) / 2, y: (slot.y * net.L) / 2 };
  const [a, b] = slotGroups(slot);
  const [eight, four] = isEight(a) ? [a, b] : [b, a];
  // An octagon is wider than a square, so the bead sits L / √2 from the 8's middle, not halfway.
  const t = Math.SQRT1_2;
  return { x: (eight.i + (four.i - eight.i) * t) * net.L, y: (eight.j + (four.j - eight.j) * t) * net.L };
}

/** The way a slot's hole runs, in radians (y down): 0 across, π/2 up and down, ∓π/4 for `/` and `\`. */
export function slotAngle(slot: Slot): number {
  if (!isDiagonal(slot)) return mod(slot.x, 2) === 0 ? 0 : Math.PI / 2;
  const i = (slot.x - 1) / 2;
  const j = (slot.y - 1) / 2;
  return mod(i + j, 2) === 0 ? -Math.PI / 4 : Math.PI / 4;
}

/** The slot whose bead is nearest a point (mm), or undefined in a hole (no bead within d). */
export function slotAt(p: Point, net: NetSize): Slot | undefined {
  const cx = Math.round((2 * p.x) / net.L);
  const cy = Math.round((2 * p.y) / net.L);
  let best: Slot | undefined;
  let bestDistance = net.d;
  for (let x = cx - 2; x <= cx + 2; x++) {
    for (let y = cy - 2; y <= cy + 2; y++) {
      if (!isSlot(x, y)) continue;
      const c = slotCenter({ x, y }, net);
      const distance = Math.hypot(c.x - p.x, c.y - p.y);
      if (distance <= bestDistance) {
        bestDistance = distance;
        best = { x, y };
      }
    }
  }
  return best;
}

/** The corners of a group's outline (mm): its square or octagon, through the ends of its edges. */
export function groupOutline(group: Group, net: NetSize): Point[] {
  const c = groupCenter(group, net);
  const h = net.e / 2;
  if (!isEight(group)) {
    return [{ x: c.x - h, y: c.y - h }, { x: c.x + h, y: c.y - h }, { x: c.x + h, y: c.y + h }, { x: c.x - h, y: c.y + h }];
  }
  const a = net.L - h; // the octagon's apothem
  return [
    { x: c.x - h, y: c.y - a },
    { x: c.x + h, y: c.y - a },
    { x: c.x + a, y: c.y - h },
    { x: c.x + a, y: c.y + h },
    { x: c.x + h, y: c.y + a },
    { x: c.x - h, y: c.y + a },
    { x: c.x - a, y: c.y + h },
    { x: c.x - a, y: c.y - h },
  ];
}

/**
 * The slots a pointer passed over going from a to b (mm), in order and
 * without repeats, so a fast drag skips nothing.
 */
export function slotsAlong(a: Point, b: Point, net: NetSize): Slot[] {
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / (net.d / 2)));
  const seen = new Set<string>();
  const out: Slot[] = [];
  for (let k = 0; k <= n; k++) {
    const slot = slotAt({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n }, net);
    if (!slot || seen.has(slotKey(slot.x, slot.y))) continue;
    seen.add(slotKey(slot.x, slot.y));
    out.push(slot);
  }
  return out;
}
