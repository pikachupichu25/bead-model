// Loads the bead catalog (catalog/beads/*.yaml) and resolves a pattern's
// `beads:` entries to real sizes and display colors. See docs/bead-catalog.md.

import { parse as parseYaml } from "yaml";

export type Shape = "cylinder" | "round" | "demi" | "hex" | "triangle" | "cube" | "bugle";
export type Basis = "official" | "measured" | "derived" | "retailer" | "estimate";
export type Dimension = number | { min: number; max: number };

export interface Display {
  rgb: string;
  opacity?: number;
  finish?: string[];
}

export interface SizeSpec {
  code: string;
  label: string;
  outer_diameter: Dimension;
  length: Dimension;
  hole?: Dimension;
  beads_per_gram?: number;
  beads_per_10cm?: number;
}

export interface ColorSpec {
  code: string;
  name?: string;
  sizes?: string[];
  display: Display;
}

export interface LineSpec {
  id: string;
  name: string;
  shape: Shape;
  code: string;
  sizes: Map<string, SizeSpec>;
  colors: Map<string, ColorSpec>;
  basis: { default: Basis } & Partial<Record<string, Basis>>;
}

export interface BrandSpec {
  id: string;
  name: string;
  lines: Map<string, LineSpec>;
}

export type Catalog = Map<string, BrandSpec>;

/** A pattern bead with everything the diagram and 3D model need. */
export interface ResolvedBead {
  key: string;
  /** Human-readable name, e.g. "Miyuki Delica DB-0010 (black)". */
  label: string;
  shape: Shape;
  /** Nominal sizes in mm. */
  outerDiameter: number;
  length: number;
  hole?: number;
  beadsPerGram?: number;
  display: Display;
  /** Where each size came from. */
  basis: { outerDiameter: Basis; length: Basis };
  warnings: string[];
}

export class CatalogError extends Error {}

const SHAPES: Shape[] = ["cylinder", "round", "demi", "hex", "triangle", "cube", "bugle"];
const BASES: Basis[] = ["official", "measured", "derived", "retailer", "estimate"];

/** Colors for beads with no catalog color, by key order. Distinct and readable on white. */
const PALETTE = ["#4e79a7", "#e15759", "#f2b134", "#59a14f", "#b07aa1", "#76b7b2", "#ff9da7", "#9c755f"];

/** Builds a catalog from the text of its YAML files. Works in Node and the browser. */
export function catalogFromFiles(files: { name: string; text: string }[]): Catalog {
  const catalog: Catalog = new Map();
  for (const file of [...files].sort((a, b) => a.name.localeCompare(b.name))) {
    const brand = parseBrand(parseYaml(file.text), file.name);
    if (catalog.has(brand.id)) throw new CatalogError(`${file.name}: brand "${brand.id}" is defined twice`);
    catalog.set(brand.id, brand);
  }
  return catalog;
}

