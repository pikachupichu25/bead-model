import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveBeads } from "../src/catalog/catalog.js";
import { draftFromYaml, draftToYaml } from "../src/editor/draft.js";
import { loadCatalog } from "../src/catalog/load-files.js";
import { compilePattern } from "../src/pattern/compile.js";
import { parsePattern, PatternError } from "../src/pattern/load.js";
import { solveShape } from "../src/shape/engines.js";
import { shapeModel } from "../src/shape/shape.js";
import { beadBody, buildTensionShape, enclosingFaces, tensionReport } from "../src/shape/tension.js";

const catalog = loadCatalog("catalog/beads");

function fromText(text: string) {
  const pattern = parsePattern(text);
  const compiled = compilePattern(pattern);
  const beads = resolveBeads(pattern.beads, catalog);
  return { compiled, beads, model: shapeModel(compiled, beads) };
}
const fromFile = (name: string) => fromText(readFileSync(`patterns/${name}.peyote.yaml`, "utf8"));

const TUBE = `
beads: { A: { size: 11/0, shape: cylinder } }
start: tube (1A) x16
rounds:
  3-10: (1A) x8`;

// The same tube, with one increase every other round, always in gap 0.
const HORN = `
beads: { A: { size: 11/0, shape: cylinder } }
start: tube (1A) x16
rounds:
  3-4: (1A) x8
  5: (2A, 1A, 1A, 1A, 1A, 1A, 1A, 1A)
  6: (1A) x9
  7: (2A, 1A, 1A, 1A, 1A, 1A, 1A, 1A, 1A)
  8: (1A) x10
  9: (2A, 1A, 1A, 1A, 1A, 1A, 1A, 1A, 1A, 1A)
  10: (1A) x11
  11: (2A, 1A, 1A, 1A, 1A, 1A, 1A, 1A, 1A, 1A, 1A)
  12: (1A) x12`;

describe("bead bodies", () => {
  it("makes a round bead a flat disk with a sphere as long as the bead swept over it", () => {
    const body = beadBody(fromText(`beads: { A: { size: 11/0, shape: round } }\nstart: center 3A\nrounds: { 2: (1A) x3 }`).beads.get("A")!);
    expect(body.coreHalf).toBe(0);
    expect(body.rounding).toBeCloseTo(body.length / 2);
    expect(body.coreRadius + body.rounding).toBeCloseTo(body.diameter / 2);
  });

  it("gives a cylinder bead nearly square edges, with probes reaching its full size", () => {
    const body = beadBody(fromText(`beads: { A: { size: 11/0, shape: cylinder } }\nstart: center 3A\nrounds: { 2: (1A) x3 }`).beads.get("A")!);
    expect(body.coreHalf + body.rounding).toBeCloseTo(body.length / 2);
    expect(body.coreRadius + body.rounding).toBeCloseTo(body.diameter / 2);
    expect(body.rounding).toBeLessThan(0.2);
    const reach = Math.max(...body.probes.map((p) => Math.abs(p.along))) + body.probeRadius;
    const out = Math.max(...body.probes.map((p) => p.out)) + body.probeRadius;
    expect(reach).toBeCloseTo(body.length / 2);
    expect(out).toBeCloseTo(body.diameter / 2);
  });
});

