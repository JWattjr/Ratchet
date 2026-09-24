import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const python = resolve(root, "scripts", "python.mjs");
const requestedNetwork = process.env.RATCHET_NETWORK?.trim() || "studionet";
if (requestedNetwork !== "studionet") {
  throw new Error("Ratchet integration checks target Studionet only.");
}
const network = "studionet";
const result = spawnSync(process.execPath, [
  python,
  "-m", "pytest", "-s", "-p", "no:cacheprovider", "tests/integration", "-q", "--network", network,
], { cwd: root, env: process.env, stdio: "inherit" });

if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
