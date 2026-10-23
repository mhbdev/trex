import { existsSync } from "node:fs";
import { resolve } from "node:path";

export const dashboardDirectory = resolve(import.meta.dir, "../../dashboard");

export function dashboardIsBuilt(directory = dashboardDirectory): boolean {
  return existsSync(resolve(directory, "dist", "index.html"));
}

/** Build the dashboard bundle with the same Bun binary that is running this process. */
export async function buildDashboard(directory = dashboardDirectory): Promise<void> {
  console.log("Building the dashboard. This happens once and takes about a minute...");
  const child = Bun.spawn([process.execPath, "run", "--no-env-file", "build"], { cwd: directory, stdin: "ignore", stdout: "inherit", stderr: "inherit" });
  const code = await child.exited;
  if (code !== 0) throw new Error(`Dashboard build failed with exit code ${code}. Run \`bun install\` in the project folder and retry.`);
  if (!dashboardIsBuilt(directory)) throw new Error("The dashboard build finished but dist/index.html is missing.");
}

export type DashboardProbe = "running" | "stopped" | "occupied";

/** Is a Trex dashboard already listening at this loopback address? */
export async function probeDashboard(address: string, timeoutMs = 2_000): Promise<DashboardProbe> {
  try {
    const response = await fetch(`${address}/api/session`, { signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
    if (response.ok) {
      const body = await response.json().catch(() => null) as { token?: unknown } | null;
      if (body && typeof body.token === "string") return "running";
    }
    return "occupied";
  } catch (error) {
    const code = (error as { code?: string; cause?: { code?: string } }).code ?? (error as { cause?: { code?: string } }).cause?.code;
    if (code === "ECONNREFUSED" || code === "ConnectionRefused" || /ECONNREFUSED|ConnectionRefused|Unable to connect/i.test(String(error))) return "stopped";
    return "occupied";
  }
}

/** Open the URL with the OS default browser. Returns false when no opener is available (for example a headless server). */
export function openInBrowser(url: string): boolean {
  if (process.env.BROWSER === "none") return false;
  const command = process.platform === "win32" ? ["cmd", "/c", "start", "", url]
    : process.platform === "darwin" ? ["open", url]
    : ["xdg-open", url];
  try {
    const child = Bun.spawn(command, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
    child.unref();
    return true;
  } catch {
    return false;
  }
}
