import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveBeads } from "../src/catalog/catalog.js";
import { loadCatalog } from "../src/catalog/load-files.js";
import { compilePattern } from "../src/pattern/compile.js";
import { parsePattern } from "../src/pattern/load.js";
import { buildContacts } from "../src/shape/contacts.js";
import { roundProfiles } from "../src/shape/profile.js";
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

describe("contacts", () => {
  it("rests a tube's round 3 bead on the round 1 bead between its up beads", () => {
    const { compiled, beads } = fromText(`
beads: { A: { size: 11/0, shape: cylinder } }
start: tube (1A) x8
rounds: { 3: (1A) x4 }`);
    const { below, links } = buildContacts(compiled, beads);
    const first = compiled.rounds[2]!.beads[0]!;
    const w = below.get(first)!;
    expect(compiled.beads[w]!.round).toBe(1);
    // Strung in order, the bead below sits between the two up beads.
    const [u, v] = compiled.beads[first]!.between!;
    expect([u, v].sort((a, b) => a - b)).toEqual([w - 1, w + 1]);
    const column = links.find((l) => l.kind === "column" && l.b === first)!;
    expect(column.rest).toBeCloseTo(1.6); // two 11/0 cylinders side by side
  });

  it("doesn't hold apart up beads that already touch end to end", () => {
    const { compiled, beads } = fromText(`
beads: { A: { size: 11/0, shape: round } }
start: center 3A
rounds: { 2: (1A) x3 }`);
    const { links } = buildContacts(compiled, beads);
    expect(links.filter((l) => l.kind === "gap")).toEqual([]);
  });
});

describe("growth from the counts", () => {
  it("is 0 for a tube wall and negative where smaller beads pull in (bezel)", () => {
    const { model } = fromFile("02-rivoli-bezel-cup");
    const growth = new Map(model.profiles.map((p) => [p.round, p.growth]));
    expect(growth.get(1)).toBeUndefined();
    expect(growth.get(3)).toBeCloseTo(0);
    for (const r of [4, 5, 6, 7]) expect(growth.get(r)).toBeLessThan(-0.15);
  });

  it("is close to 1 for the evenly increased flat circle", () => {
    const { model } = fromFile("01-flat-circle");
    for (const r of [4, 5, 6]) expect(model.profiles.find((p) => p.round === r)!.growth).toBeCloseTo(0.96, 1);
  });

  it("is the same every round for the triangle: +3 beads a round makes the row 6 beads longer", () => {
    const { compiled, beads } = fromFile("03-flat-triangle");
    const profiles = roundProfiles(compiled, beads);
    // Row length grows by 12 bead lengths (with slack) over 2 rounds, 2 bead diameters across.
    const expected = (12 * (1.45 + 0.08)) / (2 * Math.PI * 2.0);
    for (const p of profiles.slice(2)) expect(p.growth).toBeCloseTo(expected, 5);
  });
});

describe("3D shape", () => {
  it.each(PATTERNS)("%s: solves with every thread link within 10%% of its length", (name) => {
    const shape = buildShape(fromFile(name).model);
    expect(shape.strain).toBeLessThan(0.1);
    for (const a of shape.axis.values()) expect(Math.hypot(...a)).toBeCloseTo(1);
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

  // Reference 1: a flat disk. The outer rounds lie flat; see docs/shape-model.md
  // for why the model lifts the middle into a shallow dome.
  it("lays the outer rounds of the flat circle flat", () => {
    const shape = buildShape(fromFile("01-flat-circle").model);
    const round = new Map(shape.rounds.map((r) => [r.round, r]));
    expect(round.get(6)!.verdict).toBe("flat");
    expect(round.get(7)!.verdict).toBe("flat");
  });

  // Reference 3: a triangle. Corners stick out past the sides, and it stays
  // much flatter than it is wide (the model warps it a little; see the docs).
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

  // A small start ring sits tilted to the rest of the piece. The axis comes
  // from every round, so the tube above it still stands straight.
  it("stands a tube on a 4-bead center start up straight", () => {
    const shape = buildShape(
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
      expect(r.radius).toBeGreaterThan(3.5);
      expect(r.radius).toBeLessThan(5.5);
    }
    expect(wall.at(-1)!.height - wall[0]!.height).toBeGreaterThan(6);
  });
});
