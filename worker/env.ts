// What the Worker gets from wrangler.jsonc: the D1 database, plain vars and secrets.

export interface Env {
  DB: D1Database;
  /** The site's address, e.g. "https://bead-model.bead-model.workers.dev" (or "http://localhost:5173" in dev). */
  BETTER_AUTH_URL: string;
  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** "1" turns on email + password sign-in. Local dev and tests only: hashing passwords is too much CPU for the free plan. */
  ALLOW_PASSWORD?: string;
}

/** The Hono app's types: the bindings, and the signed-in user's id once `signedIn` has run. */
export interface AppEnv {
  Bindings: Env;
  Variables: { userId: string };
}
