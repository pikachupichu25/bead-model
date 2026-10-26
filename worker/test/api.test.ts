// The API against a real local D1 (Miniflare, through wrangler's getPlatformProxy),
// with a fresh database per run. Accounts are made with email + password, which
// only local dev and these tests turn on.

import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getPlatformProxy } from "wrangler";
import type { SyncPull, SyncPushResult } from "../../src/collection/sync.js";
import type { Env } from "../env.js";
import app from "../index.js";

const SITE = "http://localhost:5173";
const root = new URL("../../", import.meta.url).pathname;
const persist = mkdtempSync(join(tmpdir(), "bead-model-d1-"));
let proxy: Awaited<ReturnType<typeof getPlatformProxy<Env>>>;
let env: Env;

beforeAll(async () => {
  proxy = await getPlatformProxy<Env>({ configPath: join(root, "wrangler.jsonc"), persist: { path: persist }, envFiles: [] });
  env = { ...proxy.env, BETTER_AUTH_URL: SITE, BETTER_AUTH_SECRET: "test-secret-0123456789abcdef0123456789abcdef", ALLOW_PASSWORD: "1" };
  for (const file of readdirSync(join(root, "migrations")).sort()) {
    const sql = readFileSync(join(root, "migrations", file), "utf8");
    const statements = sql
      .split(/;\s*$/m)
      .map((s) => s.replace(/^\s*--.*$/gm, "").trim())
      .filter(Boolean);
    await env.DB.batch(statements.map((s) => env.DB.prepare(s)));
  }
}, 60_000);

afterAll(async () => {
  await proxy?.dispose();
  rmSync(persist, { recursive: true, force: true });
});

async function call(path: string, init: RequestInit & { cookie?: string } = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  if (init.method && init.method !== "GET" && !headers.has("origin")) headers.set("origin", SITE);
  return app.fetch(new Request(`${SITE}${path}`, { ...init, headers }), env);
}

