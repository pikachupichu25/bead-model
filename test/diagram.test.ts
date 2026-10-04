import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveBeads } from "../src/catalog/catalog.js";
import { loadCatalog } from "../src/catalog/load-files.js";
import { layoutPattern } from "../src/diagram/layout.js";
import { renderChartSheetSvg, renderChartSvg, renderDiagramSvg, renderSheetSvg, renderStepSvg } from "../src/diagram/svg.js";
import { compilePattern } from "../src/pattern/compile.js";
import { parsePattern } from "../src/pattern/load.js";

const catalog = loadCatalog("catalog/beads");

function build(name: string) {
  const pattern = parsePattern(readFileSync(`patterns/${name}.peyote.yaml`, "utf8"));
  const compiled = compilePattern(pattern);
  const beads = resolveBeads(pattern.beads, catalog);
  return { compiled, beads, layout: layoutPattern(compiled, beads) };
}

type Vec = [number, number];

/** The four corners of a placed bead (its local x is radial, y along the ring). */
function corners(b: { x: number; y: number; theta: number; radial: number; tangential: number }): Vec[] {
  const r: Vec = [Math.cos(b.theta), -Math.sin(b.theta)];
  const t: Vec = [-Math.sin(b.theta), -Math.cos(b.theta)];
  return [
    [1, 1],
    [1, -1],
    [-1, -1],
    [-1, 1],
  ].map(([i, j]) => [
    b.x + (r[0] * i! * b.radial) / 2 + (t[0] * j! * b.tangential) / 2,
    b.y + (r[1] * i! * b.radial) / 2 + (t[1] * j! * b.tangential) / 2,
  ]);
}

/**
 * Separating-axis test for two convex polygons: the largest gap between their
 * shadows on any edge normal. Negative means they overlap.
 */
function separation(a: Vec[], b: Vec[]): number {
  let best = -Infinity;
  for (const poly of [a, b]) {
    poly.forEach((p, i) => {
      const q = poly[(i + 1) % poly.length]!;
      const len = Math.hypot(q[0] - p[0], q[1] - p[1]);
      const n: Vec = [(q[1] - p[1]) / len, -(q[0] - p[0]) / len];
      const proj = (poly2: Vec[]) => poly2.map((v) => v[0] * n[0] + v[1] * n[1]);
      const pa = proj(a);
      const pb = proj(b);
      best = Math.max(best, Math.min(...pb) - Math.max(...pa), Math.min(...pa) - Math.max(...pb));
    });
  }
  return best;
}

/** Smallest angle between two directions, radians. */
const angleBetween = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

describe.each(["01-flat-circle", "02-rivoli-bezel-cup", "03-flat-triangle", "04-christmas-mug-trinket-box"])(
  "layout of %s",
  (name) => {
    const { compiled, layout } = build(name);

    it("places every bead", () => {
      expect(layout.beads).toHaveLength(compiled.beads.length);
      for (const b of layout.beads) expect(Number.isFinite(b.x) && Number.isFinite(b.y)).toBe(true);
    });

    it("doesn't overlap any two beads, in the same round or different rounds", () => {
      const rects = layout.beads.map(corners);
      const overlaps: string[] = [];
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          if (separation(rects[i]!, rects[j]!) < -1e-9) {
            const [a, b] = [layout.beads[i]!, layout.beads[j]!];
            overlaps.push(`round ${a.round} bead ${a.id} / round ${b.round} bead ${b.id}`);
          }
        }
      }
      expect(overlaps).toEqual([]);
    });

    it("keeps beads apart with no spacing at all", () => {
      const { compiled, beads } = build(name);
      const tight = layoutPattern(compiled, beads, { roundGap: 0, beadGap: 0 });
      const rects = tight.beads.map(corners);
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) expect(separation(rects[i]!, rects[j]!)).toBeGreaterThan(-1e-9);
      }
    });

    it("puts front rounds further out than the round they're worked from", () => {
      for (const round of compiled.rounds) {
        const first = compiled.beads[round.beads[0]!]!;
        if (!first.between) continue;
        const up = compiled.beads[first.between[0]]!;
        const outward = layout.radius.get(round.round)! > layout.radius.get(up.round)!;
        expect(outward).toBe(round.edge === "front");
      }
    });
  },
);

describe("spacing", () => {
  it("moves rounds further apart as roundGap grows", () => {
    const { compiled, beads } = build("03-flat-triangle");
    const near = layoutPattern(compiled, beads, { roundGap: 0.1 });
    const far = layoutPattern(compiled, beads, { roundGap: 1 });
    const step = (l: typeof near) => l.radius.get(5)! - l.radius.get(4)!;
    expect(step(far) - step(near)).toBeGreaterThan(0.85);
  });

  it("makes rings bigger as beadGap grows", () => {
    const { compiled, beads } = build("02-rivoli-bezel-cup");
    const near = layoutPattern(compiled, beads, { beadGap: 0 });
    const far = layoutPattern(compiled, beads, { beadGap: 0.5 });
    expect(far.radius.get(1)!).toBeGreaterThan(near.radius.get(1)! + 1);
  });
});

