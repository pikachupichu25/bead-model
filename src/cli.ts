// Renders step-by-step bead diagrams for one or more patterns.
//
//   npm run render -- patterns/03-flat-triangle.peyote.yaml [more files] [--out out] [--catalog catalog/beads]
//
// Writes <out>/<pattern name>/step-NN.svg (one per step; a tube start's
// rounds 1 and 2 are one step) and sheet.svg, and prints a
// summary with bead counts and any warnings.

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseArgs } from "node:util";
import { checkCatalog, resolveBeads } from "./catalog/catalog.js";
import { loadCatalog } from "./catalog/load-files.js";
import { layoutPattern } from "./diagram/layout.js";
import { renderSheetSvg, renderStepSvg } from "./diagram/svg.js";
import { compilePattern } from "./pattern/compile.js";
import { parsePattern, PatternError } from "./pattern/load.js";

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    out: { type: "string", default: "out" },
    catalog: { type: "string", default: "catalog/beads" },
  },
});

if (positionals.length === 0) {
  console.error("usage: npm run render -- <pattern.peyote.yaml>... [--out dir] [--catalog dir]");
  process.exit(2);
}

const catalog = loadCatalog(values.catalog);
for (const warning of checkCatalog(catalog)) console.warn(`catalog warning: ${warning}`);

let failed = false;
for (const file of positionals) {
  try {
    renderFile(file);
  } catch (e) {
    failed = true;
    console.error(`\n${file}: pattern has errors`);
    const issues = e instanceof PatternError ? e.issues : [e instanceof Error ? e.message : String(e)];
    for (const issue of issues) console.error(`  - ${issue}`);
  }
}
process.exit(failed ? 1 : 0);

function renderFile(file: string): void {
  const pattern = parsePattern(readFileSync(file, "utf8"));
  const compiled = compilePattern(pattern);
  const beads = resolveBeads(pattern.beads, catalog);
  const layout = layoutPattern(compiled, beads);
  const input = { compiled, beads, layout };

  const dir = join(values.out, basename(file).replace(/\.peyote\.ya?ml$|\.ya?ml$/, ""));
  mkdirSync(dir, { recursive: true });
  compiled.steps.forEach((_, i) => {
    writeFileSync(join(dir, `step-${String(i + 1).padStart(2, "0")}.svg`), renderStepSvg(input, i));
  });
  writeFileSync(join(dir, "sheet.svg"), renderSheetSvg(input));

  console.log(`\n${pattern.title}  →  ${dir}/`);
  console.log(`  rounds: ${compiled.rounds.map((r) => `${r.round}:${r.beads.length}`).join("  ")}`);
  for (const bead of beads.values()) {
    const count = compiled.beads.filter((b) => b.key === bead.key).length;
    const grams = bead.beadsPerGram ? `, about ${(count / bead.beadsPerGram).toFixed(2)} g` : "";
    console.log(`  ${bead.key}: ${count} × ${bead.label}${grams}`);
  }
  const warnings = [...compiled.warnings, ...[...beads.values()].flatMap((b) => b.warnings)];
  for (const warning of warnings) console.log(`  warning: ${warning}`);
}
