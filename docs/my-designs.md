# My Designs, Home and My Profile

**Status: as built (browser only).** Like [My beads](my-beads-storage.md), everything is kept in the browser's localStorage. Nothing is sent to a server.

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

## Limits

The same as My beads: per browser and per site address, lost when site data is cleared, and about 5 MB in all. A large flat design is a few tens of kB, so hundreds of designs fit. There is no backup of My designs yet beyond downloading each design. A shared feed (designs by other people) would need accounts and a backend: see the proposal in [my-beads-storage.md](my-beads-storage.md#later-user-accounts-and-a-backend-proposal).
