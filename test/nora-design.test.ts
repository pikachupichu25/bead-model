import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadCatalog } from "../src/catalog/load-files.js";
import { resolveFlatBeads } from "../src/flat/beads.js";
import { beadList, renderNoraChartSvg } from "../src/nora/chart.js";
import {
  asymmetricSlots,
  clearGroup,
  completeGroup,
  countBeads,
  emptyDesign,
  floodFill,
  formatRing,
  looseSlots,
  makeSymmetric,
  mirrorGroups,
  mirrorSlots,
  type NoraDesign,
  openGroups,
  parts,
  ringLines,
  setSlots,
  type Symmetry,
  withMirrors,
} from "../src/nora/design.js";
import { designFromYaml, designToYaml, NoraFormatError } from "../src/nora/format.js";
import { type Group, groupSlots, isEight, isSlot, slotAngle, slotKey } from "../src/nora/net.js";

const catalog = loadCatalog("catalog/beads");

const FLOWER = `kind: nora-net
title: Flower
bead: miyuki round 8
beads:
  G: { color: lime green, display: { rgb: "#8cc63f" } }
  R: { color: red, display: { rgb: "#e0241b" } }
symmetry: { mode: left-right, column: 0, row: 0 }
origin: [-3, -3]
slots: |
  ...R
  .+R+R
  .RGGGR
  R+G+G+R
  .RGGGR
  .+R+R
  ...R
`;

/** A green 8 at (0, 0) with red 4s on its four sides, painted ring by ring. */
function flower(): NoraDesign {
  let d: NoraDesign = { ...emptyDesign(), beads: new Map<string, unknown>([["G", "g"], ["R", "r"]]), symmetry: { mode: "off", column: 0, row: 0 } };
  for (const g of [{ i: 0, j: -1 }, { i: 1, j: 0 }, { i: 0, j: 1 }, { i: -1, j: 0 }]) d = setSlots(d, groupSlots(g), "R");
  return setSlots(d, groupSlots({ i: 0, j: 0 }), "G");
}

describe("painting", () => {
  it("shares beads between rings: the ring painted last colors the shared ones", () => {
    const counts = countBeads(flower());
    expect(counts.get("G")).toBe(8);
    expect(counts.get("R")).toBe(12);
  });

  it("fills connected beads of one color, and nothing from an empty slot", () => {
    const d = flower();
    const filled = floodFill(d, { x: 0, y: -3 }, "G");
    expect(countBeads(filled).get("R")).toBe(9);
    expect(floodFill(d, { x: 7, y: 7 }, "G")).toBe(d);
  });
});

describe("symmetry", () => {
  const modes: Symmetry[] = [
    { mode: "left-right", column: 2, row: 0 },
    { mode: "up-down", column: 0, row: -1 },
    { mode: "both", column: 1, row: 3 },
  ];

  it("keeps 8s on 8s and slots on slots for any axis", () => {
    for (const sym of modes) {
      for (let i = -3; i <= 3; i++) {
        for (let j = -3; j <= 3; j++) {
          for (const m of mirrorGroups({ i, j }, sym)) expect(isEight(m)).toBe(isEight({ i, j }));
        }
      }
      for (let x = -5; x <= 5; x++) {
        for (let y = -5; y <= 5; y++) {
          if (!isSlot(x, y)) continue;
          for (const m of mirrorSlots({ x, y }, sym)) expect(isSlot(m.x, m.y)).toBe(true);
        }
      }
    }
  });

  it("mirrors / to \\ and leaves slots on the axis where they are", () => {
    const sym: Symmetry = { mode: "left-right", column: 0, row: 0 };
    const [, m] = mirrorSlots({ x: 1, y: 1 }, sym);
    expect(slotAngle(m!)).toBe(-slotAngle({ x: 1, y: 1 }));
    expect(mirrorSlots({ x: 0, y: 1 }, sym)).toEqual([{ x: 0, y: 1 }]);
  });

  it("paints in four places with both axes on", () => {
    expect(withMirrors([{ x: 3, y: 2 }], { mode: "both", column: 0, row: 0 })).toHaveLength(4);
  });

  it("makes a design symmetric, so nothing is off", () => {
    let d: NoraDesign = { ...flower(), symmetry: { mode: "left-right", column: 1, row: 0 } };
    expect(asymmetricSlots(d).length).toBeGreaterThan(0);
    d = makeSymmetric(d, "left");
    expect(asymmetricSlots(d)).toEqual([]);
  });

  it("finds nothing off in a symmetric flower", () => {
    expect(asymmetricSlots({ ...flower(), symmetry: { mode: "both", column: 0, row: 0 } })).toEqual([]);
  });
});

