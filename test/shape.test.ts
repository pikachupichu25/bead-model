import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveBeads } from "../src/catalog/catalog.js";
import { loadCatalog } from "../src/catalog/load-files.js";
import { compilePattern } from "../src/pattern/compile.js";
import { parsePattern } from "../src/pattern/load.js";
import { perimeterFactor, roundProfiles } from "../src/shape/profile.js";
import { buildShape, shapeModel } from "../src/shape/shape.js";

const catalog = loadCatalog("catalog/beads");

function fromText(text: string) {
  const pattern = parsePattern(text);
  const compiled = compilePattern(pattern);
  const beads = resolveBeads(pattern.beads, catalog);
  return { compiled, beads, model: shapeModel(compiled, beads) };
}
const fromFile = (name: string) => fromText(readFileSync(`patterns/${name}.peyote.yaml`, "utf8"));

const PATTERNS = ["01-flat-circle", "02-rivoli-bezel-cup", "03-flat-triangle", "04-christmas-mug-trinket-box"];

describe("corners", () => {
  it("has the flat perimeter of a circle, or of a polygon round its inradius", () => {
    expect(perimeterFactor()).toBeCloseTo(2 * Math.PI);
    expect(perimeterFactor(3)).toBeCloseTo(6 * Math.sqrt(3));
    expect(perimeterFactor(4)).toBeCloseTo(8);
    expect(perimeterFactor(1000)).toBeCloseTo(2 * Math.PI, 3);
  });

  it("finds the triangle's 3 fixed corners, and none where the increases move round", () => {
    expect(fromFile("03-flat-triangle").model.profile.corners).toBe(3);
    for (const name of ["01-flat-circle", "02-rivoli-bezel-cup", "04-christmas-mug-trinket-box"]) {
      expect(fromFile(name).model.profile.corners).toBeUndefined();
    }
  });
});

describe("growth from the counts", () => {
  it("is 0 for a tube wall and negative where smaller beads pull in (bezel)", () => {
    const { model } = fromFile("02-rivoli-bezel-cup");
    const growth = new Map(model.profile.rounds.map((p) => [p.round, p.growth]));
    expect(growth.get(1)).toBeUndefined();
    expect(growth.get(3)).toBeCloseTo(0);
    for (const r of [4, 5, 6, 7]) expect(growth.get(r)).toBeLessThan(-0.15);
  });

  it("is close to 1 for the evenly increased flat circle", () => {
    const { model } = fromFile("01-flat-circle");
    for (const r of [4, 5, 6]) expect(model.profile.rounds.find((p) => p.round === r)!.growth).toBeCloseTo(0.96, 1);
  });

  it("is the same every round for the triangle, compared to a flat triangle", () => {
    const { compiled, beads } = fromFile("03-flat-triangle");
    const { rounds } = roundProfiles(compiled, beads);
    // Row length grows by 12 bead lengths (with slack) over 2 rounds, 2 bead diameters across.
    const expected = (12 * (1.45 + 0.08)) / (6 * Math.sqrt(3) * 2.0);
    for (const p of rounds.slice(2)) expect(p.growth).toBeCloseTo(expected, 5);
    for (const p of rounds.slice(1)) expect(p.verdict).toBe("flat");
  });

  it("is the cosine of the fabric's angle", () => {
    for (const p of fromFile("01-flat-circle").model.profile.rounds.filter((p) => p.growth !== undefined)) {
      const g = Math.max(-1, Math.min(1, p.growth!));
      expect(Math.cos((p.angle! * Math.PI) / 180)).toBeCloseTo(g);
    }
  });

  it("ruffles a row longer than fits flat, so the wavy ring is as long as the row", () => {
    const { model } = fromFile("01-flat-circle");
    const p = model.profile.rounds.find((r) => r.round === 7)!;
    expect(p.verdict).toBe("ruffles");
    expect(p.ruffle).toBeGreaterThan(0);
    // Length of z = A cos(mθ) round a circle of radius r, summed finely.
    let length = 0;
    const n = 20000;
    for (let i = 0; i < n; i++) {
      const [t0, t1] = [(2 * Math.PI * i) / n, (2 * Math.PI * (i + 1)) / n];
      const dz = p.ruffle * (Math.cos(p.waves * t1) - Math.cos(p.waves * t0));
      length += Math.hypot(p.radius * (t1 - t0), dz);
    }
    // The ruffle height uses the small-wave approximation, a little short for
    // big ruffles (this one has 24% more row than fits flat).
    expect(Math.abs(length / p.rowLength - 1)).toBeLessThan(0.05);
  });
});

