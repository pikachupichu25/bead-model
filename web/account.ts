// Who is signed in, and signing in and out. Talks to the Worker's /api/me and
// Better Auth's endpoints under /api/auth. Where there is no API (a plain static
// host, or the Vite dev server without the Worker), everything says "signed out"
// and the top bar shows no sign-in button.

export interface AccountUser {
  id: string;
  name: string;
  email: string;
  image: string | null;
}

export interface Account {
  user: AccountUser | null;
  /** The sign-in buttons to offer. */
  providers: ("google" | "github")[];
  /** Email + password sign-in (local dev only). */
  password: boolean;
}

let current: Promise<Account | null> | undefined;

/** The account, or null when the site has no API. Asked once per page. */
export function loadAccount(): Promise<Account | null> {
  current ??= fetch("/api/me", { credentials: "same-origin" })
    .then(async (res) => (res.ok && res.headers.get("content-type")?.includes("json") ? ((await res.json()) as Account) : null))
    .catch(() => null);
  return current;
}

/** Goes to Google or GitHub, and comes back to this page. */
export async function signInWith(provider: "google" | "github"): Promise<void> {
  const data = await post<{ url?: string }>("/api/auth/sign-in/social", { provider, callbackURL: location.href });
  if (data.url) location.href = data.url;
}

/** Local dev only: email + password. `create` makes the account first. */
export async function signInWithPassword(email: string, password: string, create: boolean): Promise<void> {
  if (create) await post("/api/auth/sign-up/email", { email, password, name: email.split("@")[0] ?? email });
  else await post("/api/auth/sign-in/email", { email, password });
  location.reload();
}

export async function signOut(): Promise<void> {
  await post("/api/auth/sign-out", {});
  location.reload();
}

async function post<T = unknown>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    credentials: "same-origin",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = (await res.json().catch(() => ({}))) as T & { message?: string };
  if (!res.ok) throw new Error(data.message ?? `sign-in failed (${res.status})`);
  return data;
}
