// Palettes as plain text, to paste into a forum post or a chat and back:
//
//   Palette: Ocean
//   Description: Deep blues and sea greens.
//   Tags: blue, sea
//
//   miyuki DB-0726 [dark]  # opaque cobalt
//   #2a6f97 sea blue
//
// Reading is forgiving: it also takes codes without a brand ("DB-0010"),
// lists on one line ("DB-0010, DB-0201, #2a6f97"), hex colors without a name,
// and the preset YAML or JSON. See docs/preset-palettes.md.

import { parse as parseYaml } from "yaml";
import { type Catalog, findProduct } from "../catalog/catalog.js";
import { deltaE2000, hexToLab } from "../flat/color.js";
import { MAX_COLORS, MAX_DESCRIPTION, MAX_PALETTE_NAME } from "./my-palettes.js";
import { MAX_DELTA_E, type Palette, type PaletteColor, PaletteError, type PaletteRole, parsePalette, readTags } from "./palettes.js";

/** Something in the text that couldn't be used. `line` is 1-based. */
export interface PaletteTextProblem {
  line: number;
  message: string;
}

/** A palette read from text, without an id: whoever keeps it gives it one. Undefined when no color could be read. */
export interface PaletteFromText {
  palette?: Omit<Palette, "id">;
  problems: PaletteTextProblem[];
}

const DEFAULT_NAME = "Imported palette";
const ROLE = /\s*[[(](dark|light|accent)[\])]\s*$/i;
/** `#` then a space (or the line's end) starts a comment; `#` then hex digits is a color. */
const COMMENT = /(?:^|\s)#(?=\s|$).*$/;
const HEADER = /^(palette|name|description|tags)\s*:\s*(.*)$/i;

/** The palette as text: a header, then one color per line with its catalog name as a comment. */
export function paletteToText(palette: Palette, catalog: Catalog): string {
  const head = [`Palette: ${oneLine(palette.name)}`];
  if (palette.description) head.push(`Description: ${oneLine(palette.description)}`);
  if (palette.tags?.length) head.push(`Tags: ${palette.tags.join(", ")}`);
  const lines = palette.colors.map((color) => {
    const role = color.role ? ` [${color.role}]` : "";
    if ("rgb" in color) return { text: `${color.rgb} ${oneLine(color.name)}${role}`, note: "" };
    return { text: `${color.bead}${role}`, note: findProduct(catalog, color.bead)?.color?.name ?? "" };
  });
  const width = Math.max(...lines.filter((l) => l.note).map((l) => l.text.length), 0);
  const body = lines.map((l) => (l.note ? `${l.text.padEnd(width)}  # ${l.note}` : l.text));
  return `${head.join("\n")}\n\n${body.join("\n")}\n`;
}

/** Reads a palette from text. What can't be read is listed in `problems`, and the rest is kept. */
export function paletteFromText(text: string, catalog: Catalog): PaletteFromText {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || /^colors\s*:/m.test(trimmed)) return fromStructured(trimmed, catalog);

  const problems: PaletteTextProblem[] = [];
  const head: { name?: string; description?: string; tags?: string[] } = {};
  const colors: PaletteColor[] = [];
  text.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.replace(COMMENT, "").trim();
    if (!line) return;
    const header = HEADER.exec(line);
    if (header) {
      const key = header[1]!.toLowerCase();
      const value = header[2]!.trim();
      if (key === "tags") head.tags = readTags(value);
      else if (key === "description") head.description = value || undefined;
      else head.name = value || undefined;
      return;
    }
    if (colors.length === 0 && /^[\p{L} ]+:/u.test(line)) return; // a header this format doesn't use
    const pieces = line.split(/[,;]/).map((p) => p.trim()).filter(Boolean);
    const each = pieces.length > 1 ? pieces.map((p) => readColor(p, catalog)) : [];
    const read = each.length && each.every((r) => "color" in r) ? each : [readColor(line, catalog)];
    for (const r of read) {
      if ("color" in r) colors.push(r.color);
      else problems.push({ line: i + 1, message: r.problem });
    }
  });
  return finish({ name: head.name ?? DEFAULT_NAME, description: head.description, tags: head.tags, colors }, problems);
}

