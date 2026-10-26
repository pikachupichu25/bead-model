// The preset palettes (catalog/palettes/*.yaml), bundled into every page that offers colors.

import { palettesFromFiles } from "../src/collection/palettes.js";

const files = import.meta.glob<string>("../catalog/palettes/*.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
});

export const presetPalettes = palettesFromFiles(Object.entries(files).map(([path, text]) => ({ name: path.split("/").pop()!, text })));
