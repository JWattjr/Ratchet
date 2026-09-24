import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const frontend = resolve(root, "frontend");
const env = {
  ...process.env,
  NEXT_PUBLIC_RATCHET_NETWORK: "studionet",
  RATCHET_SCREENSHOT_DIR: "artifacts/screenshots",
};
const result = spawnSync(process.execPath, [
  resolve(frontend, "scripts", "browser-check.mjs"),
  "--verdicts",
  "--responsive",
  "--screenshots",
], { cwd: root, env, stdio: "inherit" });

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