/** The preset YAML, or JSON in the same shape. The id is optional here. */
function fromStructured(text: string, catalog: Catalog): PaletteFromText {
  let doc: unknown;
  try {
    doc = text.startsWith("{") ? JSON.parse(text) : parseYaml(text);
  } catch {
    return { problems: [{ line: 1, message: `This looks like ${text.startsWith("{") ? "JSON" : "YAML"}, but it can't be read` }] };
  }
  let palette: Palette;
  try {
    const record = typeof doc === "object" && doc !== null ? (doc as Record<string, unknown>) : {};
    palette = parsePalette({ name: DEFAULT_NAME, ...record, id: "imported" }, "palette");
  } catch (err) {
    if (err instanceof PaletteError) return { problems: [{ line: 1, message: err.message.replace(/^palette: /, "") }] };
    throw err;
  }
  const problems: PaletteTextProblem[] = [];
  const colors = palette.colors.filter((c) => {
    if ("rgb" in c || findProduct(catalog, c.bead)?.color) return true;
    problems.push({ line: 1, message: `"${c.bead}" isn't in the catalog` });
    return false;
  });
  return finish({ ...palette, colors }, problems);
}

/** Limits, repeats and an empty result, the same for both ways in. */
function finish(p: { name: string; description?: string; tags?: string[]; colors: PaletteColor[] }, problems: PaletteTextProblem[]): PaletteFromText {
  const seen = new Set<string>();
  const colors = p.colors.filter((c) => {
    const key = ("bead" in c ? c.bead : c.rgb).toLowerCase();
    return !seen.has(key) && seen.add(key);
  });
  if (colors.length > MAX_COLORS) problems.push({ line: 0, message: `A palette has at most ${MAX_COLORS} colors: only the first ${MAX_COLORS} are kept` });
  if (colors.length === 0) return { problems: [...problems, { line: 0, message: "No colors found" }] };
  const description = p.description ? { description: p.description.slice(0, MAX_DESCRIPTION) } : {};
  const tags = p.tags?.length ? { tags: p.tags } : {};
  return { palette: { name: p.name.slice(0, MAX_PALETTE_NAME), ...description, ...tags, colors: colors.slice(0, MAX_COLORS) }, problems };
}

/** One color: `#rrggbb [name]`, `<brand> <code>`, or a code alone that one brand has. Words after a code are its label, and ignored. */
function readColor(piece: string, catalog: Catalog): { color: PaletteColor } | { problem: string } {
  const roleMatch = ROLE.exec(piece);
  const role = roleMatch ? { role: roleMatch[1]!.toLowerCase() as PaletteRole } : {};
  const text = roleMatch ? piece.slice(0, roleMatch.index).trim() : piece;

  const hex = /^#([0-9a-f]{6}|[0-9a-f]{3})(?:\s+(.*))?$/i.exec(text);
  if (hex) {
    const digits = hex[1]!.length === 3 ? [...hex[1]!].map((d) => d + d).join("") : hex[1]!;
    const rgb = `#${digits.toLowerCase()}`;
    return { color: { rgb, name: hex[2]?.trim() || nearestName(rgb, catalog) || rgb, ...role } };
  }

  const words = text.split(/\s+/);
  let missing: string | undefined;
  for (let n = words.length; n >= 1; n--) {
    const code = words.slice(0, n).join(" ");
    const withBrand = product(catalog, code);
    if (withBrand.entry) return { color: { bead: withBrand.entry, ...role } };
    missing ??= withBrand.missing;
    const brands = [...catalog.keys()].flatMap((brand) => {
      const p = product(catalog, `${brand} ${code}`);
      if (p.missing) missing ??= code;
      return p.entry ? [p.entry] : [];
    });
    if (brands.length === 1) return { color: { bead: brands[0]!, ...role } };
    if (brands.length > 1) return { problem: `"${code}" could be ${brands.join(" or ")}: add the brand` };
  }
  return { problem: missing ? `"${missing}" isn't in the catalog` : `"${text}" isn't a bead code or a #rrggbb color` };
}

/** A product code as the catalog writes it ("miyuki DB-0010"), or the code when its brand and line are known but the color isn't. */
function product(catalog: Catalog, text: string): { entry?: string; missing?: string } {
  const found = findProduct(catalog, text);
  if (!found) return {};
  if (!found.color) return { missing: text };
  const code = found.line.code.replaceAll("{size}", found.size.code).replaceAll("{color}", found.color.code);
  return { entry: `${found.brand.id} ${code}` };
}

/** The name of the catalog color that looks most like this one, when it's close enough. */
function nearestName(rgb: string, catalog: Catalog): string | undefined {
  const lab = hexToLab(rgb);
  let best: { name: string; d: number } | undefined;
  for (const brand of catalog.values()) {
    for (const line of brand.lines.values()) {
      for (const color of line.colors.values()) {
        const d = deltaE2000(lab, hexToLab(color.display.rgb));
        if (color.name && (!best || d < best.d)) best = { name: color.name, d };
      }
    }
  }
  return best && best.d <= MAX_DELTA_E ? best.name : undefined;
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
