let tokenPromise: Promise<string> | undefined;

async function getSessionToken(refresh = false): Promise<string> {
  if (refresh) tokenPromise = undefined;
  if (!tokenPromise) tokenPromise = fetch("/api/session", { cache: "no-store" }).then(async (response) => {
    if (!response.ok) throw new Error("The local dashboard service is unavailable.");
    const value = await response.json() as { token?: string };
    if (!value.token) throw new Error("The local dashboard session could not be established.");
    return value.token;
  }).catch((error: unknown) => { tokenPromise = undefined; throw error; });
  return tokenPromise;
}

export async function api<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  headers.set("x-trex-session", await getSessionToken());
  let response = await fetch(path, { ...init, headers, cache: "no-store" });
  if (response.status === 401) {
    headers.set("x-trex-session", await getSessionToken(true));
    response = await fetch(path, { ...init, headers, cache: "no-store" });
  }
  const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? `Request failed (${response.status}).`);
  return payload as T;
}

export async function downloadReport(path: string): Promise<void> {
  const headers = new Headers({ "x-trex-session": await getSessionToken() });
  let response = await fetch(path, { headers, cache: "no-store" });
  if (response.status === 401) {
    headers.set("x-trex-session", await getSessionToken(true));
    response = await fetch(path, { headers, cache: "no-store" });
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => ({})) as { error?: { message?: string } };
    throw new Error(payload.error?.message ?? "Report export failed.");
  }
  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url; link.download = "trex-report.html"; link.click();
  URL.revokeObjectURL(url);
}

export async function getToken(refresh = false): Promise<string> { return getSessionToken(refresh); }
