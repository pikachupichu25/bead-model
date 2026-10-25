// The other half of moved/index.html, the page the old addresses (bead-model.vercel.app
// and bead-model.bead-model.workers.dev) now serve. It opens this site at #move-from-old-site and hands over the
// designs and beads saved at the old address; they're added to the ones here,
// the same way as Restore (nothing here is lost).

import { findDesign, myDesignsFromJson, putDesign } from "../src/collection/designs.js";
import { mergeMyBeads, myBeadsFromJson } from "../src/collection/my-beads.js";
import { loadMyDesigns, saveMyDesigns } from "./designs-store.js";
import { loadMyBeads, loadOnlyMine, saveMyBeads, saveOnlyMine } from "./my-beads-store.js";
import { loadProfileName, saveProfileName } from "./profile-store.js";

const OLD_SITES = ["https://bead-model.vercel.app", "https://bead-model.bead-model.workers.dev"];

/** When this page was opened by the old address to receive its saved work: asks for it, and takes it in. */
export function receiveMove(done: (designs: number, beads: number) => void): void {
  if (location.hash !== "#move-from-old-site") return;
  history.replaceState(null, "", location.pathname + location.search);
  const opener = window.opener as Window | null;
  if (!opener) return;
  window.addEventListener("message", (event) => {
    if (!OLD_SITES.includes(event.origin) || event.source !== opener) return;
    const message = event.data as { type?: string; data?: Record<string, string | null> };
    if (message?.type !== "bead-model:move" || !message.data) return;
    const { designs, beads } = takeIn(message.data);
    opener.postMessage("bead-model:moved", event.origin);
    done(designs, beads);
  });
  // Only the old address that opened this page receives it (the others are dropped).
  for (const site of OLD_SITES) opener.postMessage("bead-model:ready", site);
}

function takeIn(data: Record<string, string | null>): { designs: number; beads: number } {
  let addedDesigns = 0;
  let addedBeads = 0;
  const oldDesigns = data["bead-model:my-designs"];
  if (oldDesigns) {
    try {
      const theirs = myDesignsFromJson(oldDesigns);
      let mine = loadMyDesigns();
      for (const design of theirs.designs) {
        if (findDesign(mine, design.id)) continue;
        mine = putDesign(mine, design);
        addedDesigns++;
      }
      // Their pins go after mine, in their order.
      for (const pin of theirs.pinned) if (!mine.pinned.includes(pin)) mine = { ...mine, pinned: [...mine.pinned, pin] };
      saveMyDesigns(mine);
    } catch {
      // A list that can't be read is skipped.
    }
  }
  const oldBeads = data["bead-model:my-beads"];
  if (oldBeads) {
    try {
      const mine = loadMyBeads();
      const merged = mergeMyBeads(mine, myBeadsFromJson(oldBeads));
      addedBeads = merged.beads.length - mine.beads.length;
      saveMyBeads(merged);
    } catch {
      // Skipped, as above.
    }
  }
  const name = data["bead-model:profile-name"];
  if (name && !loadProfileName()) saveProfileName(name);
  if (data["bead-model:only-my-beads"] === "true" && !loadOnlyMine()) saveOnlyMine(true);
  return { designs: addedDesigns, beads: addedBeads };
}