/** Makes an account and returns its session cookie. */
async function signUp(email: string): Promise<string> {
  const res = await call("/api/auth/sign-up/email", {
    method: "POST",
    body: JSON.stringify({ email, password: "test-pass-123", name: email.split("@")[0] }),
  });
  expect(res.status).toBe(200);
  return res.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

const pull = async (cookie: string, since = 0) => (await (await call(`/api/sync?since=${since}`, { cookie })).json()) as SyncPull;
const push = async (cookie: string, changes: unknown) =>
  (await (await call("/api/sync", { method: "POST", cookie, body: JSON.stringify(changes) })).json()) as SyncPushResult;

const design = (id: string, updated: number, title = "Heart") => ({
  id,
  kind: "flat",
  title,
  yaml: `title: ${title}\n`,
  created: 1000,
  updated,
});

describe("the API", () => {
  let alice: string;
  let bob: string;

  beforeAll(async () => {
    alice = await signUp("alice@example.test");
    bob = await signUp("bob@example.test");
  });

  it("says who is signed in", async () => {
    const me = (await (await call("/api/me", { cookie: alice })).json()) as { user: { email: string }; counts: object };
    expect(me.user.email).toBe("alice@example.test");
    expect(me.counts).toEqual({ designs: 0, beads: 0 });
    const nobody = (await (await call("/api/me")).json()) as { user: null };
    expect(nobody.user).toBeNull();
  });

  it("refuses sync when signed out, or from another site", async () => {
    expect((await call("/api/sync")).status).toBe(401);
    const res = await call("/api/sync", { method: "POST", cookie: alice, headers: { origin: "https://evil.example" }, body: "{}" });
    expect(res.status).toBe(403);
  });

  it("keeps each account's designs apart", async () => {
    await push(alice, { designs: [design("d1", 2000, "Alice's heart")] });
    await push(bob, { designs: [design("d1", 2000, "Bob's heart")] });
    expect((await pull(alice)).designs.map((d) => d.title)).toEqual(["Alice's heart"]);
    expect((await pull(bob)).designs.map((d) => d.title)).toEqual(["Bob's heart"]);
  });

  it("keeps the newer change, and returns it for an older one", async () => {
    await push(alice, { designs: [design("d2", 5000, "New")] });
    const result = await push(alice, { designs: [design("d2", 4000, "Old")] });
    expect(result.rejected.designs.map((d) => d.title)).toEqual(["New"]);
    const again = await push(alice, { designs: [design("d2", 6000, "Newer")] });
    expect(again.rejected.designs).toEqual([]);
    expect((await pull(alice)).designs.find((d) => d.id === "d2")?.title).toBe("Newer");
  });

  it("pulls only what changed since the last pull, deletions included", async () => {
    const first = await pull(alice);
    await push(alice, { designs: [{ id: "d1", kind: "flat", updated: 7000, deleted: true }] });
    const next = await pull(alice, first.now);
    expect(next.designs).toEqual([expect.objectContaining({ id: "d1", deleted: true, yaml: "" })]);
    // An older edit made on another device doesn't bring it back.
    const stale = await push(alice, { designs: [design("d1", 6500)] });
    expect(stale.rejected.designs[0]?.deleted).toBe(true);
  });

  it("keeps pins, beads and the profile", async () => {
    await push(alice, {
      pins: [{ target: "example:flat:heart-band", pinned: true, pinnedAt: 100, updated: 100 }],
      beads: [
        { bead: { kind: "catalog", bead: "miyuki DB-0010", amount: "10 g" }, updated: 100 },
        { bead: { kind: "own", size: "miyuki delica DB", name: "dusty rose", rgb: "#c48a90" }, updated: 100 },
      ],
      profile: { name: "Alice", onlyMyBeads: true, updated: 100 },
    });
    await push(alice, { beads: [{ key: "catalog:miyuki db-0010", deleted: true, updated: 200 }] });
    const all = await pull(alice);
    expect(all.pins).toEqual([{ target: "example:flat:heart-band", pinned: true, pinnedAt: 100, updated: 100 }]);
    expect(all.beads.find((b) => b.key === "catalog:miyuki db-0010")).toMatchObject({ deleted: true, bead: { bead: "miyuki DB-0010" } });
    expect(all.beads.find((b) => b.key === "own:miyuki delica db:dusty rose")?.bead).toMatchObject({ name: "dusty rose" });
    expect(all.profile).toEqual({ name: "Alice", colorSource: "mine", onlyMyBeads: true, updated: 100 });
    expect((await pull(bob)).beads).toEqual([]);
  });

  it("keeps palettes and the color source", async () => {
    const sea = { id: "my-sea", name: "Sea", colors: [{ bead: "miyuki DB-0726" }, { rgb: "#2a6f97", name: "sea blue" }], visibility: "private" };
    await push(alice, { palettes: [{ palette: sea, updated: 300 }], profile: { name: "Alice", colorSource: "palette:my-sea", updated: 300 } });
    let all = await pull(alice);
    expect(all.palettes).toEqual([{ id: "my-sea", palette: sea, updated: 300 }]);
    expect(all.profile).toMatchObject({ colorSource: "palette:my-sea", onlyMyBeads: false });
    expect((await pull(bob)).palettes).toEqual([]);
    // An older page sends only "only my beads".
    await push(alice, { profile: { name: "Alice", onlyMyBeads: true, updated: 400 } });
    expect((await pull(alice)).profile?.colorSource).toBe("mine");
    await push(alice, { palettes: [{ id: "my-sea", deleted: true, updated: 500 }] });
    all = await pull(alice);
    expect(all.palettes).toEqual([{ id: "my-sea", updated: 500, deleted: true }]);
  });

  it("drops rows it can't read, and refuses too many at once", async () => {
    const result = await push(alice, { designs: [{ id: "bad", kind: "nope", yaml: 1, updated: 1 }], pins: [{}] });
    expect(result.rejected).toEqual({ designs: [], pins: [], beads: [], palettes: [] });
    const many = Array.from({ length: 150 }, (_, i) => design(`m${i}`, 1));
    expect((await call("/api/sync", { method: "POST", cookie: alice, body: JSON.stringify({ designs: many }) })).status).toBe(400);
  });
});
