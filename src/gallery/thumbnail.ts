// A small picture of a design, for the cards on the Home page and the profile:
// every bead in its color, no numbers or labels. Works from the design file, in
// any technique.

import type { Catalog } from "../catalog/catalog.js";
import { resolveBeads } from "../catalog/catalog.js";
import type { DesignKind } from "../collection/designs.js";
import { layoutPattern } from "../diagram/layout.js";
import { beadCorner, darken, fmt, renderChartSvg } from "../diagram/svg.js";
import { resolveFlatBeads } from "../flat/beads.js";
import { designFromYaml as flatFromYaml } from "../flat/format.js";
import { paintedBounds, parseCellKey } from "../flat/grid.js";
import { designFromYaml as noraFromYaml } from "../nora/format.js";
import { netSize, parseSlotKey, slotAngle, slotCenter } from "../nora/net.js";
import { compilePattern } from "../pattern/compile.js";
import { parsePattern } from "../pattern/load.js";

/** An <svg> that scales to its box, or undefined for a design with no beads yet. Throws on a design it can't read. */
export function thumbnailSvg(kind: DesignKind, yaml: string, catalog: Catalog): string | undefined {
  if (kind === "peyote") return peyote(yaml, catalog);
  if (kind === "flat") return flat(yaml, catalog);
  return nora(yaml, catalog);
}

function peyote(yaml: string, catalog: Catalog): string {
  const compiled = compilePattern(parsePattern(yaml));
  const beads = resolveBeads(compiled.pattern.beads, catalog);
  return renderChartSvg({ compiled, beads, layout: layoutPattern(compiled, beads) }, { stepUps: false });
}

function flat(yaml: string, catalog: Catalog): string | undefined {
  const design = flatFromYaml(yaml);
  const area = paintedBounds(design);
  if (!area) return undefined;
  const { size, beads } = resolveFlatBeads(design, catalog);
  const { w, d } = size.box;
  const [rx, ry] = beadCorner(size.shape, w * 0.92, d * 0.92);
  const rects = [...design.cells].map(([cell, key]) => {
    const { c, h } = parseCellKey(cell);
    const rgb = beads.get(key)?.display.rgb ?? "#999999";
    const x = (c - area.c0) * w + w * 0.04;
    const y = ((h - area.h0) * d) / 2 + d * 0.04;
    return `<rect x="${fmt(x)}" y="${fmt(y)}" width="${fmt(w * 0.92)}" height="${fmt(d * 0.92)}" rx="${fmt(rx)}" ry="${fmt(ry)}" fill="${rgb}" stroke="${darken(rgb)}" stroke-width="${fmt(d * 0.04)}"/>`;
  });
  const width = (area.c1 - area.c0 + 1) * w;
  const height = ((area.h1 - area.h0 + 2) * d) / 2;
  return svg(-d / 2, -d / 2, width + d, height + d, rects);
}

function nora(yaml: string, catalog: Catalog): string | undefined {
  const design = noraFromYaml(yaml);
  if (design.slots.size === 0) return undefined;
  const { size, beads } = resolveFlatBeads(design, catalog);
  const { w, d } = size.box;
  const net = netSize(d);
  const bw = w * 0.92;
  const bd = d * 0.92;
  const [rx, ry] = beadCorner(size.shape, bw, bd);
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const rects = [...design.slots].map(([key, bead]) => {
    const slot = parseSlotKey(key);
    const c = slotCenter(slot, net);
    x0 = Math.min(x0, c.x);
    y0 = Math.min(y0, c.y);
    x1 = Math.max(x1, c.x);
    y1 = Math.max(y1, c.y);
    const deg = (slotAngle(slot) * 180) / Math.PI;
    const rgb = beads.get(bead)?.display.rgb ?? "#999999";
    return `<rect x="${fmt(-bw / 2)}" y="${fmt(-bd / 2)}" width="${fmt(bw)}" height="${fmt(bd)}" rx="${fmt(rx)}" ry="${fmt(ry)}" transform="translate(${fmt(c.x)} ${fmt(c.y)}) rotate(${fmt(deg)})" fill="${rgb}" stroke="${darken(rgb)}" stroke-width="${fmt(d * 0.04)}"/>`;
  });
  const r = Math.max(w, d);
  return svg(x0 - r, y0 - r, x1 - x0 + 2 * r, y1 - y0 + 2 * r, rects);
}

function svg(x: number, y: number, width: number, height: number, body: string[]): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${fmt(x)} ${fmt(y)} ${fmt(width)} ${fmt(height)}" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" aria-hidden="true">${body.join("")}</svg>`;
}
