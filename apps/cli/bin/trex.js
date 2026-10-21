#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const entrypoint = fileURLToPath(new URL("../src/main.ts", import.meta.url));
const result = spawnSync(process.platform === "win32" ? "bun.exe" : "bun", ["--no-env-file", entrypoint, ...process.argv.slice(2)], {
  stdio: "inherit",
  windowsHide: true,
});

if (result.error) {
  console.error(`Could not start Bun: ${result.error.message}. Install Bun and ensure it is available on PATH.`);
  process.exitCode = 127;
} else if (result.signal) {
  process.exitCode = 1;
} else {
  process.exitCode = result.status ?? 1;
}
