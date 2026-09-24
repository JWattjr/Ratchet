import { spawnSync } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const venvPython = process.platform === "win32"
  ? resolve(root, ".venv", "Scripts", "python.exe")
  : resolve(root, ".venv", "bin", "python");
const candidates = process.platform === "win32"
  ? [{ command: "py", args: ["-3.12"] }, { command: "python", args: [] }]
  : [{ command: "python3.12", args: [] }, { command: "python3", args: [] }, { command: "python", args: [] }];

if (process.platform === "win32" && process.env.APPDATA) {
  const uvRoot = resolve(process.env.APPDATA, "uv", "python");
  if (existsSync(uvRoot)) {
    for (const entry of readdirSync(uvRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.includes("cpython-3.12")) {
        candidates.push({ command: resolve(uvRoot, entry.name, "python.exe"), args: [] });
      }
    }
  }
}

function run(command, args) {
  return spawnSync(command, args, { cwd: root, stdio: "inherit", env: process.env });
}

if (!existsSync(venvPython)) {
  let selected;
  for (const candidate of candidates) {
    const probe = spawnSync(candidate.command, [...candidate.args, "-c", "import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 12) else 1)"], {
      cwd: root,
      stdio: "ignore",
      env: process.env,
    });
    if (probe.status === 0) {
      selected = candidate;
      break;
    }
  }
  if (!selected) {
    console.error("Python 3.12 is required for the pinned GenLayer toolchain; no compatible interpreter was found.");
    process.exit(2);
  }
  const created = run(selected.command, [...selected.args, "-m", "venv", ".venv"]);
  if (created.status !== 0) process.exit(created.status ?? 1);
}

const install = run(venvPython, ["-m", "pip", "install", "--disable-pip-version-check", "-r", "requirements.txt"]);
if (install.status !== 0) process.exit(install.status ?? 1);
console.log("Ratchet Python environment is ready (.venv, Python 3.12).");