describe("layout keeps the peyote offset", () => {
  it("puts each bead of an even round midway between its up beads", () => {
    const { compiled, layout } = build("02-rivoli-bezel-cup");
    const round3 = compiled.rounds.find((r) => r.round === 3)!;
    for (const id of round3.beads) {
      const [left, right] = compiled.beads[id]!.between!;
      const a = layout.beads[left]!.theta;
      const b = layout.beads[right]!.theta;
      const middle = Math.atan2(Math.sin(a) + Math.sin(b), Math.cos(a) + Math.cos(b));
      expect(angleBetween(layout.beads[id]!.theta, middle)).toBeLessThan(1e-6);
    }
  });
});

describe("svg", () => {
  it("numbers each bead of the step and marks the step-up", () => {
    const input = build("03-flat-triangle");
    const svg = renderStepSvg(input, 3);
    expect(svg).toContain("Round 4 of 10: 12 beads (+3 on round 3)");
    for (let n = 1; n <= 12; n++) expect(svg).toMatch(new RegExp(`>${n}</text>`));
    expect(svg).not.toMatch(/>13<\/text>/);
    expect(svg.match(/<circle [^>]*stroke="#d62728"/g)).toHaveLength(1);
  });

  it("draws the thread path only when asked", () => {
    const input = build("03-flat-triangle");
    const svg = renderDiagramSvg(input, 3, { thread: true });
    expect(svg).toContain('class="thread"');
    // A start dot, then only two arrowheads: into the first bead, and the thread going out.
    expect(svg.match(/class="thread-(start|in|out)"/g)).toEqual([
      'class="thread-start"',
      'class="thread-in"',
      'class="thread-out"',
    ]);
    expect(svg.match(/<g class="thread-(in|out)"><path /g)).toHaveLength(2);
    expect(renderDiagramSvg(input, 3, { thread: false })).not.toContain('class="thread"');
  });

  it("draws a tube start as one step with both rounds numbered 1-32", () => {
    const input = build("02-rivoli-bezel-cup");
    const svg = renderStepSvg(input, 0);
    expect(svg).toContain("Rounds 1–2 of 7: 32 beads");
    expect(svg).toMatch(/>32<\/text>/);
    expect(renderStepSvg(input, 1)).toContain("Round 3 of 7: 16 beads (+0 on round 2)");
  });

  it("shows tension, edge and notes", () => {
    const input = build("02-rivoli-bezel-cup");
    expect(renderStepSvg(input, 3)).toContain("Tight tension · Note: insert the rivoli after this round");
    expect(renderStepSvg(input, 4)).toContain("Worked from the back edge");
  });

  it("draws upcoming rounds only when asked", () => {
    const input = build("03-flat-triangle");
    const beadsDrawn = (svg: string) => svg.match(/data-bead=/g)!.length;
    expect(beadsDrawn(renderDiagramSvg(input, 0, { upcoming: true }))).toBe(input.compiled.beads.length);
    expect(beadsDrawn(renderDiagramSvg(input, 0, { upcoming: false }))).toBe(3);
  });

  it("draws every step on the sheet", () => {
    const svg = renderSheetSvg(build("03-flat-triangle"));
    for (let r = 1; r <= 10; r++) expect(svg).toContain(`Round ${r}: ${3 * r} beads`);
    expect(renderSheetSvg(build("02-rivoli-bezel-cup"))).toContain("Rounds 1–2: 32 beads");
  });
});

describe("design chart", () => {
  it("draws every bead once, in full color, tagged with its round", () => {
    const input = build("03-flat-triangle");
    const svg = renderChartSvg(input);
    const beads = [...svg.matchAll(/data-bead="(\d+)" data-round="(\d+)"[^>]*opacity="([\d.]+)"/g)];
    expect(beads).toHaveLength(input.compiled.beads.length);
    expect(beads.every((m) => m[3] === "1")).toBe(true);
    expect(beads.every((m) => Number(m[2]) === input.compiled.beads[Number(m[1])]!.round)).toBe(true);
  });

  it("prints the chart with the bead list and every step", () => {
    const input = build("02-rivoli-bezel-cup");
    const sheet = renderChartSheetSvg(input);
    expect(sheet).toContain("Peyote bezel for 12 mm rivoli");
    for (const step of input.compiled.steps) {
      expect(sheet).toContain(step.rounds.length > 1 ? "Rounds 1–2" : `Round ${step.rounds[0]!.round} ·`);
    }
    expect(sheet).toContain("insert the rivoli after this round");
  });
});