describe("thread-tension shape", () => {
  it("keeps beads from overlapping", () => {
    for (const { model } of [fromText(TUBE), fromFile("02-rivoli-bezel-cup")]) {
      buildTensionShape(model);
      expect(tensionReport(model).overlap).toBeLessThan(0.02);
    }
  });

  it("is the same every time", () => {
    const a = buildTensionShape(fromText(TUBE).model);
    const b = buildTensionShape(fromText(TUBE).model);
    expect([...a.position.values()]).toEqual([...b.position.values()]);
  });

  it("solves each step once, building on the step before", () => {
    const { compiled, model } = fromText(TUBE);
    const first = buildTensionShape(model, { upToStep: 1 });
    expect(first.rounds.map((r) => r.round)).toEqual([1, 2, 3]);
    expect(buildTensionShape(model, { upToStep: 1 })).toBe(first);
    expect(buildTensionShape(model).ids).toHaveLength(compiled.beads.length);
  });

  it("is what solveShape gives for the tension engine, and the profile engine is the other model", () => {
    const { model } = fromText(TUBE);
    expect(solveShape(model, "tension")).toBe(buildTensionShape(model));
    expect(solveShape(model, "profile").position).not.toEqual(solveShape(model, "tension").position);
  });

  it("stands a tube up as a straight wall, half a bead higher each round", () => {
    const shape = buildTensionShape(fromText(TUBE).model);
    const wall = shape.rounds.filter((r) => r.round >= 3 && r.round <= 8);
    for (const r of wall) {
      expect(r.verdict).toBe("wall");
      expect(r.ruffle).toBeLessThan(0.28);
    }
    // Two rounds make one bead diameter (1.6 mm) of height.
    const rise = (wall.at(-1)!.height - wall[0]!.height) / (wall.length - 1);
    expect(rise).toBeGreaterThan(0.65);
    expect(rise).toBeLessThan(0.95);
  });

  // The case one ring per round (the profile model) can't describe:
  // the side with the increases flares out, the other side stays a wall.
  it("flares a tube out on the one side its increases are on", () => {
    const { compiled, model } = fromText(HORN);
    const shape = buildTensionShape(model);
    const at = (id: number) => shape.position.get(id)!;
    const pairs = compiled.beads.filter((b) => b.slotsInGap === 2).map((b) => at(b.id));
    const increase = Math.atan2(pairs.reduce((t, p) => t + p[1], 0), pairs.reduce((t, p) => t + p[0], 0));
    // Mean distance from the axis of a round's beads within 45° of a direction.
    const radius = (round: number, toward: number) => {
      const near = compiled.rounds[round - 1]!.beads.map(at).filter((p) => {
        const off = Math.atan2(p[1], p[0]) - toward;
        return Math.abs(Math.atan2(Math.sin(off), Math.cos(off))) < Math.PI / 4;
      });
      return near.reduce((t, p) => t + Math.hypot(p[0], p[1]), 0) / near.length;
    };
    const flare = (round: number) => radius(round, increase) - radius(round, increase + Math.PI);
    expect(Math.abs(flare(5))).toBeLessThan(0.6);
    expect(flare(11)).toBeGreaterThan(1.2);
  });

  // Reference 2: both edges of the bezel curl inward.
  it("curls the bezel in on both edges", () => {
    const shape = buildTensionShape(fromFile("02-rivoli-bezel-cup").model);
    const round = new Map(shape.rounds.map((r) => [r.round, r]));
    for (const r of [4, 5, 6, 7]) expect(round.get(r)!.verdict).toBe("curls in");
    expect(round.get(5)!.height).toBeGreaterThan(round.get(2)!.height);
    expect(round.get(7)!.height).toBeLessThan(round.get(1)!.height);
    expect(round.get(5)!.radius).toBeLessThan(round.get(2)!.radius - 1);
    expect(round.get(7)!.radius).toBeLessThan(round.get(1)!.radius - 0.5);
  });

  // Reference 1: the outer rounds of the flat circle lie flat. (With nominal
  // bead sizes the middle rounds rise a little, into a shallow bowl.)
  it("lays the outer rounds of the flat circle nearly flat", () => {
    const shape = buildTensionShape(fromFile("01-flat-circle").model);
    for (const r of shape.rounds.filter((r) => r.round >= 5)) expect(r.angle!).toBeLessThan(30);
  });

  // A center start of 4, then a cylinder: the bottom stays a closed disk and
  // the wall stands up straight. New beads rest on the bead below their gap;
  // placing them on the line between their up beads cut across the start
  // ring's corners and scrambled the bottom.
  it("makes Moo Deng a cylinder on a closed bottom", () => {
    const shape = buildTensionShape(fromFile("05-moo-deng").model);
    const wall = shape.rounds.filter((r) => r.round >= 9);
    for (const r of wall) {
      expect(r.verdict).toBe("wall");
      expect(r.ruffle).toBeLessThan(0.56);
    }
    const radii = wall.map((r) => r.radius);
    expect(Math.max(...radii) - Math.min(...radii)).toBeLessThan(1);
    expect(wall.at(-1)!.height - wall[0]!.height).toBeGreaterThan(5);
    expect(shape.rounds.find((r) => r.round === 3)!.angle!).toBeLessThan(25);
  });

  // A real Moo Deng lies almost flat up to round 3. With too little room for
  // the thread in the holes, the model folded the 4-bead start into a saddle.
  it("keeps Moo Deng flat up to round 3, at that step", () => {
    const { compiled, model } = fromFile("05-moo-deng");
    const step = compiled.beads[compiled.rounds[2]!.beads[0]!]!.step;
    const shape = buildTensionShape(model, { upToStep: step });
    const heights = shape.ids.map((id) => shape.position.get(id)![2]);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(0.3);
    for (const id of shape.ids) expect(Math.abs(shape.axis.get(id)![2])).toBeLessThan(Math.sin((10 * Math.PI) / 180));
  });

  // Every round of the cylinder square to one axis: the wall doesn't lean or bend.
  it("stands Moo Deng's wall straight up from its bottom", () => {
    const { compiled, model } = fromFile("05-moo-deng");
    const shape = buildTensionShape(model);
    for (const round of compiled.rounds) {
      const points = round.beads.map((id) => shape.position.get(id)!);
      let n = [0, 0, 0];
      points.forEach((p, i) => {
        const q = points[(i + 1) % points.length]!;
        n = [n[0]! + (p[1] - q[1]) * (p[2] + q[2]), n[1]! + (p[2] - q[2]) * (p[0] + q[0]), n[2]! + (p[0] - q[0]) * (p[1] + q[1])];
      });
      const tilt = (Math.acos(Math.abs(n[2]!) / Math.hypot(...n)) * 180) / Math.PI;
      expect(tilt, `round ${round.round}`).toBeLessThan(10);
    }
  });

  // A small start ring sits tilted to the rest of the piece. The axis comes
  // from every round, so the tube above it still stands straight.
  it("stands a tube on a 4-bead center start up straight", () => {
    const shape = buildTensionShape(
      fromText(`
beads: { A: { size: 11/0, shape: cylinder } }
start: center (1A) x4
rounds:
  2: (1A) x4
  3: (2A) x4
  4: (1A) x8
  5: (2A, 2A, 1A, 2A) x2
  6-17:
    - (1A, 0, 1A, 1A, 0, 1A, 0) x2
    - (2A, 2A, 1A, 2A) x2`).model,
    );
    const wall = shape.rounds.filter((r) => r.round >= 7);
    for (const r of wall) {
      expect(r.verdict).toBe("wall");
      expect(r.radius).toBeGreaterThan(4.5);
      expect(r.radius).toBeLessThan(6);
    }
    expect(wall.at(-1)!.height - wall[0]!.height).toBeGreaterThan(6);
  });
});