export function parseBrand(doc: unknown, where: string): BrandSpec {
  const fail = (msg: string): never => {
    throw new CatalogError(`${where}: ${msg}`);
  };
  if (!isRecord(doc) || typeof doc.brand !== "string") return fail("needs a `brand` id");
  if (!isRecord(doc.lines)) return fail("needs a `lines` mapping");

  const lines = new Map<string, LineSpec>();
  const productCodes = new Set<string>();
  for (const [lineId, raw] of Object.entries(doc.lines)) {
    const at = `line ${lineId}`;
    if (!isRecord(raw)) return fail(`${at} must be a mapping`);
    if (!SHAPES.includes(raw.shape as Shape)) return fail(`${at}: shape must be one of ${SHAPES.join(", ")}`);
    const code = typeof raw.code === "string" ? raw.code : "{size}";

    const basis = isRecord(raw.basis) ? raw.basis : {};
    for (const value of Object.values(basis)) {
      if (!BASES.includes(value as Basis)) return fail(`${at}: basis must be one of ${BASES.join(", ")}`);
    }

    const sizes = new Map<string, SizeSpec>();
    for (const [sizeCode, s] of Object.entries(isRecord(raw.sizes) ? raw.sizes : {})) {
      const sat = `${at}, size ${sizeCode}`;
      if (!isRecord(s)) return fail(`${sat} must be a mapping`);
      const size: SizeSpec = {
        code: sizeCode,
        label: typeof s.label === "string" ? s.label : sizeCode,
        outer_diameter: dimension(s.outer_diameter, `${sat}: outer_diameter`, true)!,
        length: dimension(s.length, `${sat}: length`, true)!,
        hole: dimension(s.hole, `${sat}: hole`, false),
        beads_per_gram: typeof s.beads_per_gram === "number" ? s.beads_per_gram : undefined,
        beads_per_10cm: typeof s.beads_per_10cm === "number" ? s.beads_per_10cm : undefined,
      };
      sizes.set(sizeCode, size);
    }
    if (sizes.size === 0) return fail(`${at} has no sizes`);

    const colors = new Map<string, ColorSpec>();
    for (const [colorCode, c] of Object.entries(isRecord(raw.colors) ? raw.colors : {})) {
      if (!isRecord(c) || !isRecord(c.display) || typeof c.display.rgb !== "string") {
        return fail(`${at}, color ${colorCode} needs display.rgb`);
      }
      const colorSizes = Array.isArray(c.sizes) ? c.sizes.map(String) : undefined;
      for (const s of colorSizes ?? []) {
        if (!sizes.has(s)) return fail(`${at}, color ${colorCode} lists size ${s}, which the line doesn't have`);
      }
      colors.set(colorCode, {
        code: colorCode,
        name: typeof c.name === "string" ? c.name : undefined,
        sizes: colorSizes,
        display: c.display as unknown as Display,
      });
    }

    const line: LineSpec = {
      id: lineId,
      name: typeof raw.name === "string" ? raw.name : lineId,
      shape: raw.shape as Shape,
      code,
      sizes,
      colors,
      basis: { default: "official", ...basis } as LineSpec["basis"],
    };
    for (const size of sizes.values()) {
      const product = productCode(line, size.code, "*");
      if (productCodes.has(product)) return fail(`two lines produce the product code ${product}`);
      productCodes.add(product);
    }
    lines.set(lineId, line);
  }
  return { id: doc.brand, name: typeof doc.name === "string" ? doc.name : doc.brand, lines };

  function dimension(value: unknown, at: string, required: boolean): Dimension | undefined {
    if (value === undefined) return required ? fail(`${at} is required`) : undefined;
    if (typeof value === "number" && value > 0) return value;
    if (isRecord(value) && typeof value.min === "number" && typeof value.max === "number") {
      if (value.min > value.max) return fail(`${at}: min is bigger than max`);
      return { min: value.min, max: value.max };
    }
    return fail(`${at} must be a positive number or { min, max }`);
  }
}

/** Warnings about a catalog that don't stop it loading. */
export function checkCatalog(catalog: Catalog): string[] {
  const warnings: string[] = [];
  for (const brand of catalog.values()) {
    for (const line of brand.lines.values()) {
      for (const size of line.sizes.values()) {
        if (size.beads_per_10cm === undefined) continue;
        const derived = 100 / size.beads_per_10cm;
        const length = nominal(size.length);
        if (Math.abs(derived - length) / length > 0.1) {
          warnings.push(
            `${brand.id} ${line.id} ${size.code}: length ${length} differs from 100 / beads_per_10cm = ${derived.toFixed(2)} by more than 10%`,
          );
        }
      }
    }
  }
  return warnings;
}

export function nominal(d: Dimension): number {
  return typeof d === "number" ? d : (d.min + d.max) / 2;
}

function productCode(line: LineSpec, size: string, color: string): string {
  return line.code.replaceAll("{size}", size).replaceAll("{color}", color);
}

/**
 * Resolves every entry of a pattern's `beads:` block. Accepted forms:
 *   A: miyuki DB-0010
 *   A: { bead: miyuki DB-0010, display: { rgb: "#202830" } }
 *   A: { brand: toho, line: round, size: "11", color: 49F }
 *   A: { size: 11/0, shape: round, color: "free text" }      (generic bead)
 */
export function resolveBeads(beads: Record<string, unknown>, catalog: Catalog): Map<string, ResolvedBead> {
  const out = new Map<string, ResolvedBead>();
  Object.entries(beads).forEach(([key, entry], index) => {
    out.set(key, resolveBead(key, entry, catalog, PALETTE[index % PALETTE.length]!));
  });
  return out;
}