describe("stitchability", () => {
  it("finds rings that aren't closed, and completes them", () => {
    let d = flower();
    // The 8s on the flower's diagonals are open, but every bead is held by a closed ring.
    expect(openGroups(d)).toHaveLength(0);
    d = setSlots(d, [{ x: 0, y: -3 }], undefined);
    expect(looseSlots(d)).toHaveLength(2);
    expect(openGroups(d)).toContainEqual({ i: 0, j: -1 });
    d = completeGroup(d, { i: 0, j: -1 }, "R");
    expect(openGroups(d)).toHaveLength(0);
  });

  it("clears a ring but keeps the beads a complete neighbor needs", () => {
    const d = clearGroup(flower(), { i: 0, j: -1 });
    expect(countBeads(d).get("G")).toBe(8);
    expect(countBeads(d).get("R")).toBe(9);
  });

  it("counts two separate flowers as two parts", () => {
    const one = flower();
    let d = one;
    const far: Group[] = [{ i: 6, j: -1 }, { i: 7, j: 0 }, { i: 6, j: 1 }, { i: 5, j: 0 }, { i: 6, j: 0 }];
    for (const g of far) d = setSlots(d, groupSlots(g), "R");
    expect(parts(one)).toHaveLength(1);
    expect(parts(d)).toHaveLength(2);
  });

  it("lists rings with their beads in order", () => {
    const lines = ringLines(flower()).map(formatRing);
    expect(lines).toContain("Ring 0, −1 (4): 3R, 1G");
    expect(lines).toContain("Ring 0, 0 (8): 8G");
  });
});

describe("format", () => {
  it("reads the flower from the spec", () => {
    const d = designFromYaml(FLOWER);
    expect([...d.slots].sort()).toEqual([...flower().slots].sort());
    expect(d.symmetry).toEqual({ mode: "left-right", column: 0, row: 0 });
  });

  it("writes and reads back the same design", () => {
    const d = designFromYaml(FLOWER);
    const again = designFromYaml(designToYaml(d));
    expect([...again.slots].sort()).toEqual([...d.slots].sort());
    expect(designToYaml(again)).toBe(designToYaml(d));
  });

  it("reads and writes an empty design", () => {
    const d = emptyDesign();
    expect(designFromYaml(designToYaml(d)).slots.size).toBe(0);
  });

  it("catches a shifted line and an unknown key", () => {
    expect(() => designFromYaml(FLOWER.replace(".+R+R\n", "+R+R\n"))).toThrow(/line 2, character 1/);
    expect(() => designFromYaml(FLOWER.replace("...R\n", "...X\n"))).toThrow(NoraFormatError);
    expect(() => designFromYaml(FLOWER.replace("...R\n", "...X\n"))).toThrow(/no bead "X"/);
  });

  it("loads every example", () => {
    const dir = "patterns/nora";
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".nora.yaml"))) {
      const text = readFileSync(`${dir}/${file}`, "utf8");
      const d = designFromYaml(text);
      expect(resolveFlatBeads(d, catalog).problems, file).toEqual([]);
      expect(designToYaml(designFromYaml(designToYaml(d)))).toBe(designToYaml(d));
    }
  });
});

describe("chart", () => {
  it("counts each shared bead once and draws every bead", () => {
    const d = designFromYaml(FLOWER);
    const { size, beads } = resolveFlatBeads(d, catalog);
    const list = beadList(d, beads);
    expect(list.rows.map((r) => [r.key, r.count])).toEqual([["G", 8], ["R", 12]]);
    const svg = renderNoraChartSvg({ design: d, beads, d: size.box.d, w: size.box.w, shape: size.shape, sizeLabel: size.label });
    expect(svg.match(/rotate\(/g)).toHaveLength(20);
    expect(svg).toContain("Beads to buy");
  });

  it("keys slots the way the file does", () => {
    expect(designFromYaml(FLOWER).slots.get(slotKey(0, -3))).toBe("R");
  });
});
