# Accounts and a Database

**Status: proposal.** Today My designs and My beads live only in the browser's localStorage (see [my-designs.md](my-designs.md) and [my-beads-storage.md](my-beads-storage.md)). This note covers how sign-in and a real database could take over, and where to host it for free.

## Recommendation

- **Frontend:** keep the static Vite build on Vercel, where it is today. Cloudflare Pages or Netlify would also work.
- **Backend:** **Supabase** free plan, for Postgres, sign-in (email magic link, Google, GitHub) and row level security.
- **No server code.** The browser talks to Supabase directly with `@supabase/supabase-js` and the public anon key. Row level security means each person can only read and write their own rows.

Why Supabase fits this app:

- The data is relational and small: a design is one YAML text of a few tens of kB, and a bead is one short row.
- Row level security replaces a backend, so the site stays static.
- It's plain Postgres, so you can leave with `pg_dump` at any time.

## Schema

The schema is in [`supabase/migrations/0001_accounts.sql`](../supabase/migrations/0001_accounts.sql).

| Table | One row per | Key | Replaces (localStorage) |
|---|---|---|---|
| `auth.users` | account (managed by Supabase Auth) | `id` | — |
| `profiles` | account | `id` → `auth.users` | `bead-model:profile-name`, `bead-model:only-my-beads` |
| `designs` | design | `id` (uuid), plus `unique (owner_id, local_id)` | `bead-model:my-designs` → `designs[]` |
| `pins` | pinned design or example | `(owner_id, target)` | `bead-model:my-designs` → `pinned[]` |
| `owned_beads` | bead someone owns | `(owner_id, bead_key)` = `ownedId()` | `bead-model:my-beads` |

```
auth.users 1─1 profiles
     │
     ├─1─n designs      (kind, title, yaml, is_public, created_at, updated_at)
     ├─1─n pins         (target = design id or "example:<kind>:<name>")
     └─1─n owned_beads  (catalog code, or own size/name/rgb; amount, note)
```

Choices:

- **`designs.yaml` stays the source of truth.** It is the downloadable file, the same as `SavedDesign.yaml`, so the parsers don't change and a design can always be exported. `kind` and `title` are copied out so the feed can list and search without parsing.
- **`local_id`** keeps the old `d…` id, so uploading a browser's designs on first sign-in can be done as an upsert and run twice without making copies.
- **`pins.target` is text, not a foreign key**, because pins can point at the examples that ship with the app. When a design is deleted, the app also deletes its pin, as `removeDesign` does today.
- **One row per owned bead** (as the My beads proposal says), so editing on two devices only clashes on the same bead, and the newest change wins.
- **Catalog data is not stored.** Beads are stored as references (`"miyuki DB-0010"`), and names and colors still come from `catalog/`.
- **`is_public`** is there for a shared feed later. One policy already lets anyone read a shared design. Nothing sets it yet.
- **Thumbnails aren't stored.** They are drawn from the YAML in the browser (`src/gallery/thumbnail.ts`), so no file storage is needed.
- **Size checks:** a design is at most 1 MB and a title at most 200 characters, so one account can't fill the free 500 MB.

Rough capacity: at about 30 kB per design, 500 MB holds about 15,000 designs.

## How the app changes

This follows the plan in [my-beads-storage.md](my-beads-storage.md#later-user-accounts-and-a-backend-proposal):

1. `web/designs-store.ts` and `web/my-beads-store.ts` become interfaces with two implementations: localStorage (signed out) and Supabase (signed in). The pages and `src/collection/*` stay as they are. Loading becomes async.
2. When you're signed in, localStorage stays as the cache, so pages open instantly and work offline. This also covers a paused free project (see below).
3. On first sign-in, offer to upload the browser's lists: upsert designs on `(owner_id, local_id)`, beads on `(owner_id, bead_key)`, and pins on `(owner_id, target)`.
4. Add a sign-in button to the top bar (`web/nav.ts`) and an auth callback. Add the site's Vercel URL (and `http://localhost:5173`) to Supabase Auth's redirect URLs.
5. Configuration: `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` as Vercel environment variables. The anon key is meant to be public, and RLS is what protects the data. Never put the `service_role` key in the frontend.

## Free hosting options

Figures are from third-party write-ups in 2026. Check the official pricing pages before relying on them.

| Option | Free allowance (approx.) | Good | Watch out |
|---|---|---|---|
| **Supabase** (recommended) | 500 MB Postgres, 50,000 monthly active users, 2 projects, ~1 GB file storage | Postgres + Auth + RLS in one, no server code, easy to leave | **Pauses after 7 days with no activity**; restore it from the dashboard. No backups on the free plan: run `pg_dump` yourself now and then. |
| **Firebase** (Spark) | Firestore 1 GiB, 50k reads / 20k writes a day, Auth ~50,000 MAU | Doesn't pause, generous Auth, security rules | Document database (NoSQL), so lists, pins and future queries are less natural. Firestore rules to learn. Over quota = shut off until the next day or month. |
| **Neon** Postgres + Better Auth / Auth.js | ~0.5 GB Postgres, scales to zero | Real Postgres, wakes up on its own (no manual restore) | Needs server code for sign-in and the API (Vercel functions), so more to build and secure. |
| **Cloudflare** Pages + D1 (SQLite) + Workers | Generous reads/writes, 5 GB D1 | Fast, doesn't pause, one vendor | You write the auth and API in Workers yourself. |

Hosting the frontend is free on all of them: Vercel Hobby (personal, non-commercial use), Cloudflare Pages, or Netlify.

### The Supabase pause

A free project that gets no requests for a week is paused, and API calls fail until you press Restore in the dashboard. Because signed-in pages keep localStorage as a cache (step 2), the app still opens and edits locally while paused, and syncs once the project is back. If the site gets regular visitors, the pause never happens. If it needs to be always on, Pro is $25 a month.

## Setup steps (Supabase)

1. Create a project at supabase.com, in the region nearest your users (e.g. Singapore).
2. In the SQL editor, run `supabase/migrations/0001_accounts.sql`, or with the CLI run `supabase link` then `supabase db push`.
3. Under Authentication → Providers, turn on Email (magic link) and, optionally, Google or GitHub.
4. Under Authentication → URL configuration, add the Vercel URL and `http://localhost:5173`.
5. Add `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in Vercel (and in `.env.local` for dev, which git should ignore).
6. `npm install @supabase/supabase-js`, then build the Supabase store implementations.
