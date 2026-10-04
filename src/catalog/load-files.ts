// Node-only: reads the catalog from a folder of YAML files.

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { type Catalog, catalogFromFiles } from "./catalog.js";

export function loadCatalog(dir: string): Catalog {
  const names = readdirSync(dir).filter((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
  return catalogFromFiles(names.map((name) => ({ name, text: readFileSync(join(dir, name), "utf8") })));
}
