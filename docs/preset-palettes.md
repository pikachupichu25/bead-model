# Palettes

**Status: built**: preset palettes (phase 1), my own palettes (phase 2) and public palettes (phase 3), as described below, with the changes from the plan noted where they happen. What's left is under [Later](#later).

A **palette** is a short, named set of bead colors that go well together, such as "Ocean", "Pastel" or "Christmas". Picking one in a designer narrows the colors on offer to that set, the way **My beads** narrows them to [the beads I have](my-beads-storage.md). It answers "which 6 of these 200 colors should I use?" for someone who doesn't own many beads yet, or wants a starting point.

## What users get

- In the Flat, Nora and Circular designers, a **Colors from** button replaces the **Only my beads** checkbox. It shows the source's name and colors, and opens the **palette menu** ([`web/palette-picker.ts`](../web/palette-picker.ts)), made for hundreds of palettes:
  - **All catalog colors** and **My beads** at the top.
  - Every palette (ones I picked before, mine, the presets, and the newest 200 public ones, plus older ones a search finds on the server), each with its name, owner or kind, tags and colors.
  - A search by words in the name, description, tags, owner or colors' names; by a color word ("blue", "pink": any color like it); or by `#rrggbb`. **Has a color like** filters by a picked color, closest first. Buttons for the most used tags narrow it further. The search is [`src/collection/palette-search.ts`](../src/collection/palette-search.ts).
  - Enter picks the first palette; the arrow keys move through the list.
  - A public palette picked here is kept in this browser (`bead-model:used-palettes`, the last 20, not synced), so Colors from can name it without saving a copy.
