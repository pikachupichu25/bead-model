# My Designs, Home and My Profile

**Status: as built.** Like [My beads](my-beads-storage.md), everything is kept in the browser's localStorage. Signed out, nothing is sent to a server. **Signed in, My designs, pins and the profile name also sync with the account** (see [Accounts](#accounts) below).

## The pages

- **Home** (`index.html`): a search box, a filter by technique, a **+** tile per technique, then the feed. The feed shows **Pinned** first (newest pin first), then **New**: my designs, most recently changed first, then the examples that come with the app, by title. A search matches designs by every word of the query in the title or the technique's name, and catalog beads by code, name or size (first 48 shown). Clicking a bead adds it to My beads or takes it off.
- **My profile** (`profile.html`): a name (only shown here), counts, and two tabs. **My designs** lists my designs with a filter by technique and title, and can pin or delete them. **My beads** shows the list by bead size and links to the My beads page to change it.
- **The step viewer** moved from `index.html` to `steps.html`. Old links to `index.html#pattern=…` now land on Home.

Every page has the same links in the top bar (`web/nav.ts`): Home, Circular, Flat, Nora, My profile. My beads counts as part of My profile.

## How designs are kept

Each designer saves the open design into My designs a moment after each change, and when the page is closed:

| Opened from | Becomes one of mine |
|---|---|
| A card of mine (`#design=<id>`) | Already is: changes go to that entry |
| An example (`#example=<name>`) | On the first change, as a new entry |
| **New** (or a **+** tile, `#new`) | On the first change (Flat and Nora: the first bead) |
| **Open file…**, or the step viewer's **Edit in editor** for a file | At once |
| The designer's last design, from before this feature | At once, the first time the designer opens |

Opening another design starts undo over, since the design before it is kept. Deleting a design that a designer still has open brings it back as a new entry if it is changed again.

| Key | What it holds |
|---|---|
| `bead-model:my-designs` | `{"version":1,"designs":[…],"pinned":[…]}` |
| `bead-model:open-design:<kind>` | The id of the design each designer has open (`peyote`, `flat`, `nora`) |
| `bead-model:profile-name` | The name on the profile |

A design is `{ id, kind, title, yaml, created, updated }`: `yaml` is the file the designer downloads, so a design can always be downloaded and opened again elsewhere. `pinned` holds design ids and example ids (`example:<kind>:<name>`). The designers still keep their own working copy (`bead-model:flat-draft` and so on) as before.

The code: [`src/collection/designs.ts`](../src/collection/designs.ts) (the data, the feed's order and search, tested in `test/designs.test.ts`), [`web/designs-store.ts`](../web/designs-store.ts) (the only code that touches the list in localStorage, and `openDesign`, which the designers use), [`src/gallery/thumbnail.ts`](../src/gallery/thumbnail.ts) (the card pictures), [`web/examples.ts`](../web/examples.ts) (the examples and where each design opens).

## Accounts

When someone signs in (the **Sign in** menu in the top bar), [`web/sync.ts`](../web/sync.ts) keeps localStorage and the account in step. It runs on page load, when the tab comes back into view, and a few seconds after a save. localStorage stays the working copy, so pages work as before, offline too. Each design, pin and the profile name is a row in the account's D1 database. When the same item changed in two places, the newer change wins. A deletion is kept as a marker, so it reaches other devices. The first sign-in on a browser adds its designs to the account and brings in the account's, and a notice says how many. Signing out offers to remove everything from the browser. The details are in [cloudflare-plan.md](cloudflare-plan.md) (Phases 2 and 3).

The record of the last sync is kept under `bead-model:sync:<user id>`.

## Limits

Signed out: per browser and per site address, lost when site data is cleared, and about 5 MB in all. A large flat design is a few tens of kB, so hundreds of designs fit. Signed in, the account keeps a copy, so clearing the browser loses nothing that has synced. A shared feed (designs by other people) is for later: designs already have an `is_public` column for it.
