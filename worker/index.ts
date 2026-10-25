// The Worker: everything under /api. Pages and files are served from the
// assets (dist/) without running it; see wrangler.jsonc.

import { Hono } from "hono";
import { enabledProviders, makeAuth } from "./auth.js";
import type { Env } from "./env.js";

const app = new Hono<{ Bindings: Env }>();

app.on(["GET", "POST"], "/api/auth/*", (c) => makeAuth(c.env).handler(c.req.raw));

/** Who is signed in (or null), and which sign-in buttons to show. */
app.get("/api/me", async (c) => {
  const session = await makeAuth(c.env).api.getSession({ headers: c.req.raw.headers });
  const user = session ? { id: session.user.id, name: session.user.name, email: session.user.email, image: session.user.image ?? null } : null;
  return c.json({ user, providers: enabledProviders(c.env), password: c.env.ALLOW_PASSWORD === "1" });
});

app.all("/api/*", (c) => c.json({ error: "not found" }, 404));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "server error" }, 500);
});

export default app;