- With a palette picked, the Flat and Nora designers show a **palette bar** above the canvas: the palette's colors in the design's bead size. Clicking one paints with it, adding it to the design first if it isn't there yet (its bead key shows on the swatch once it is). The Fill tool stays Fill.
- With a palette picked, the **+ Add a color** list shows only that palette's colors in the design's bead size, and **+ Use all N … colors** adds all of them at once (up to a design's 62 colors).
- The picture import (`web/flat-import.ts`) gets **Palette: …** as another **Colors from** option while a palette is picked in the designer, and starts on it.
- In the add list, a palette color that's also in My beads is marked **mine**. Once My beads has anything in it, beads in the piece that aren't in it are marked **not mine**, so users see what to buy.
- Palettes have pages of their own (moved there from the My beads page, where they first were):
  - **Palettes** in the top bar ([`web/palettes.html`](../web/palettes.html)): public palettes to search, then the presets, each shown in a bead size picked at the top, with the colors I have ringed, **Add these to My beads** (or "Add the N I don't have") and **Save a copy**.
  - **My profile → My palettes** (`profile.html#palettes`): my own palettes, to rename, share, copy the link to, delete, or add to My beads.
  - The shared list code is [`web/palette-list.ts`](../web/palette-list.ts).

## Where palettes come from

1. **Preset palettes** (phase 1): a few curated palettes shipped with the app, in the catalog folder like the beads.
2. **My palettes** (phase 2): palettes users save themselves, from a design's colors or by picking colors, kept like My beads (localStorage, synced when signed in).
3. **Public palettes** (phase 3): palettes other users have made public.

## Privacy

Every palette has a `visibility`: **private** or **public**.

| | Private | Public |
|---|---|---|
| Who sees it | Only its owner | Anyone, signed in or not |
| Where it shows | The owner's **Colors from** menu and **My profile → My palettes** | Also on the **Palettes** page, and at its own link (`palette.html?owner=<account id>&id=<palette id>`) |
| Who can change it | The owner | The owner. Others can only **Save a copy**, which makes a new private palette of their own |
| Default | Yes: every new palette starts private | Only when the owner picks it |

Rules:

- **Presets are always public.** They ship with the app, so they have no owner and no setting.
- **Public needs an account.** A signed-out user's palettes live only in the browser, so they can't be public. The **Make public** control says "Sign in to share" instead.
- **Going private again is immediate.** The palette disappears from Browse and its link stops working for others. Copies people already saved stay theirs: a copy is a separate palette with no tie to the original.
- **A public palette shows the owner's display name** (from `profiles.display_name`), or "A beader" when it's empty. Nothing else about the owner is shown.
- **Only references to catalog beads and colors are public.** A palette holds no notes or amounts, so making one public reveals nothing about what the owner has at home.
- **Deleting a public palette** hides it everywhere at once (the row is kept with `deleted = 1` for sync, but never served).

## The format

Presets live in `catalog/palettes/*.yaml`: Black & white, Christmas, Forest, Neutrals, Ocean, Pastel, Rainbow and Sunset. The web pages bundle them (`web/presets.ts`); Node code reads them with `loadPalettes` in `src/catalog/load-files.ts`. A preset that can't be read is an error, not skipped, since presets ship with the app.

```yaml
id: ocean
name: Ocean
description: Deep blues and sea greens, with a sandy white.
colors:
  - { bead: miyuki DB-0010, role: dark }
  - { bead: miyuki DB-0201 }
  - { rgb: "#2a6f97", name: sea blue }
```

| Field | Meaning |
|---|---|
| `id`, `name` | Stable id (used in storage and URLs) and the name shown |
| `description` | Optional, one line |
| `tags` | Optional words to find it by, e.g. `[blue, sea, cool]`: kept lower case, at most 12 of 24 characters. Saved palettes get them in My profile → My palettes, and they sync (`palettes.tags`, [`0006_palette_tags.sql`](../migrations/0006_palette_tags.sql)) and are searched on the server. |
| `visibility` | `private` or `public`. Only for my palettes: presets leave it out and are always public. Reading treats anything else as `private`, so a damaged file never makes a palette public. |
| `colors[].bead` | A catalog product code, as patterns write it: `"<brand> <code>"` |
| `colors[].rgb`, `colors[].name` | A color by display value only, for when no single product fits every size |
| `colors[].role` | Optional hint (`dark`, `light`, `accent`) for ordering; not required |

### Bead sizes

Catalog colors belong to a bead size (many Delica colors are listed for `DB` only). A palette is shown in **the design's size**:

1. A `bead:` entry in that size is used as it is.
2. Otherwise (another size, another brand, or an `rgb:` entry), use **the nearest catalog color in this size** by CIEDE2000, with the helpers in `src/flat/color.ts` that the picture import already uses, when it's within `MAX_DELTA_E` (12). The add list shows what it stands in for: "11-401 · black (for opaque black)".
3. If nothing in this size is close enough, the palette color becomes **a color of my own** in this size (`{ color, display }`, listed as "own"). This changed from the plan: most sizes have only 2 or 3 catalog colors so far, and Generic sizes have none, so leaving colors out would leave most palettes nearly empty there. A `bead:` the catalog doesn't have is left out.
4. Two palette colors that land on the same bead count once.

This way one palette works for Delica 11/0, Toho round 15/0 and the rest without listing each size by hand.

## The code

Follows the My beads split: plain data and logic in `src/`, browser code in `web/`.

| File | Job |
|---|---|
| [`src/collection/palettes.ts`](../src/collection/palettes.ts) | Types, `palettesFromFiles` / `parsePalette`, `checkPalettes` (products the catalog doesn't have), `paletteSwatches`, and `paletteColorsFor(palette, size, catalog)`, which returns the same `{ entry, name, rgb, code }` shape as `ownedColorsFor`, plus `nearest: { name, deltaE }` when matched. |
| [`src/collection/color-source.ts`](../src/collection/color-source.ts) | The setting (`"all"`, `"mine"` or `"palette:<id>"`), `offeredColors(source, size, …)` for the designers that use one bead size, `offeredProducts(source, …)` for the Circular editor, which mixes sizes (a palette's products in every size), and `isOwned`. |
| [`catalog/palettes/*.yaml`](../catalog/palettes) | The preset palettes. |
| [`src/catalog/load-files.ts`](../src/catalog/load-files.ts) | `loadPalettes`, next to `loadCatalog`. |
| [`web/presets.ts`](../web/presets.ts) | The bundled presets and the **Colors from** options. |
| [`web/my-beads-store.ts`](../web/my-beads-store.ts) | `loadColorSource` / `saveColorSource`, kept in `bead-model:color-source`. A browser with only the old `bead-model:only-my-beads` key gets "mine" or "all" from it. That key is still written (`"true"` when the source is My beads); `loadOnlyMine` / `saveOnlyMine` stay for the moved-site import. Since phase 2 the color source itself syncs with the account. |
| [`web/color-choices.ts`](../web/color-choices.ts) | The **Colors from** select, the add list and **Use all**, shared by the Flat and Nora designers. |
| `web/flat.ts`, `web/nora.ts`, `web/editor.ts` | Use the above. The Circular editor filters its product picker by `offeredProducts`. |
| `web/flat-import.ts` | A `palette` option in `allowedColors`. |
| `web/palettes.ts`, `web/profile.ts`, `web/palette-list.ts` | The Palettes page and My profile's My palettes tab, with the list code they share. |
| [`test/palettes.test.ts`](../test/palettes.test.ts) | Reading, the shipped presets (`checkPalettes` finds nothing), size matching, the ΔE limit, own colors, duplicates, and the color source. |

Keeping `offeredColors` the single place that decides "which colors can I add" means the designers and the import stay in step.

## Steps

### Phase 1: preset palettes (built)

1. **Data.** Write `src/collection/palettes.ts` and its tests. Add 6–8 presets (e.g. Neutrals, Pastel, Ocean, Forest, Sunset, Christmas, Rainbow, Black & white), checking each looks right in Delica 11/0 and one round size.
2. **Load and check.** Load `catalog/palettes/` with the catalog. The check is a test (`checkPalettes` on the shipped presets) rather than a CLI warning, since the CLI renders patterns and doesn't use palettes.
3. **Color source setting.** Replace the only-mine boolean with the color source in `web/my-beads-store.ts`, keeping `onMyBeadsChange` firing for it so other tabs update. Migrate the old key.
4. **Flat designer.** The **Colors from** select, the filtered add list, **Use whole palette**, and the mine / not-mine marks. This is the page that benefits most, so do it first and check it in the browser.
5. **Picture import.** Add the palette option to `allowedColors`, defaulting to the designer's color source when the dialog opens (as it does for My beads today).
6. **Nora and Circular designers.** Same select. Circular's `productOptions` filters by a set of product codes, so it gets the palette's codes for its size.
7. **Palettes in the app.** First a card on the My beads page; now the Palettes page and My profile's My palettes tab (see [What users get](#what-users-get)).
8. **Docs.** Update this note to "as built", and point to it from `my-beads-storage.md` and the README.

### Phase 2: my own palettes (built)

1. **Save a palette.** "Save these colors as a palette…" under the beads in the Flat and Nora designers keeps the design's beads (products stay products, own colors keep their color). On the My beads page, **Save my beads in this size as a palette** does the same with my beads in the picked size. This replaced "build one by picking swatches": the bead grid already is the way to pick colors, so a palette is made from what's picked there. My palettes appear in **Colors from** under "My palettes", in every designer. Their ids start with `my-`, which presets may not use.
2. **Storage.** `bead-model:my-palettes` in localStorage, `{ "version": 1, "palettes": [...] }`, same format as the preset YAML, with `visibility` on each palette ([`src/collection/my-palettes.ts`](../src/collection/my-palettes.ts), [`web/palettes-store.ts`](../web/palettes-store.ts)). The My beads **Back up (.json)** file holds them next to the beads, and **Restore…** adds the ones this browser doesn't have. Restoring always brings palettes in as `private`: making one public is a choice made on this account, not something a file can do. **My profile → My palettes** lists them, to rename, delete or make public.
3. **Sync.** A `palettes` table ([`migrations/0004_palettes.sql`](../migrations/0004_palettes.sql)), one row per palette keyed by owner + id, with `updated_at`, `synced_at` and `deleted` like `owned_beads`, the colors as JSON, plus `"visibility" text not null default 'private' check ("visibility" in ('private', 'public'))`. The column has the same name and values as the browser format, so sync copies it as it is, with no translation. A deleted palette is stored as private. `visibility` syncs like any other field (the newer change wins). `designs` already uses the same `visibility` column ([`0003_designs_visibility.sql`](../migrations/0003_designs_visibility.sql) replaced its `is_public` flag), so both use the same word.
4. **Privacy control.** A **Private / Public** select on each of my palettes in My profile → My palettes, turned off with "Sign in to share" when signed out. Public palettes get a **Copy link** button (the link works once phase 3's palette page is built).
5. **Color source on the account.** [`migrations/0005_color_source.sql`](../migrations/0005_color_source.sql) adds `profiles.color_source` (1 → `"mine"`, 0 → `"all"`). `only_my_beads` stays, kept equal to `color_source = 'mine'`, and the profile still carries `onlyMyBeads` for pages from before the color source; a push with only `onlyMyBeads` sets the source from it. In the browser the color source now syncs itself, and `bead-model:only-my-beads` is only still written for the moved-site import.

### Phase 3: public palettes (built)

1. **Worker routes** ([`worker/routes/palettes.ts`](../worker/routes/palettes.ts), queries in [`worker/db.ts`](../worker/db.ts)):
   - `GET /api/palettes/public?q=&cursor=`: public, not deleted palettes, newest first, with the owner's display name (`by`, empty when they haven't set one). Works signed out. 50 at a time; `next` is the `cursor` for the page after. `q` finds words in the name or description, with `%` and `_` taken as plain characters.
   - `GET /api/palettes/public/:owner/:id`: one public palette, or 404 when it's private, deleted or missing. Private and missing give the same 404, so a link doesn't reveal that a private palette exists.
   - Both serve only rows with `visibility = 'public'` and `deleted = 0`.
   - Only the owner's sync route can change `visibility`. The public routes are read-only.
2. **Index.** `create index "palettes_public" on "palettes" ("visibility", "deleted", "updated_at")` for the Browse list, in `0004_palettes.sql` with the table.
3. **Public palettes** on the Palettes page (`palettes.html`), which **Colors from**'s "Browse palettes…" opens from any designer: search by name, swatches in the picked bead size, **Add these to My beads** and **Save a copy**. Changed from the plan: there's no **Use in this design** without saving, since a color source has to name a palette this browser keeps; saving a copy is one click and keeps working if the owner makes theirs private.
4. **Palette page** [`web/palette.html`](../web/palette.html) for shared links: the colors matched in any bead size (with which ones are in My beads), and **Save a copy**. Signed out, the copy is kept in the browser like any of my palettes, and syncs once they sign in.
5. **Tests.** [`worker/test/api.test.ts`](../worker/test/api.test.ts): a private palette never appears in either public route, signed out or as another account; private, deleted and missing give the same 404; making a palette private again or deleting it hides it at once; no email is ever in a response; and another account pushing the same palette id makes its own palette, leaving the owner's as it was.

## Later

- **Reporting.** A **Report** link on public palettes is worth having before the list gets large; names and descriptions are the only free text shown.
- **Use without saving**, if it turns out people want it (see phase 3, step 3).

## Open questions

- Should **Colors from** stay one setting for every designer (as Only my beads is today), or be remembered per design? A per-design palette could be saved in the design file.
- Is "nearest color" acceptable, or should a preset list exact products for each common size? Matching by ΔE is less work but the match for metallic or AB finishes can look off, since only `display.rgb` is compared.
- Should a palette be combinable with My beads ("this palette, only the ones I own")? Easy to add as a checkbox once both exist.
- Do we want palettes from a picture (extract 6 colors from a photo) later? The import's color reduction could produce one.
- Is a third setting, **unlisted** (anyone with the link, but not in Browse), worth adding? It's the usual middle ground: one more value in `visibility` and its check, with no new column.
- Should a public palette show how many people saved a copy? It would need a count kept on the original, since copies aren't tied to it.
- A design never depends on a palette: its colors are in the design file, so deleting a palette, or the owner of a public one making it private, changes nothing in designs made with it.
