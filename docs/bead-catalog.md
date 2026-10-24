# Bead Catalog (Proposal)

Step 3.1 of [plan.md](plan.md). **Status: draft for review.**

This proposes how our system stores real commercial beads: their shape, size and colors. It is based on [bead-research.md](bead-research.md). The 2D bead diagrams (step 3) use it to draw beads to scale and in the right color, and the 3D model (step 4) uses it to place them.

## Goals

1. **Real sizes.** A pattern bead such as "Miyuki DB-0010" should resolve to real millimetres, not just "11/0".
2. **Honest about sources.** Every size says whether it is official, from a retailer, derived or measured, so we know which numbers to trust and which to measure.
3. **Geometry separate from color.** One size of one product line has one geometry and many colors.
4. **Works without a brand.** A pattern that only says "11/0 round" still gets a sensible generic bead.
5. **Readable and hand-editable.** Same YAML style as the [pattern format](pattern-format.md).

## The model

```
Brand ──< Line ──< Size
            │
            └──< Color
```

| Entity | What it is | Example |
|---|---|---|
| **Brand** | A manufacturer | Miyuki |
| **Line** | A product family with one shape | Miyuki Delica |
| **Size** | One size of a line, with its geometry | Delica 11/0 (`DB`) |
| **Color** | One color and finish of a line, sold in some of its sizes | Delica 0010, opaque black |

A bead you can buy is **one size + one color**, for example `DB` + `0010` = `DB-0010`.

## Bead geometry

### Axes

Each bead has its own frame:

- **z** is the hole axis (the thread runs along it).
- **x, y** are across the hole.

