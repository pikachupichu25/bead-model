// Palettes as text: "Copy as text" shows a palette in the text format to copy,
// and "Import from text…" reads one back, with a preview, into my palettes.
// Shared by My profile, the Palettes page and a shared palette's page. The
// format is src/collection/palette-text.ts.

import type { Catalog } from "../src/catalog/catalog.js";
import { findMyPalette, newPaletteId, putMyPalette } from "../src/collection/my-palettes.js";
import { type PaletteFromText, paletteFromText, paletteToText } from "../src/collection/palette-text.js";
import type { Palette } from "../src/collection/palettes.js";
import { paletteBeads } from "./palette-list.js";
import { loadMyPalettes, saveMyPalettes } from "./palettes-store.js";

/** Shows the palette as text, with Copy and Download. */
export function openPaletteExport(palette: Palette, catalog: Catalog): void {
  const text = paletteToText(palette, catalog);
  const dialog = makeDialog(`
    <h2 id="palette-text-title">${esc(palette.name)} as text</h2>
    <p class="muted ed-help">Paste it anywhere. Anyone can bring it in with <b>Import from text…</b> in My profile → My palettes.</p>
    <pre class="word-chart mono export-text">${esc(text)}</pre>
    <div class="dialog-actions">
      <span class="muted" data-role="status" aria-live="polite"></span>
      <span class="spacer"></span>
      <button type="button" class="button" data-action="copy">Copy</button>
      <button type="button" class="button" data-action="download">Download .txt</button>
      <button type="submit" class="button primary">Close</button>
    </div>`);
  const status = dialog.querySelector<HTMLElement>("[data-role=status]")!;
  dialog.querySelector("[data-action=copy]")!.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = "Copied.";
    } catch {
      status.textContent = "This browser won't copy from here: select the text instead.";
    }
  });
  dialog.querySelector("[data-action=download]")!.addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = `${palette.name.replace(/[^\p{L}\p{N}]+/gu, "-").replace(/^-|-$/g, "").toLowerCase() || "palette"}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
}

/**
 * Reads a palette from pasted text, previews it in this bead size, and saves it
 * as a new private palette of mine. `onSaved` gets its name, or undefined when the browser won't keep it.
 */
export function openPaletteImport(catalog: Catalog, size: string, onSaved: (name: string | undefined) => void): void {
  const dialog = makeDialog(`
    <h2 id="palette-text-title">Import a palette from text</h2>
    <p class="muted ed-help">One color per line: a bead code (<code>miyuki DB-0010</code>, or just <code>DB-0010</code>) or a color (<code>#2a6f97 sea blue</code>). Lists like <code>DB-0010, DB-0201</code> work too, and so does a <code>Palette: Name</code> line.</p>
    <textarea class="mono palette-text-input" rows="10" spellcheck="false" aria-label="Palette as text" placeholder="Palette: Ocean&#10;miyuki DB-0726&#10;#2a6f97 sea blue"></textarea>
    <div class="palette-text-preview" data-role="preview" aria-live="polite"></div>
    <div class="dialog-actions">
      <span class="spacer"></span>
      <button type="submit" class="button">Cancel</button>
      <button type="button" class="button primary" data-action="save" disabled>Save to my palettes</button>
    </div>`);
  const input = dialog.querySelector<HTMLTextAreaElement>("textarea")!;
  const preview = dialog.querySelector<HTMLElement>("[data-role=preview]")!;
  const save = dialog.querySelector<HTMLButtonElement>("[data-action=save]")!;
  let read: PaletteFromText = { problems: [] };

  const update = () => {
    read = input.value.trim() ? paletteFromText(input.value, catalog) : { problems: [] };
    const p = read.palette;
    save.disabled = !p;
    const swatches = p
      ? `<p><b>${esc(p.name)}</b> <span class="muted">· ${p.colors.length} color${p.colors.length === 1 ? "" : "s"}</span></p>
        <ul class="palette-swatches">${paletteBeads({ id: "preview", ...p }, size, catalog)
          .map((b) => `<li title="${esc(`${b.code} ${b.name}`)}"><span class="swatch big" style="background:${esc(b.rgb)}"></span></li>`)
          .join("")}</ul>`
      : "";
    const problems = read.problems.length
      ? `<ul class="palette-text-problems">${read.problems.map((x) => `<li>${x.line ? `Line ${x.line}: ` : ""}${esc(x.message)}</li>`).join("")}</ul>`
      : "";
    preview.innerHTML = swatches + problems;
  };
  input.addEventListener("input", update);
  save.addEventListener("click", () => {
    if (!read.palette) return;
    const list = loadMyPalettes();
    let id = newPaletteId();
    while (findMyPalette(list, id)) id = newPaletteId();
    const saved = saveMyPalettes(putMyPalette(list, { id, ...read.palette, visibility: "private" }));
    dialog.close();
    onSaved(saved ? read.palette.name : undefined);
  });
  input.focus();
}

/** A dialog with this content, shown now and removed once closed. */
function makeDialog(html: string): HTMLDialogElement {
  const dialog = document.createElement("dialog");
  dialog.className = "new-dialog export-dialog";
  dialog.setAttribute("aria-labelledby", "palette-text-title");
  dialog.innerHTML = `<form method="dialog">${html}</form>`;
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
  return dialog;
}

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
