# My Beads: How the Data Is Saved

**Status: as built.** Signed out, the list is kept only in the browser, as described below. **Signed in, it also syncs with the account**, one row per bead: see [my-designs.md](my-designs.md#accounts) and [cloudflare-plan.md](cloudflare-plan.md). The last section was the proposal that led to this.

"My beads" is the list of beads someone has at home (see the README). The designers use it when **Colors from** is set to **My beads** (it can also be every catalog color or a [palette](preset-palettes.md)). This note says where the list lives today, what is in it, what that means for users, and how a backend with user accounts could take over later.

## Where it lives today

Everything is kept in the browser's **localStorage**, on the user's own device. Nothing is sent to a server. The site is static (Vite build, hosted on Vercel), so there is no backend to send it to.

| Key | What it holds | Example |
|---|---|---|
| `bead-model:my-beads` | The list, as JSON (format below) | `{"version":1,"beads":[…]}` |
| `bead-model:color-source` | Where the designers take their colors from | `"all"`, `"mine"` or `"palette:ocean"` |
| `bead-model:only-my-beads` | Whether that's My beads. Older than the color source, and kept for the moved-site import | `"true"` or `"false"` |
| `bead-model:my-palettes` | Palettes I saved ([format](preset-palettes.md#phase-2-my-own-palettes-built)) | `{"version":1,"palettes":[…]}` |
| `bead-model:my-beads-size` | The bead size last picked on the My beads page (a convenience only) | `"miyuki delica DB"` |

To look at it: open the site, open DevTools, then go to **Application → Local Storage →** the site's address.

### The code

| File | Job |
|---|---|
| [`src/collection/my-beads.ts`](../src/collection/my-beads.ts) | The data: types, reading and checking JSON, add, remove and update, merge, grouping by size, the readable text export. Plain TypeScript, no browser APIs, tested in [`test/my-beads.test.ts`](../test/my-beads.test.ts). |
| [`web/my-beads-store.ts`](../web/my-beads-store.ts) | The only code that touches localStorage: `loadMyBeads`, `saveMyBeads`, `loadOnlyMine`, `saveOnlyMine`, and `onMyBeadsChange` (listens for the `storage` event, so other open tabs update). |
| [`web/beads.ts`](../web/beads.ts) | The My beads page. Saves after every change. |
| [`web/editor.ts`](../web/editor.ts), [`web/flat.ts`](../web/flat.ts) | Read the list and the setting. They never write the list. |

Every storage call is wrapped in `try`/`catch`. If storage is off (some private windows), the page still works and warns that the list won't be kept.

## The format

```json
{
  "version": 1,
  "beads": [
    { "kind": "catalog", "bead": "miyuki DB-0010", "amount": "10 g" },
    { "kind": "catalog", "bead": "miyuki DB-0035" },
    { "kind": "own", "size": "miyuki delica DB", "name": "dusty rose", "rgb": "#c48a90", "note": "for the whale" }
  ]
}
```

| Field | Kind | Meaning |
|---|---|---|
| `kind` | both | `catalog` for a bead in the [catalog](bead-catalog.md), `own` for a color the catalog doesn't have |
| `bead` | catalog | Product code with brand, as patterns write it: `"<brand> <code>"` |
| `size` | own | Bead size as `"<brand> <line> <size>"`, the form `resolveBeadSize` takes |
| `name`, `rgb` | own | The color's name and display color (`#rrggbb`) |
| `amount`, `note` | both, optional | Free text, e.g. `"2 tubes"`, `"for the whale"`. Left out when empty. |

Rules:

- **One entry per bead.** A catalog bead is identified by its product code (case doesn't matter), an own color by size + name (`ownedId`). Adding a bead twice keeps the first one.
- **Only references are stored, not catalog data.** Names, display colors and sizes come from the catalog when the list is shown. Fixing a color in the catalog fixes it in everyone's list.
- **Reading is forgiving.** `myBeadsFromJson` drops entries it can't read instead of failing, so a damaged or newer file still loads what it can.
- **`version`** is there for a future change of format. Today it is always `1`.

The **Back up (.json)** file uses this same format, with my palettes in a `palettes` list next to `beads`. **Restore…** merges a backup in: beads you don't have are added, and beads you already have stay as they are.

The **Export as text…** output is for people to read. It is not read back in; the JSON backup is the file to restore from.

## What this means for users

- **It stays:** the list survives reloads, closing the tab and restarting the browser, in the same browser, profile and site address.
- **It's per browser and per address:** Chrome and Safari, a phone and a laptop, and `localhost:5173` and `bead-model.vercel.app` each have their own list.
- **It can be lost:** clearing site data or history deletes it, and a private window drops it when it closes. Browsers can also clear storage for sites not visited in a long time (Safari does this after about 7 days without a visit).
- **It's private:** the list never leaves the device unless the user downloads a backup.
- **Size isn't a concern:** an entry is about 60 bytes, and localStorage allows about 5 MB per site, so even thousands of beads fit.

## Later: user accounts and a backend (proposal, now built)

This is now built on Cloudflare Workers + D1, following this plan. The one difference: the stores stayed synchronous. `web/sync.ts` works out changes by comparing localStorage with a record of the last sync, instead of the pages going through an async remote store.

localStorage is enough for one person on one browser. User accounts would add sync across devices, a list that survives clearing the browser, and room for features such as sharing a list or tracking beads used per design.

### Plan

1. **Keep the seam.** Pages only talk to `web/my-beads-store.ts`. Turn it into an interface with two implementations: the current one (localStorage) and a remote one (API). The pages and `src/collection/my-beads.ts` don't change. Making loading async is the only change the pages need.
2. **Keep localStorage as the offline copy.** Signed out, things work as they do today. Signed in, the remote store is the source of truth and the local copy is a cache, so the page opens instantly and works offline.
3. **Move the data over on first sign-in.** If the browser has a list, offer to upload it. If the account already has one, merge them with `mergeMyBeads`, the same rule as Restore, so nothing is lost.
4. **Store per bead, not one big document.** One record per owned bead, keyed by `ownedId`, with `updatedAt`. Editing on two devices then only conflicts when both change the same bead, and the newest change wins.
5. **Keep the JSON format as the API format.** Backups, the API and the database export all use `version: 1`.

### Options for the backend

| Option | Fits because | Watch out for |
|---|---|---|
| **Firebase** (Auth + Firestore) | No server to run, works with the static Vercel site, offline cache built in, Google and email sign-in | Security rules must make sure each user reads and writes only their own data |
| **Supabase** (Auth + Postgres) | SQL, so easier to query later (e.g. "which designs can I make with my beads") | Row-level security must be set per table |
| **Own API** (e.g. Vercel functions + a database) | Full control | Sign-in, sessions and backups to build and run ourselves |

A possible Firestore layout: `users/{uid}/beads/{ownedId}` holding the bead fields plus `updatedAt`, and `users/{uid}` holding settings such as `onlyMine`.

### Open questions

- Should "Only my beads" be saved to the account, or stay per device?
- Do users want to share a list (a link, or a list shared by a group)?
- Should `amount` become structured (grams or a count), so designs can warn when a piece needs more beads than you have?
- How long to keep the data of a deleted account, and how users export or delete their data.