describe("3D shape", () => {
  it.each(PATTERNS)("%s: places every bead, with a unit hole direction", (name) => {
    const { compiled, model } = fromFile(name);
    const shape = buildShape(model);
    expect(shape.ids.length).toBe(compiled.beads.length);
    for (const p of shape.position.values()) expect(p.every(Number.isFinite)).toBe(true);
    for (const a of shape.axis.values()) expect(Math.hypot(...a)).toBeCloseTo(1);
  });

  it("only adds beads when stepping: earlier beads stay where they were", () => {
    const { compiled, model } = fromFile("02-rivoli-bezel-cup");
    const whole = buildShape(model);
    for (let step = 0; step < compiled.steps.length; step++) {
      const part = buildShape(model, { upToStep: step });
      for (const id of part.ids) expect(part.position.get(id)).toEqual(whole.position.get(id));
    }
  });

  it("is the same every time", () => {
    const { model } = fromFile("03-flat-triangle");
    const a = buildShape(model);
    const b = buildShape(model);
    expect([...a.position.values()]).toEqual([...b.position.values()]);
  });

  it("can stop at a step", () => {
    const { compiled, model } = fromFile("02-rivoli-bezel-cup");
    const start = buildShape(model, { upToStep: 0 });
    expect(start.ids).toEqual([...compiled.rounds[0]!.beads, ...compiled.rounds[1]!.beads].sort((a, b) => a - b));
    expect(start.rounds.map((r) => r.round)).toEqual([1, 2]);
    expect(buildShape(model, { upToStep: 2 }).rounds.map((r) => r.round)).toEqual([1, 2, 3, 4]);
  });

  // Reference 2: a short tube whose edges curl inward on both sides.
  it("curls the bezel in on both edges, around an opening smaller than the band", () => {
    const shape = buildShape(fromFile("02-rivoli-bezel-cup").model);
    const round = new Map(shape.rounds.map((r) => [r.round, r]));
    expect(round.get(3)!.verdict).toBe("wall");
    for (const r of [4, 5, 6, 7]) expect(round.get(r)!.verdict).toBe("curls in");
    // Front rounds above the start ring, back rounds below.
    expect(round.get(5)!.height).toBeGreaterThan(round.get(2)!.height);
    expect(round.get(7)!.height).toBeLessThan(round.get(2)!.height);
    // The lips close in by at least 1.5 mm each side.
    expect(round.get(5)!.radius).toBeLessThan(round.get(2)!.radius - 1.5);
    expect(round.get(7)!.radius).toBeLessThan(round.get(1)!.radius - 1.5);
  });

  // Reference 1: a flat disk. See docs/shape-model.md for why the model
  // stands the center up as a short wall, and why round 7 ruffles.
  it("lays the flat circle's rounds 4 to 6 flat", () => {
    const shape = buildShape(fromFile("01-flat-circle").model);
    const round = new Map(shape.rounds.map((r) => [r.round, r]));
    for (const r of [4, 5, 6]) expect(round.get(r)!.verdict).toBe("flat");
  });

  // Reference 3: a triangle. Corners stick out past the sides, and it stays
  // much flatter than it is wide (a shallow cone with nominal bead sizes; see the docs).
  it("gives the triangle three corners and keeps it fairly flat", () => {
    const { compiled, model } = fromFile("03-flat-triangle");
    const shape = buildShape(model);
    const last = compiled.rounds.at(-1)!.beads;
    const radius = (id: number) => Math.hypot(shape.position.get(id)![0], shape.position.get(id)![1]);
    const corners = last.filter((id) => compiled.beads[id]!.key === "A").map(radius);
    const sides = last.filter((id) => compiled.beads[id]!.key === "B").map(radius);
    expect(Math.min(...corners)).toBeGreaterThan(Math.min(...sides) + 2);

    const heights = shape.ids.map((id) => shape.position.get(id)![2]);
    const width = 2 * Math.max(...shape.ids.map(radius));
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThan(width / 2.5);
  });
});
