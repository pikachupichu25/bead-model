import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadCatalog } from "../src/catalog/load-files.js";
import { designToYaml } from "../src/flat/format.js";
import { emptyDesign } from "../src/flat/grid.js";
import { thumbnailSvg } from "../src/gallery/thumbnail.js";

const catalog = loadCatalog("catalog/beads");
const read = (path: string) => readFileSync(path, "utf8");

describe("design thumbnails", () => {
  it("draws every technique's example", () => {
    const cases = [
      ["peyote", "patterns/07-whale.peyote.yaml"],
      ["flat", "patterns/flat/heart-band.flat-peyote.yaml"],
      ["nora", "patterns/nora/flower.nora.yaml"],
    ] as const;
    for (const [kind, path] of cases) {
      const svg = thumbnailSvg(kind, read(path), catalog);
      expect(svg, path).toMatch(/^<svg [^>]*viewBox="[-\d. ]+"/);
      expect(svg!.match(/<(rect|ellipse|circle|path)\b/g)?.length, path).toBeGreaterThan(5);
    }
  });

  it("has no picture for a design with no beads", () => {
    expect(thumbnailSvg("flat", designToYaml(emptyDesign()), catalog)).toBeUndefined();
  });

  it("throws on a file it can't read", () => {
    expect(() => thumbnailSvg("peyote", "nonsense: [", catalog)).toThrow();
  });
});
