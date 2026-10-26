# Plan: Accounts on Cloudflare (Workers + D1)

**Status: built. Phases 0–4 are done, apart from steps that need you (marked "needs you"): the Google OAuth client, connecting the GitHub repo for automatic deploys, and merging to `main` to turn on the moved page.** Picked over [Vercel + Neon](neon-vercel-plan.md) for the free headroom, daily (not monthly) limits that stop only the API, and commercial use on the free plan. [accounts-and-database.md](accounts-and-database.md) keeps the comparison of the options. The goal is the same: sign in, then My designs, pins and My beads are kept in a database and follow you to any device. Signed out, everything works as it does today.

## The stack

| Piece | Choice | Why |
|---|---|---|
| Site | **Workers with static assets** (the Vite `dist/`) | Cloudflare now points new projects at Workers rather than Pages. One project serves both the pages and the API on one origin. Static files are served free and don't count as requests. Pages + Functions would also work, but newer features land on Workers first. |
| API | One Worker, with [Hono](https://hono.dev) for routing, under `/api/*` | Small, made for Workers, typed. |
| Database | **D1** (SQLite), one database `bead-model` | Free, close to the Worker, plain SQL, managed with `wrangler d1 migrations`. |
| Sign-in | **[Better Auth](https://better-auth.com)**, storing its tables in D1, with **Google** sign-in (only Google, by choice) | Cloudflare has no user sign-in of its own. Better Auth runs in a Worker and keeps sessions in an HTTP-only cookie on our own origin. |
| Email sign-in | Later: magic link through Resend (free tier) | Needs an email sender. Not needed to launch. |

**No passwords.** The free Worker plan allows 10 ms of CPU per request, and a proper password hash (scrypt, Argon2) uses more than that. Google sign-in and magic links don't hash anything, so they fit. Add passwords only on the paid plan ($5 a month).

## Free limits, and what they mean here

| Limit (Workers Free) | Amount | Used by |
|---|---|---|
| Worker requests | 100,000 a day | API calls only. Pages, scripts and the catalog are static and free. |
| CPU per request | 10 ms | Fine for JSON and SQL. Waiting on D1 doesn't count. Rules out password hashing. |
| D1 rows read | 5 million a day | The feed and lists. Indexed queries keep this low. |
| D1 rows written | 100,000 a day (each index adds a row per write) | **Autosave.** Debounce saves (about 3 s after the last change, plus on close), so a session writes tens of rows, not thousands. |
| D1 storage | 5 GB in all, 500 MB per database | At about 30 kB per design, that's about 15,000 designs per database. |
| Backups | D1 Time Travel: restore to any minute in the last 7 days | Plus `wrangler d1 export` now and then. |

Nothing pauses. Over a daily limit, D1 returns errors until 00:00 UTC. The local copy (below) keeps the app usable meanwhile.

## Repository layout

```
worker/
  index.ts          Hono app: /api/auth/* → Better Auth, the rest → routes
  auth.ts           makeAuth(env): Better Auth, made per request (it needs the D1 binding)
  env.ts            the bindings, vars and secrets
  db.ts             every SQL query, each one filtered by the signed-in user's id
  routes/sync.ts    GET and POST /api/sync
  routes/palettes.ts GET /api/palettes/public (public palettes, for anyone)
  test/api.test.ts  the API against a real local D1 (wrangler's getPlatformProxy)
migrations/
  0001_auth.sql     Better Auth's tables (from its getMigrations())
  0002_app.sql      profiles, designs, pins, owned_beads (below)
  0004_palettes.sql my palettes, with who may see them
  0005_color_source.sql  profiles.color_source (where the designers take colors from)
  0006_palette_tags.sql  palettes.tags
wrangler.jsonc      assets → ./dist/client, run the Worker first for /api/*, the D1 binding
web/
  account.ts        sign in / sign out / current user (/api/me and Better Auth's endpoints)
  nav.ts            the Sign in menu in the top bar
  sync.ts           keeps localStorage and the account in step (Phase 3)
src/collection/sync.ts   the sync format and its readers, shared by the browser and the Worker
```

The Worker reuses `src/collection/*` to check incoming data (`readSavedDesign`, `readOwnedBead`, `ownedId`), so the browser and the server check data the same way.

The config is [`wrangler.jsonc`](../wrangler.jsonc).

Secrets, set with `wrangler secret put` and never committed: `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`. For local dev, put them in `.dev.vars`, which git ignores.

## Schema (D1 / SQLite)

Better Auth's tables are `user`, `session`, `account` and `verification` ([`0001_auth.sql`](../migrations/0001_auth.sql)). Ours are in [`0002_app.sql`](../migrations/0002_app.sql) and the migrations after it, and hang off `user`. D1 enforces foreign keys, so deleting a user deletes their rows.

| Table | Key | Holds |
|---|---|---|
| `profiles` | `user_id` | display name, `color_source`, and `only_my_beads` kept equal to `color_source = 'mine'` for older pages |
| `designs` | `(owner_id, id)`, where `id` is the browser's own `d…` id | `kind`, `title`, `yaml`, `is_public` (for later), `created_at` |
| `pins` | `(owner_id, target)` | `pinned`, `pinned_at` (the newest pin comes first) |
| `owned_beads` | `(owner_id, bead_key)`, where the key is `ownedId()` | a catalog code, or an own size/name/rgb; `amount`, `note` |
| `palettes` | `(owner_id, id)`, where `id` is the browser's own `my-…` id | `name`, `description`, `tags`, `colors` (JSON), `visibility` (`private` or `public`). Public ones are read by anyone through `/api/palettes/public`; see [preset-palettes.md](preset-palettes.md) |

Every table also has:
- **`updated_at`**, when the row last changed on the device that changed it. The newer change wins.
- **`synced_at`**, when the server stored it. A pull asks for rows stored since its last pull, so a device with a wrong clock doesn't miss anything.
- **`deleted`** (or `pinned = 0`): deleting keeps the row as a marker, so other devices learn about it instead of bringing it back.

All times are milliseconds since 1970, as the app already uses. The design choices are the same as in [accounts-and-database.md](accounts-and-database.md#schema): the YAML stays the source of truth, catalog data isn't copied in, thumbnails are drawn in the browser, and there's one row per bead.

Keying designs by the browser's own id (instead of a server uuid plus `local_id`, as first planned) means a browser never has to learn new ids. Uploading the same design twice is just the same row.

### Access control lives in the Worker

D1 has no row level security. **Every query goes through `worker/db.ts`, and every query there takes the user id from the session, never from the request.** It is `WHERE owner_id = ?` with the session's id, on reads, updates and deletes alike. The tests sign in as two users and check that neither sees or overwrites the other's rows.

Other guards:
- Cookies are `HttpOnly; Secure; SameSite=Lax`. Requests that change data must come with an `Origin` header matching the site.
- Request bodies are capped at 2 MB, and a push at 100 rows.
- Rate limiting is optional later (Cloudflare's Rate Limiting binding), mainly on `/api/auth/*`.

## API

All JSON, under `/api`. It's two endpoints besides sign-in, so a page load costs one or two Worker requests.

| Method and path | Does |
|---|---|
| `/api/auth/*` | Better Auth: start Google sign-in, callback, session, sign out |
| `GET /api/me` | The signed-in user (or `null`) with counts of designs and beads, and which sign-in buttons to show |
| `GET /api/sync?since=<now from the last pull>` | Everything of the user's stored since then, as `{ now, designs, pins, beads, profile }`. Without `since`, it returns all of it. |
| `POST /api/sync` | Pushes `{ designs, pins, beads, profile }` (at most 100 rows). Each row is stored only if it's at least as new as the stored one. The reply is `{ now, rejected }`, where `rejected` holds the stored copies of the rows that were newer, for the browser to take. |

The row formats are in [`src/collection/sync.ts`](../src/collection/sync.ts). A design is a `SavedDesign`; a pin is `{ target, pinned, pinnedAt }`; a bead is `{ key, bead }` where `bead` is an `OwnedBead`. Each row adds `updated`, and `deleted: true` for a deletion. First sign-in needs no import endpoint: everything in the browser is pushed as ordinary changes.

## Phases

### Phase 0: move hosting to Cloudflare (no accounts yet)

1. ✅ Add `wrangler.jsonc` with assets only. `npm run serve:cf` builds the site and serves it with Wrangler on port 8787. Every page and the `#example=` links work there. Old `/flat.html` links redirect to `/flat` and keep their `#…`. `npm run deploy` publishes it (after `npx wrangler login` once). It is live at https://bead-model.bead-model.workers.dev.
2. ✅ Every page checked on workers.dev.
3. **To do (needs you):** connect the GitHub repo in the Cloudflare dashboard (Workers → bead-model → Settings → Builds), so a push to `main` deploys and branches get preview URLs. Use the build command `npm run build` and the deploy command `npx wrangler deploy -c dist/bead_model/wrangler.json`. Until then, deploy with `npm run deploy`.
4. Keep Vercel running until the end of Phase 4. It now serves only the moved page, once this branch is merged.

Done when the static site works on workers.dev and deploys on push.

### Phase 1: sign-in

1. ✅ Created the D1 database `bead-model` (APAC) and bound it as `DB`.
2. ✅ Added the Worker: `worker/index.ts` (Hono), `worker/auth.ts` (Better Auth, which takes the D1 binding directly) and `worker/env.ts`. `migrations/0001_auth.sql` comes from Better Auth's `getMigrations()` (`better-auth/db/migration`). It is applied locally (`npm run db:migrate`) and on Cloudflare (`npm run db:migrate:remote`).
3. ✅ Added a **Sign in** menu at the end of the top bar (`web/nav.ts`, `web/account.ts`). It shows only the providers whose keys are set, and nothing at all on a host without the API (such as Vercel). When you're signed in, it shows an avatar with your name and **Sign out**.
4. ✅ Local dev: `@cloudflare/vite-plugin` runs the Worker and a local D1 inside `npm run dev`, which serves the site and API on http://localhost:5173. Its settings come from `.dev.vars`, which is ignored by git. There, `ALLOW_PASSWORD=1` turns on email + password sign-in, for trying things without OAuth keys (local only). `vite build` now writes `dist/client` (the pages) and `dist/bead_model` (the Worker and the deploy config).
5. ✅ Deployed with the `BETTER_AUTH_SECRET` secret set. On workers.dev, `/api/me` works and email + password is off.
6. **To do (needs you): the Google OAuth client.** See [Setting up Google sign-in](#setting-up-google-sign-in). Until its keys are set, the live site shows no Sign in button.

Done when you can sign in and out with Google, locally and on workers.dev, and `/api/me` returns you. Everything except the OAuth client is done and was tested locally with email + password.

#### Setting up Google sign-in

The callback URL is `<site>/api/auth/callback/google`, for both `https://bead-bench.bead-model.workers.dev` and `http://localhost:5173`.

- **Google:** go to Google Cloud console → APIs & Services → Credentials → Create OAuth client ID (Web application). Add both origins under Authorized JavaScript origins, and both `…/api/auth/callback/google` under Authorized redirect URIs. Set up the OAuth consent screen with app name, support email and the `email` and `profile` scopes.

Then put the keys in place:

```
npx wrangler secret put GOOGLE_CLIENT_ID      # then GOOGLE_CLIENT_SECRET
```

For local dev, add the same two lines to `.dev.vars` (one Google client covers both addresses). Secrets take effect without redeploying.

### Phase 2: data API

1. ✅ Added [`0002_app.sql`](../migrations/0002_app.sql) (applied locally and on Cloudflare), `worker/db.ts` and `worker/routes/sync.ts`, with the sync format in `src/collection/sync.ts`.
2. ✅ Tests in `worker/test/api.test.ts` run in `npm test` against a fresh local D1 through wrangler's `getPlatformProxy`. (`@cloudflare/vitest-pool-workers` needs Vitest 4, and this repo uses Vitest 5.) They cover signed-out and wrong-origin requests, keeping two accounts apart, "newer wins", pulling since a time with deletions, pins, beads and the profile, and bad or too-big pushes.
3. ✅ Deployed. A signed-out `/api/sync` returns 401.

### Phase 3: the app uses it

✅ Built as described below: `web/sync.ts`, with the diff and merge in `src/collection/sync.ts` (tested in `test/sync.test.ts`), `web/store-events.ts` (stores announce saves, and sync announces what it brought in) and `web/profile-store.ts`. Tested in the browser on the local dev server:
- First sign-in uploaded the browser's design, pin and bead, and showed the notice.
- A design and pin pushed from "another device" appeared, pinned first.
- An unpin on the page reached the account a few seconds later.
- An emptied browser pulled everything back.
- Signing out and removing from this browser cleared it.

Deployed. It runs on the live site as soon as Google sign-in is set up.

The stores stay as they are, synchronous on localStorage, so no page has to change how it loads or saves. A new `web/sync.ts` runs alongside when someone is signed in:

1. **Diff against the last sync.** It keeps a small record per account (`bead-model:sync:<user id>`) of what the account held after the last sync: each design's `updated`, the pins, each bead, the profile, and the server `now`. Anything in localStorage that differs from it is a change to push; anything missing from localStorage was deleted. Because changes are worked out each time, nothing is lost offline or when a tab closes mid-sync. There's no queue to keep.
2. **Pull, merge, push.** Pull `?since=<now>`. For each row, the newer of the local change and the server's copy wins. Push what's left in batches of 100, take any `rejected` rows, save localStorage, and update the record. Pages already re-draw on the `storage` event from other tabs, and now also re-draw on a `bead-model:synced` event.
3. **When:** on page load, when the tab comes back into view, and a few seconds after a change. The stores announce their saves.
4. **First sign-in on a browser:** there's no record yet, so everything in the browser is pushed and everything in the account is pulled. Nothing is lost, the same rule as Restore. A notice says how many designs and beads were added.
5. **Sign out** syncs first, then offers to remove the account's designs and beads from this browser, so a shared computer doesn't keep them.

### Phase 4: switch over

1. ✅ **The old address becomes a "moved" page.** [`vercel.json`](../vercel.json) makes Vercel skip the install and build, and serve only [`moved/index.html`](../moved/index.html) for every path. It has to, because the Vite build now writes `dist/client`, which Vercel wouldn't serve.
   - **Nothing saved in the browser:** the moved page goes straight to the same page on the new address. `/flat.html#…` becomes `/flat#…`.
   - **Designs or beads saved there:** it offers **Move them and continue**. That opens the new site at `#move-from-old-site`. `web/move.ts` asks the old page for the saved designs, pins, beads and profile name (`postMessage`, with the origin checked both ways), and adds them, the same way as Restore. It then reports back, so the old page stops asking. If the user is signed in, the next sync takes it all to the account.

   Tested locally, with a stand-in for the old site.
2. ✅ The README demo link points to workers.dev.
3. **To do (needs you): turn it on.** Merging this branch into `main` deploys the moved page on Vercel at once. Do it once Google sign-in works on workers.dev. Before then, the new site works but nobody can sign in.
4. **Optional (needs you):** a custom domain (Workers → bead-bench → Settings → Domains & Routes). If you add one, change `BETTER_AUTH_URL` in `wrangler.jsonc`, `NEW` in `moved/index.html`, and the OAuth callback URLs.
5. **Later (needs you):** once people have had time to move (a few months), the Vercel project can go. The moved page is only worth keeping for as long as old bookmarks matter.

### Phase 5: rename the Worker to bead-bench

The app is now called Bead Bench, so the Worker is `bead-bench` and the site lives at https://bead-bench.bead-model.workers.dev. The old Worker name, `bead-model`, now serves only the moved page ([`moved/wrangler.jsonc`](../moved/wrangler.jsonc), `npm run deploy:moved`), the same page Vercel serves. Both old addresses send people (and their saved work) straight to the new one. `web/move.ts` accepts saved work from either. The D1 database keeps its name and id, so accounts and synced data stay as they are.

1. ✅ `wrangler.jsonc`, `vite.config.ts` (the build now writes `dist/bead_bench`), `npm run deploy`, `BETTER_AUTH_URL`, `NEW` in `moved/index.html` and `web/move.ts`.
2. **To do (needs you), in this order:**
   1. Google Cloud console → the OAuth client: add `https://bead-bench.bead-model.workers.dev` under Authorized JavaScript origins and `https://bead-bench.bead-model.workers.dev/api/auth/callback/google` under Authorized redirect URIs. Keep the old ones until step 5.
   2. `npm run deploy`. This creates the new `bead-bench` Worker; the old one keeps running.
   3. Secrets belong to a Worker, so set them again on the new one: `npx wrangler secret put BETTER_AUTH_SECRET` (a new random value is fine: it signs session cookies, which don't carry over to a new address anyway), then `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`. Check that Google sign-in works on the new address.
   4. `npm run deploy:moved`. This replaces the old `bead-model` Worker with the moved page.
   5. If Builds is connected (Phase 0, step 3), connect it to `bead-bench` instead, with the deploy command `npx wrangler deploy -c dist/bead_bench/wrangler.json`, and disconnect it from `bead-model`, or a push would put the full site back on the old name. Then deploy `main` to Vercel too, so its moved page points at the new address.
3. People signed in at the old address sign in once more at the new one. Their account data is unchanged.

### Later

- Email magic link sign-in through Resend.
- A shared feed: an `is_public` toggle, `GET /api/feed`, and a public design page.
- Passwords, only if the Workers paid plan ($5 a month) is adopted.
- If D1's 500 MB per database ever gets tight, move `yaml` into R2 (10 GB free) and keep only metadata in D1.

## Risks and open questions

- **Better Auth on D1:** confirm the current way to pass the D1 binding (its Kysely D1 dialect or built-in support) when starting Phase 1. Pin the version.
- **Vite 8 and the Cloudflare Vite plugin:** check compatibility. The proxy is the fallback.
- **CPU per request:** a big `POST /api/import` that parses many designs could near 10 ms. If so, have the browser send it in chunks of 20 designs.
- **Write budget:** if usage grows past about 1,000 active designers a day, check daily D1 writes in the dashboard before raising the debounce or going paid.

Sources for the limits: Cloudflare's [D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/) and [Workers limits](https://developers.cloudflare.com/workers/platform/limits) pages.
