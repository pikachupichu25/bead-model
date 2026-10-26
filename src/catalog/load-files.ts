// Node-only: reads the catalog and the preset palettes from folders of YAML files.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Palette, palettesFromFiles } from "../collection/palettes.js";
import { type Catalog, catalogFromFiles } from "./catalog.js";

export function loadCatalog(dir: string): Catalog {
  return catalogFromFiles(yamlFiles(dir));
}

export function loadPalettes(dir: string): Palette[] {
  return palettesFromFiles(yamlFiles(dir));
}

function yamlFiles(dir: string): { name: string; text: string }[] {
  const names = readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  return names.map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") }));
}
