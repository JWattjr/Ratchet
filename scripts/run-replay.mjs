import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verify = process.argv.includes("--verify");
const hardhatBootstrap = resolve(root, "node_modules", "hardhat", "internal", "cli", "bootstrap.js");
const result = spawnSync(process.execPath, [hardhatBootstrap, "run", "replay/scripts/generate.mjs", "--network", "hardhat"], {
  cwd: root,
  env: { ...process.env, ...(verify ? { RATCHET_REPLAY_VERIFY: "1" } : {}) },
  stdio: "inherit",
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
