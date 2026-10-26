// The preset palettes (catalog/palettes/*.yaml), bundled into every page that offers colors.

import type { ColorSource } from "../src/collection/color-source.js";
import { palettesFromFiles } from "../src/collection/palettes.js";

const files = import.meta.glob<string>("../catalog/palettes/*.yaml", {
  query: "?raw",
  import: "default",
  eager: true,
});

export const presetPalettes = palettesFromFiles(Object.entries(files).map(([path, text]) => ({ name: path.split("/").pop()!, text })));

/** The options of a "Colors from" select. */
export function colorSourceOptions(selected: ColorSource): string {
  const option = (value: ColorSource, label: string) => `<option value="${esc(value)}"${value === selected ? " selected" : ""}>${esc(label)}</option>`;
  return (
    option("all", "All catalog colors") +
    option("mine", "My beads") +
    `<optgroup label="Palettes">${presetPalettes.map((p) => option(`palette:${p.id}`, p.name)).join("")}</optgroup>`
  );
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