So **length** is measured along z, and **outer diameter** (or width) across it. The 2D diagram draws a bead in peyote as `length` wide and `outer_diameter` tall (see [bead-research.md §3](bead-research.md#3-why-this-matters-for-peyote)).

### Shapes

`shape` sets the outline around the hole axis. The renderer turns `shape` plus the sizes into a drawing or a 3D mesh.

| Shape | Looks like | Lines |
|---|---|---|
| `cylinder` | Straight tube with flat ends | Delica, Aiko, Treasure |
| `round` | Rounded, slightly flattened bead | Rocailles (Miyuki, Toho, Preciosa) |
| `demi` | A thin `round` | Toho Demi Round |
| `hex` | Hexagonal prism | Miyuki Hexagon, Toho Hexagon |
| `triangle` | Triangular prism | Miyuki Triangle, Toho Triangle |
| `cube` | Square prism, about as long as it is wide | Miyuki Square, Toho Cube |
| `bugle` | Long tube | Bugles |

These all have **one hole along the center**, which covers everything we need for peyote now.

Facets are not a separate shape. A Charlotte or a cut Delica has the same geometry as the plain bead, and is marked with `cut: true` so the renderer can add sparkle.

Out of scope for now: drops, magatamas, berries, tilas and other beads with an off-center, crosswise or second hole. Later they can add a `holes:` list (position and direction of each hole in the bead frame) without changing anything else.

### Dimensions

All sizes are in **mm**.

| Field | Meaning | Required |
|---|---|---|
| `outer_diameter` | Size across the hole. For `hex`, `triangle` and `cube`, the width across the flats | Yes |
| `length` | Size along the hole | Yes (may be estimated) |
| `hole` | Hole diameter | No |
| `beads_per_gram` | For the shopping list | No |
| `beads_per_10cm` | Count of strung beads in 10 cm, as Miyuki lists | No |

Each size is written in one of two ways:

```yaml
outer_diameter: 1.6                   # a single value
outer_diameter: { min: 2.0, max: 2.2 } # a range (Czech beads). The nominal value is the middle
```

### Where a number comes from

Each size has a `basis` that says where each number came from:

| Basis | Meaning | Trust |
|---|---|---|
| `official` | The manufacturer's published table | High |
| `measured` | We measured it ourselves | High |
| `derived` | Calculated from other numbers, for example `length = 100 / beads_per_10cm` | Medium |
| `retailer` | A shop's listing | Low |
| `estimate` | A guess, to be measured | Lowest |

```yaml
basis: { default: official, length: derived }
```

`default` applies to every field not listed. The program can warn when a pattern depends on an `estimate`.

## Colors

A color belongs to a **line**, because the same number is usually sold in several sizes.

| Field | Meaning | Required |
|---|---|---|
| `code` | The brand's color code, as printed on the tube | Yes |
| `name` | The brand's name for it | No |
| `sizes` | Size codes this color is sold in. Omit if sold in all sizes | No |
| `display` | How to draw it (below) | Yes |

`display` is what the 2D and 3D renderers use. We pick these values by eye from photos, so they are approximate.

| Field | Values | Meaning |
|---|---|---|
| `rgb` | `"#1a1a1a"` | Main color |
| `opacity` | 0 – 1 (default 1) | 1 = opaque. Transparent beads are lower |
| `finish` | list of `matte`, `luster`, `metallic`, `ab`, `silver-lined`, `color-lined`, `pearl` | Surface effects for the renderer |

## Product codes

Each line has a `code` template that builds the code you see on a tube, so a pattern can name a bead the way beaders already do:

| Line | Template | Example |
|---|---|---|
| Miyuki Delica | `{size}-{color}` | `DB-0010` |
| Miyuki Round | `{size}-{color}` | `11-401` |
| Toho Round | `TR-{size}-{color}` | `TR-11-49F` |
| Toho Treasure | `TT-{size}-{color}` | `TT-01-41` |
| Preciosa Rocailles | `{size} {color}` | `10/0 23980` |

A Size has a short `code` (`DB`, `11`, `10/0`) used in this template. Product codes are only unique within a brand, so a pattern always says the brand too.

## File format

The catalog is a set of YAML files, one per brand, in `catalog/beads/`:

```
catalog/beads/
  generic.yaml
  miyuki.yaml
  toho.yaml
  preciosa.yaml
```

### Example: Miyuki

```yaml
brand: miyuki
name: Miyuki
country: JP
sources:
  - https://www.miyuki-beads.co.jp/english/seedbeads/seedgrain.html

lines:
  delica:
    name: Delica
    shape: cylinder
    code: "{size}-{color}"
    sizes:
      DB:  { label: 11/0, outer_diameter: 1.6, length: 1.30, hole: 0.8,  beads_per_gram: 200, beads_per_10cm: 77 }
      DBS: { label: 15/0, outer_diameter: 1.3, length: 1.14, hole: 0.65, beads_per_gram: 350, beads_per_10cm: 88 }
      DBM: { label: 10/0, outer_diameter: 2.2, length: 1.69, hole: 1.0,  beads_per_gram: 108, beads_per_10cm: 59 }
      DBL: { label: 8/0,  outer_diameter: 3.0, length: 2.70, hole: 1.5,  beads_per_gram: 30,  beads_per_10cm: 37 }
    basis: { default: official, length: derived }
    colors:
      "0010": { name: black, display: { rgb: "#141414" } }
      "0201": { name: white pearl ceylon, display: { rgb: "#f2eee4", finish: [pearl] } }

  round:
    name: Round Rocailles
    shape: round
    code: "{size}-{color}"
    sizes:
      "15": { label: 15/0, outer_diameter: 1.5, length: 1.00, hole: 0.7, beads_per_gram: 250, beads_per_10cm: 100 }
      "11": { label: 11/0, outer_diameter: 2.0, length: 1.45, hole: 0.8, beads_per_gram: 110, beads_per_10cm: 69 }
      "8":  { label: 8/0,  outer_diameter: 3.0, length: 2.13, hole: 1.1, beads_per_gram: 39,  beads_per_10cm: 47 }
    basis: { default: official, length: derived }
    colors:
      "401": { name: opaque black, display: { rgb: "#111111" } }
```

### Example: Preciosa (ranges, missing data)

```yaml
brand: preciosa
name: Preciosa Ornela
country: CZ
sources:
  - https://www.preciosa-ornela.com/content/files/downloads/infocards/PRECIOSA_Rocailles.pdf

lines:
  rocailles:
    name: Rocailles (round hole)
    shape: round
    article: 311 19 001
    code: "{size} {color}"
    sizes:
      10/0: { outer_diameter: { min: 2.2, max: 2.4 }, length: 1.6, hole: 0.8, beads_per_gram: 91 }
      8/0:  { outer_diameter: { min: 2.8, max: 3.2 }, length: 2.1, hole: 0.9, beads_per_gram: 42 }
    basis: { default: official, length: estimate, hole: retailer }
    colors:
      "23980": { name: opaque jet black, display: { rgb: "#0d0d0d" } }
```

The `length` values here are placeholders until measured. `basis` makes that visible.

### Generic beads

`generic.yaml` has one line per shape, and one size per size label, for patterns that don't name a brand. Its values are typical Japanese sizes, marked `estimate`. It has no colors: a generic bead takes its color from the pattern.

```yaml
brand: generic
lines:
  cylinder:
    shape: cylinder
    sizes:
      11/0: { outer_diameter: 1.6, length: 1.3 }
      15/0: { outer_diameter: 1.3, length: 1.15 }
    basis: { default: estimate }
  round:
    shape: round
    sizes:
      15/0: { outer_diameter: 1.5, length: 1.0 }
      11/0: { outer_diameter: 2.0, length: 1.45 }
      8/0:  { outer_diameter: 3.0, length: 2.1 }
    basis: { default: estimate }
```

## How a pattern uses the catalog

This replaces the `size` / `shape` / `color` fields in the pattern's `beads:` block ([pattern-format.md](pattern-format.md#bead-types)), and keeps them as the fallback.

```yaml
beads:
  A: miyuki DB-0010                 # brand + product code: the usual case
  B: { brand: toho, line: round, size: "11", color: 49F }   # the same thing, written out
  C: { size: 15/0, shape: round, color: "silver-lined crystal" }   # no brand: generic bead
  D: { bead: miyuki DB-0010, display: { rgb: "#202830" } }  # override how it is drawn
```

How a key is resolved:

1. `brand code` string: find the brand, then the line and size whose `code` template matches, then the color.
2. Written-out mapping: look up brand, line, size and color directly.
3. `size` + `shape` only: use the generic bead. The color is free text, so it gets a neutral display color unless `display` is given.

The resolved bead has everything steps 3 and 4 need: `shape`, `outer_diameter`, `length`, `hole`, `display`, and where each number came from.

## Validation rules

The program rejects a catalog, or warns, when:

1. A size has no `outer_diameter` or no `length`. This is an error.
2. A range has `min` > `max`. This is an error.
3. `length` from `beads_per_10cm` differs from the stored `length` by more than 10%. Warning.
4. A color lists a size code that its line doesn't have. This is an error.
5. Two lines in one brand produce the same product code. This is an error.
6. A pattern resolves to a size whose `length` or `outer_diameter` is an `estimate`. Warning.
7. Warning: a pattern mixes lines with the same label but different sizes (for example Miyuki 11/0 round and Toho 11/0 round in one round). It's allowed, but it changes the shape.

## What is computed, not stored

- `length` when only `beads_per_10cm` is known
- Nominal values from ranges
- Grams needed per color, from bead counts and `beads_per_gram`
- The bead outline for drawing (step 3) and the bead mesh (step 4), from `shape` and the sizes

## Alternatives considered

- **One flat list of products (one row per color).** Simple, but it repeats the same geometry hundreds of times, and Miyuki alone has thousands of colors.
- **Size labels only (`11/0 round`).** This is what patterns use today, but it is wrong by up to 10% between brands (2.0 vs 2.2 mm).
- **JSON or CSV.** CSV suits the color lists, which can be long. If the color lists grow large, they can move to one CSV per line, keeping the geometry in YAML.

## Delica colors

Image import in the flat designer ([flat-peyote-spec.md](flat-peyote-spec.md) §6) matches pictures to catalog colors, so it needs many of them. `miyuki.yaml` has about 190 Delica colors, picked to cover the spectrum: opaque, matte, transparent, matte transparent, silver-lined, gold-lined, metallic and Duracoat colors. Codes and names come from [Angular by Design's Delica listing](https://angularbydesign.com/miyuki-delica-db-listing/); Miyuki publishes no official color names. Colors whose listed name is only a finish (such as "Inside Dyed" or "Luminous") are left out, since the name doesn't say the color.

- Display colors are set by eye from the names, not measured, so matching is approximate.
- The new colors list only `DB` (11/0) in `sizes`, because the source covers 11/0. Many are also sold as DBS, DBM or DBL; add those sizes once checked.

## Questions for review

1. **Pattern references:** is `miyuki DB-0010` the right short form, or would you rather always write the mapping?
2. **Colors:** should we add colors only as patterns need them, or import full color lists from each brand?
3. **Display colors:** picking RGB by eye is approximate. Is that good enough for step 3, or do you want photo swatches?
4. **Measuring:** do you have Toho and Preciosa beads to measure (10 cm strung count), so we can replace the `estimate` and `retailer` values?
5. **Out of scope for now:** drops, magatamas, tilas, two-hole beads, and size changes from coatings (galvanized and lined beads can be slightly bigger). Agree to leave these for later?