describe("closing round", () => {
  // The ball starts from a tied 4-bead ring and ends by pulling its last 4
  // beads into a ring too: so its two ends match.
  it("makes both ends of the beaded ball the same size", () => {
    const shape = buildTensionShape(fromFile("06-beaded-ball").model);
    const radius = new Map(shape.rounds.map((r) => [r.round, r.radius]));
    expect(Math.abs(radius.get(1)! - radius.get(25)!)).toBeLessThan(0.3);
    expect(Math.abs(radius.get(2)! - radius.get(24)!)).toBeLessThan(0.3);
  });
});

describe("filled pieces", () => {
  it("closes the surface it pushes on, with every edge shared by two triangles", () => {
    for (const name of ["06-beaded-ball", "07-whale"]) {
      const { compiled } = fromFile(name);
      const faces = enclosingFaces(compiled, new Set(compiled.beads.map((b) => b.id)));
      const edges = new Set(faces.flatMap(([p, q, r]) => [`${p}>${q}`, `${q}>${r}`, `${r}>${p}`]));
      expect(edges.size).toBe(3 * faces.length);
      for (const edge of edges) expect(edges.has(edge.split(">").reverse().join(">"))).toBe(true);
      expect(new Set(faces.flat()).size).toBe(compiled.beads.length);
    }
  });

  // Without the filling the whale caved in: its bottom settled as a wide
  // rippled disk (2.5 mm of ripple) and its belly folded in.
  it("rounds the whale out instead of squashing it", () => {
    const { model } = fromFile("07-whale");
    const shape = buildTensionShape(model);
    for (const r of shape.rounds) expect(r.ruffle).toBeLessThan(1);
    const radius = shape.rounds.map((r) => r.radius);
    expect(Math.max(...radius)).toBeLessThan(10);
    // Without stretching the thread more than the unfilled whale's worst.
    expect(Math.max(...tensionReport(model).threads.map((t) => t.extra))).toBeLessThan(1.2);
  }, 20_000);

  it("is read from the pattern, checked, and kept by the editor", () => {
    const text = `title: t\nbeads: { A: { size: 11/0, shape: round } }\nfilled: true\nstart: center (1A) x4\nrounds: { 2: (1A) x4 }`;
    expect(parsePattern(text).filled).toBe(true);
    expect(parsePattern(TUBE).filled).toBe(false);
    expect(parsePattern(draftToYaml(draftFromYaml(text))).filled).toBe(true);
    expect(() => parsePattern(text.replace("filled: true", "filled: yes please"))).toThrow(PatternError);
  });
});

describe("thread diameter", () => {
  const withThread = (d: string) => `
title: t
beads: { A: { size: 11/0, shape: cylinder } }
thread_diameter: ${d}
start: tube (1A) x16
rounds: { 3-4: (1A) x8 }`;

  it("is read from the pattern, and kept by the editor", () => {
    expect(parsePattern(withThread("0.15")).threadDiameter).toBe(0.15);
    expect(parsePattern(draftToYaml(draftFromYaml(withThread("0.15")))).threadDiameter).toBe(0.15);
    expect(parsePattern(TUBE).threadDiameter).toBeUndefined();
  });

  it("must be a thread's size in mm", () => {
    expect(() => parsePattern(withThread("2"))).toThrow(PatternError);
    expect(() => parsePattern(withThread("thick"))).toThrow(PatternError);
  });

  it("gives the thread less room in the hole when it is thicker", () => {
    const thin = buildTensionShape(fromText(withThread("0.1")).model);
    const thick = buildTensionShape(fromText(withThread("0.5")).model);
    expect(thin.position).not.toEqual(thick.position);
  });
});
