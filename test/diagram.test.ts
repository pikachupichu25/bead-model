import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolveBeads } from "../src/catalog/catalog.js";
import { loadCatalog } from "../src/catalog/load-files.js";
import { layoutPattern } from "../src/diagram/layout.js";
import { renderRoundSvg, renderSheetSvg } from "../src/diagram/svg.js";
import { compilePattern } from "../src/pattern/compile.js";
import { parsePattern } from "../src/pattern/load.js";

const catalog = loadCatalog("catalog/beads");

function build(name: string) {
  const pattern = parsePattern(readFileSync(`patterns/${name}.peyote.yaml`, "utf8"));
  const compiled = compilePattern(pattern);
  const beads = resolveBeads(pattern.beads, catalog);
  return { compiled, beads, layout: layoutPattern(compiled, beads) };
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

    it("doesn't overlap beads within a round", () => {
      for (const round of compiled.rounds) {
        const placed = round.beads.map((id) => layout.beads[id]!).sort((a, b) => a.theta - b.theta);
        placed.forEach((bead, i) => {
          const next = placed[(i + 1) % placed.length]!;
          if (next === bead) return;
          const gap = angleBetween(bead.theta, next.theta) * bead.radius;
          expect(gap).toBeGreaterThanOrEqual((bead.tangential + next.tangential) / 2 - 1e-9);
        });
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
  it("numbers each bead of the round and marks the step-up", () => {
    const input = build("03-flat-triangle");
    const svg = renderRoundSvg(input, 4);
    expect(svg).toContain("Round 4 of 10: 12 beads (+3 on round 3)");
    for (let n = 1; n <= 12; n++) expect(svg).toMatch(new RegExp(`>${n}</text>`));
    expect(svg).not.toMatch(/>13<\/text>/);
    expect(svg.match(/<circle /g)).toHaveLength(1);
  });

  it("shows tension, edge and notes", () => {
    const svg = renderRoundSvg(build("02-rivoli-bezel-cup"), 5);
    expect(svg).toContain("Tight tension · Note: insert the rivoli after this round");
    expect(renderRoundSvg(build("02-rivoli-bezel-cup"), 6)).toContain("Worked from the back edge");
  });

  it("draws every round on the sheet", () => {
    const svg = renderSheetSvg(build("03-flat-triangle"));
    for (let r = 1; r <= 10; r++) expect(svg).toContain(`Round ${r}: ${3 * r} beads`);
  });
});
