// The Worker: everything under /api. Pages and files are served from the
// assets (dist/client) without running it; see wrangler.jsonc.

import { Hono } from "hono";
import { createMiddleware } from "hono/factory";
import { enabledProviders, makeAuth } from "./auth.js";
import { countRows } from "./db.js";
import type { AppEnv } from "./env.js";
import { sync } from "./routes/sync.js";

/** Requests bigger than this are refused (a design is at most 1 MB). */
const MAX_BODY = 2_000_000;

const app = new Hono<AppEnv>();

app.on(["GET", "POST"], "/api/auth/*", (c) => makeAuth(c.env).handler(c.req.raw));

/** Changes must come from the site itself (the session cookie alone isn't proof), and not be too big. */
const sameSite = createMiddleware<AppEnv>(async (c, next) => {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    if (c.req.header("origin") !== new URL(c.env.BETTER_AUTH_URL).origin) return c.json({ error: "wrong origin" }, 403);
    if (Number(c.req.header("content-length") ?? 0) > MAX_BODY) return c.json({ error: "too big" }, 413);
  }
  await next();
});

/** Lets the request through only when someone is signed in, and remembers who. */
const signedIn = createMiddleware<AppEnv>(async (c, next) => {
  const session = await makeAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  if (!session) return c.json({ error: "not signed in" }, 401);
  c.set("userId", session.user.id);
  await next();
});

/** Who is signed in (or null), and which sign-in buttons to show. */
app.get("/api/me", async (c) => {
  const session = await makeAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  const user = session
    ? { id: session.user.id, name: session.user.name, email: session.user.email, image: session.user.image ?? null }
    : null;
  const counts = session ? await countRows(c.env.DB, session.user.id) : undefined;
  return c.json({ user, counts, providers: enabledProviders(c.env), password: c.env.ALLOW_PASSWORD === "1" });
});

app.use("/api/sync", sameSite, signedIn);
app.use("/api/sync/*", sameSite, signedIn);
app.route("/api/sync", sync);

app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "server error" }, 500);
});

export default app;
