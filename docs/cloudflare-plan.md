# Plan: Accounts on Cloudflare (Workers + D1)

**Status: chosen. Phases 0 and 1 are done, apart from steps that need you (marked "needs you").** Picked over [Vercel + Neon](neon-vercel-plan.md) for the free headroom, daily (not monthly) limits that stop only the API, and commercial use on the free plan. [accounts-and-database.md](accounts-and-database.md) keeps the comparison of the options. The goal is the same: sign in, then My designs, pins and My beads are kept in a database and follow you to any device. Signed out, everything works as it does today.

## The stack

| Piece | Choice | Why |
|---|---|---|
| Site | **Workers with static assets** (the Vite `dist/`) | Cloudflare now points new projects at Workers rather than Pages. One project serves both the pages and the API on one origin. Static files are served free and don't count as requests. Pages + Functions would also work, but newer features land on Workers first. |
| API | One Worker, with [Hono](https://hono.dev) for routing, under `/api/*` | Small, made for Workers, typed. |
| Database | **D1** (SQLite), one database `bead-model` | Free, close to the Worker, plain SQL, managed with `wrangler d1 migrations`. |
| Sign-in | **[Better Auth](https://better-auth.com)**, storing its tables in D1, with **Google and GitHub** sign-in | Cloudflare has no user sign-in of its own. Better Auth runs in a Worker and keeps sessions in an HTTP-only cookie on our own origin. |
| Email sign-in | Later: magic link through Resend (free tier) | Needs an email sender. Not needed to launch. |

**No passwords.** The free Worker plan allows 10 ms of CPU per request, and a proper password hash (scrypt, Argon2) uses more than that. Google/GitHub sign-in and magic links don't hash anything, so they fit. Add passwords only on the paid plan ($5 a month).

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
  routes/designs.ts, pins.ts, beads.ts, me.ts, import.ts
migrations/
  0001_auth.sql     Better Auth's tables (from its getMigrations())
  0002_app.sql      profiles, designs, pins, owned_beads (below)
wrangler.jsonc      assets → ./dist/client, run the Worker first for /api/*, the D1 binding
test/worker/        API tests in the Workers runtime (@cloudflare/vitest-pool-workers)
web/
  account.ts        sign in / sign out / current user (/api/me and Better Auth's endpoints)
  nav.ts            the Sign in menu in the top bar
  designs-store.ts, my-beads-store.ts   become local + remote (see Phase 3)
```

`src/` doesn't change. The Worker reuses `src/collection/*` to check incoming data (`myDesignsFromJson`, `ownedId`, and so on), so the browser and the server check data the same way.

`wrangler.jsonc`, roughly:

```jsonc
{
  "name": "bead-model",
  "main": "worker/index.ts",
  "compatibility_date": "2026-10-01",
  "compatibility_flags": ["nodejs_compat"],
  "assets": { "directory": "./dist", "run_worker_first": ["/api/*"] },
  "d1_databases": [{ "binding": "DB", "database_name": "bead-model", "database_id": "…" }]
}
```

Secrets, set with `wrangler secret put` and never committed: `BETTER_AUTH_SECRET`, `GOOGLE_CLIENT_ID/SECRET`, `GITHUB_CLIENT_ID/SECRET`. For local dev, put them in `.dev.vars` (add it to `.gitignore`).

## Schema (D1 / SQLite)

Better Auth creates `user`, `session`, `account` and `verification` (`user.id` is text). Our tables hang off `user`. Times are milliseconds since 1970, as the app already uses (`SavedDesign.created`). D1 enforces foreign keys.

```sql
-- migrations/0002_app.sql
CREATE TABLE profiles (
  user_id       TEXT PRIMARY KEY REFERENCES user(id) ON DELETE CASCADE,
  display_name  TEXT NOT NULL DEFAULT '' CHECK (length(display_name) <= 80),
  only_my_beads INTEGER NOT NULL DEFAULT 0 CHECK (only_my_beads IN (0, 1)),
  updated_at    INTEGER NOT NULL
);

CREATE TABLE designs (
  id         TEXT PRIMARY KEY,                 -- crypto.randomUUID(), made by the Worker
  owner_id   TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  local_id   TEXT,                             -- the "d…" id from localStorage, for safe re-upload
  kind       TEXT NOT NULL CHECK (kind IN ('peyote', 'flat', 'nora')),
  title      TEXT NOT NULL DEFAULT 'Untitled design' CHECK (length(title) <= 200),
  yaml       TEXT NOT NULL CHECK (length(yaml) <= 1000000),
  is_public  INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),  -- shared feed, later
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (owner_id, local_id)
);
CREATE INDEX designs_owner_updated ON designs (owner_id, updated_at DESC);

CREATE TABLE pins (                            -- a design id or "example:<kind>:<name>"
  owner_id  TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  target    TEXT NOT NULL CHECK (length(target) <= 200),
  pinned_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, target)
) WITHOUT ROWID;

CREATE TABLE owned_beads (                     -- one row per bead, keyed by ownedId()
  owner_id   TEXT NOT NULL REFERENCES user(id) ON DELETE CASCADE,
  bead_key   TEXT NOT NULL,
  kind       TEXT NOT NULL CHECK (kind IN ('catalog', 'own')),
  bead       TEXT,                             -- catalog: "miyuki DB-0010"
  size       TEXT,                             -- own: "miyuki delica DB"
  name       TEXT,
  rgb        TEXT CHECK (rgb IS NULL OR rgb GLOB '#[0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f][0-9a-f]'),
  amount     TEXT CHECK (length(amount) <= 100),
  note       TEXT CHECK (length(note) <= 500),
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (owner_id, bead_key),
  CHECK ((kind = 'catalog' AND bead IS NOT NULL)
      OR (kind = 'own' AND size IS NOT NULL AND name IS NOT NULL AND rgb IS NOT NULL))
) WITHOUT ROWID;
```

The design choices are the same as in [accounts-and-database.md](accounts-and-database.md#schema): the YAML stays the source of truth, catalog data isn't copied in, thumbnails are drawn in the browser, and there's one row per bead.

### Access control lives in the Worker

D1 has no row level security. **Every query goes through `worker/db.ts`, and every query there takes the user id from the session, never from the request.** It is `WHERE owner_id = ?` with the session's id, on reads, updates and deletes alike. A test per route signs in as user A and checks that user B's rows can't be read, changed or deleted.

Other guards:
- Cookies are `HttpOnly; Secure; SameSite=Lax`. Requests that change data must come with an `Origin` header matching the site.
- Request bodies are capped at 1 MB.
- Rate limiting is optional later (Cloudflare's Rate Limiting binding), mainly on `/api/auth/*`.

## API

All JSON, all under `/api`, all need a session except `/api/auth/*` and reading a shared design.

| Method and path | Does |
|---|---|
| `/api/auth/*` | Better Auth: start Google/GitHub sign-in, callback, session, sign out |
| `GET /api/me` | The user, profile and counts |
| `PATCH /api/me` | Change the display name or `only_my_beads` |
| `GET /api/designs?since=<ms>` | My designs (without `yaml` unless asked), changed since a time, for sync |
| `GET /api/designs/:id` | One design, with `yaml` |
| `PUT /api/designs/:id` | Create or replace. Body is `{ kind, title, yaml, created, updated }`. The newer `updated` wins, and an older one gets `409` with the server copy. |
| `DELETE /api/designs/:id` | Delete it, and its pin |
| `GET /api/pins` · `PUT /api/pins/:target` · `DELETE /api/pins/:target` | Pins |
| `GET /api/beads` · `PUT /api/beads/:key` · `DELETE /api/beads/:key` | My beads, one bead at a time |
| `POST /api/import` | First sign-in upload: `{ designs, pinned, beads }` in the localStorage formats. Uses one `DB.batch()`, upserting on `(owner_id, local_id)` and `(owner_id, bead_key)`, so it's safe to run twice. |

## Phases

### Phase 0: move hosting to Cloudflare (no accounts yet)

1. ✅ Add `wrangler.jsonc` with assets only. `npm run serve:cf` builds the site and serves it with Wrangler on port 8787. Every page and the `#example=` links work there. Old `/flat.html` links redirect to `/flat` and keep their `#…`. `npm run deploy` publishes it (after `npx wrangler login` once). It is live at https://bead-model.bead-model.workers.dev.
2. ✅ Every page checked on workers.dev.
3. **To do (needs you):** connect the GitHub repo in the Cloudflare dashboard (Workers → bead-model → Settings → Builds), so a push to `main` deploys and branches get preview URLs. Use the build command `npm run build` and the deploy command `npx wrangler deploy -c dist/bead_model/wrangler.json`. Until then, deploy with `npm run deploy`.
4. Keep Vercel running until the end of Phase 4.

Done when the static site works on workers.dev and deploys on push.

### Phase 1: sign-in

1. ✅ Created the D1 database `bead-model` (APAC) and bound it as `DB`.
2. ✅ Added the Worker: `worker/index.ts` (Hono), `worker/auth.ts` (Better Auth, which takes the D1 binding directly) and `worker/env.ts`. `migrations/0001_auth.sql` comes from Better Auth's `getMigrations()` (`better-auth/db/migration`). It is applied locally (`npm run db:migrate`) and on Cloudflare (`npm run db:migrate:remote`).
3. ✅ Added a **Sign in** menu at the end of the top bar (`web/nav.ts`, `web/account.ts`). It shows only the providers whose keys are set, and nothing at all on a host without the API (such as Vercel). When you're signed in, it shows an avatar with your name and **Sign out**.
4. ✅ Local dev: `@cloudflare/vite-plugin` runs the Worker and a local D1 inside `npm run dev`, which serves the site and API on http://localhost:5173. Its settings come from `.dev.vars`, which is ignored by git. There, `ALLOW_PASSWORD=1` turns on email + password sign-in, for trying things without OAuth keys (local only). `vite build` now writes `dist/client` (the pages) and `dist/bead_model` (the Worker and the deploy config).
5. ✅ Deployed with the `BETTER_AUTH_SECRET` secret set. On workers.dev, `/api/me` works and email + password is off.
6. **To do (needs you): the Google and GitHub OAuth apps.** See [Setting up Google and GitHub sign-in](#setting-up-google-and-github-sign-in). Until their keys are set, the live site shows no Sign in button.

Done when you can sign in and out with Google and GitHub, locally and on workers.dev, and `/api/me` returns you. Everything except the OAuth apps is done and was tested locally with email + password.

#### Setting up Google and GitHub sign-in

The callback URL is `<site>/api/auth/callback/<provider>`, for both `https://bead-model.bead-model.workers.dev` and `http://localhost:5173`.

- **GitHub:** go to Settings → Developer settings → OAuth Apps → New OAuth App. Set the homepage to the site URL and the callback to `…/api/auth/callback/github`. GitHub allows one callback per app, so make one app for the live site and one for localhost.
- **Google:** go to Google Cloud console → APIs & Services → Credentials → Create OAuth client ID (Web application). Add both origins under Authorized JavaScript origins, and both `…/api/auth/callback/google` under Authorized redirect URIs. Set up the OAuth consent screen with app name, support email and the `email` and `profile` scopes.

Then put the keys in place:

```
npx wrangler secret put GITHUB_CLIENT_ID      # and GITHUB_CLIENT_SECRET, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET
```

For local dev, add the same four lines to `.dev.vars`, using the localhost GitHub app. Secrets take effect without redeploying.

### Phase 2: data API

1. Add `0002_app.sql`, `worker/db.ts` and the routes above, checking input with the `src/collection/*` readers.
2. Write tests with `@cloudflare/vitest-pool-workers`. These cover each route, the owner checks (user A vs B), "newer `updated` wins", and an import run twice that leaves no copies.
3. Make the profile row on first `/api/me`.

Done when the tests pass and `npm test` runs them alongside the existing ones.

### Phase 3: the app uses it

1. Make the store seam async. `designs-store.ts` and `my-beads-store.ts` export the same functions, now returning promises. The pages await them, and `src/collection/*` doesn't change.
2. **Local first.** localStorage stays the working copy the pages read and write at once. When signed in, a small sync module:
   - pushes each change (debounced about 3 s, and on `pagehide` with `fetch(…, { keepalive: true })`),
   - keeps a queue of changes not yet sent (in localStorage) and retries when back online,
   - pulls `?since=<last sync>` on page load and on focus, and merges by `updated`.
3. **First sign-in on a browser that has data:** show "Upload this browser's designs and beads to your account?" and send it with `POST /api/import`. If the account already has data, merge (same rules as Restore: nothing is lost).
4. **Signing out** clears the account's data from this browser (ask first), so a shared computer doesn't keep someone's designs.
5. Update [my-designs.md](my-designs.md) and [my-beads-storage.md](my-beads-storage.md) from "browser only" to the new behaviour.

Done when a design made on a laptop appears on a phone after sign-in, editing offline syncs when back online, and signed-out use works unchanged.

### Phase 4: switch over

1. Optional: a custom domain on Cloudflare (free if the domain's DNS is on Cloudflare). Otherwise use `bead-model.<account>.workers.dev`.
2. Update the README demo link, and the OAuth callback URLs if the domain changed.
3. On Vercel, redirect `bead-model.vercel.app` to the new address, or show a "we moved" page. localStorage doesn't move between addresses, so the page should say: "Open the old site, sign in, and upload", or download a backup there and Restore it on the new site.
4. Turn Vercel off once the redirect has been in place a while.

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