function resolveBead(key: string, entry: unknown, catalog: Catalog, fallbackRgb: string): ResolvedBead {
  const spec = typeof entry === "string" ? { bead: entry } : isRecord(entry) ? entry : {};
  const warnings: string[] = [];

  let found: { brand: BrandSpec; line: LineSpec; size: SizeSpec; color?: ColorSpec; colorText?: string } | undefined;
  if (typeof spec.bead === "string") {
    found = findByProductCode(catalog, spec.bead, warnings);
  } else if (typeof spec.brand === "string") {
    found = findByFields(catalog, spec, warnings);
  }
  if (!found) {
    found = findGeneric(catalog, spec, warnings);
    if (typeof spec.color === "string") found.colorText = spec.color;
  }

  const { brand, line, size, color } = found;
  const override = isRecord(spec.display) ? (spec.display as unknown as Partial<Display>) : {};
  const display: Display = { rgb: fallbackRgb, ...color?.display, ...override };

  const basis = {
    outerDiameter: line.basis.outer_diameter ?? line.basis.default,
    length: line.basis.length ?? line.basis.default,
  };
  if (basis.outerDiameter === "estimate" || basis.length === "estimate") {
    warnings.push(`bead ${key}: size is an estimate (${brand.name} ${line.name} ${size.label}). Measure it to be sure`);
  }

  const colorName = color ? (color.name ?? color.code) : found.colorText;
  const product = color ? productCode(line, size.code, color.code) : size.label;
  const label = `${brand.id === "generic" ? "" : `${brand.name} `}${line.name} ${product}${colorName ? ` (${colorName})` : ""}`;

  return {
    key,
    label,
    shape: line.shape,
    outerDiameter: nominal(size.outer_diameter),
    length: nominal(size.length),
    hole: size.hole === undefined ? undefined : nominal(size.hole),
    beadsPerGram: size.beads_per_gram,
    display,
    basis,
    warnings,
  };
}

/**
 * The brand, line and size a product code such as "miyuki DB-0010" belongs to,
 * and its color when the catalog has it. undefined if no product matches.
 */
export function findProduct(
  catalog: Catalog,
  text: string,
): { brand: BrandSpec; line: LineSpec; size: SizeSpec; color?: ColorSpec } | undefined {
  return findByProductCode(catalog, text, []);
}

function findByProductCode(catalog: Catalog, text: string, warnings: string[]) {
  const m = /^\s*(\S+)\s+(.+?)\s*$/.exec(text);
  const brand = m ? catalog.get(m[1]!.toLowerCase()) : undefined;
  if (!m || !brand) {
    warnings.push(`"${text}": expected "<brand> <product code>" with a brand in the catalog`);
    return undefined;
  }
  const code = m[2]!;
  for (const line of brand.lines.values()) {
    for (const size of line.sizes.values()) {
      const pattern = new RegExp(
        `^${escapeRegExp(line.code).replace(escapeRegExp("{size}"), escapeRegExp(size.code)).replace(escapeRegExp("{color}"), "(.+)")}$`,
        "i",
      );
      const hit = pattern.exec(code);
      if (!hit) continue;
      const colorCode = hit[1];
      const color = colorCode === undefined ? undefined : findColor(line, size, colorCode);
      if (colorCode !== undefined && !color) {
        warnings.push(`"${text}": color ${colorCode} isn't in the catalog yet, so it gets a placeholder color`);
        return { brand, line, size, colorText: colorCode };
      }
      return { brand, line, size, color };
    }
  }
  warnings.push(`"${text}": no ${brand.name} product matches "${code}"`);
  return undefined;
}

function findByFields(catalog: Catalog, spec: Record<string, unknown>, warnings: string[]) {
  const brand = catalog.get(String(spec.brand).toLowerCase());
  const line = brand?.lines.get(String(spec.line));
  const size = line?.sizes.get(String(spec.size));
  if (!brand || !line || !size) {
    warnings.push(`no catalog entry for brand ${spec.brand}, line ${spec.line}, size ${spec.size}`);
    return undefined;
  }
  if (spec.color === undefined) return { brand, line, size };
  const color = findColor(line, size, String(spec.color));
  if (!color) {
    warnings.push(`${brand.name} ${line.name}: color ${spec.color} isn't in the catalog yet, so it gets a placeholder color`);
    return { brand, line, size, colorText: String(spec.color) };
  }
  return { brand, line, size, color };
}

function findColor(line: LineSpec, size: SizeSpec, code: string): ColorSpec | undefined {
  const color = [...line.colors.values()].find((c) => c.code.toLowerCase() === code.toLowerCase());
  if (color?.sizes && !color.sizes.includes(size.code)) return undefined;
  return color;
}

function findGeneric(catalog: Catalog, spec: Record<string, unknown>, warnings: string[]) {
  const generic = catalog.get("generic");
  if (!generic) throw new CatalogError("the catalog needs a generic brand (generic.yaml)");
  const shape = String(spec.shape ?? "round");
  const sizeLabel = String(spec.size ?? "11/0");
  let line = generic.lines.get(shape);
  let size = line?.sizes.get(sizeLabel);
  if (!line || !size) {
    warnings.push(`no generic bead for shape "${shape}", size "${sizeLabel}", so a round 11/0 is used`);
    line = generic.lines.get("round");
    size = line?.sizes.get("11/0");
    if (!line || !size) throw new CatalogError("generic.yaml needs a round 11/0");
  }
  return { brand: generic, line, size } as {
    brand: BrandSpec;
    line: LineSpec;
    size: SizeSpec;
    color?: ColorSpec;
    colorText?: string;
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
