import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const [outputArgument] = process.argv.slice(2);
if (!outputArgument) throw new Error("Pass an output path for the replay attestation.");
const required = ["GITHUB_SHA", "GITHUB_REPOSITORY", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"];
for (const key of required) if (!process.env[key]) throw new Error(`${key} is missing; the replay attestation must be created by hosted CI.`);

const root = process.cwd();
const digest = async (path) => createHash("sha256").update(await readFile(resolve(root, path))).digest("hex");
const reports = ["honest-advance", "incomplete-replay", "undeclared-capability", "invariant-break"];
const output = resolve(outputArgument);
const reportHashes = {};
for (const name of reports) {
  reportHashes[name] = {
    replay_sha256: await digest(`replay/generated/${name}.json`),
    ci_receipt_sha256: await digest(`replay/generated/${name}.ci.json`),
  };
}
const corpusHash = await digest("replay/corpus/transactions.json");
const server = process.env.GITHUB_SERVER_URL || "https://github.com";
const runUrl = `${server}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}/attempts/${process.env.GITHUB_RUN_ATTEMPT}`;
const attestation = {
  schema_version: "1",
  kind: "hosted-replay-reproducibility-check",
  commit: process.env.GITHUB_SHA,
  run_url: runUrl,
  completed_at: new Date().toISOString(),
  generator: "scripts/run-replay.mjs",
  corpus_sha256: corpusHash,
  reports: reportHashes,
  meaning: "GitHub Actions regenerated the local Hardhat replay and verified the checked-in report bytes and corpus hashes. This is reproducibility evidence, not an independent security audit or exhaustive test.",
};
await mkdir(dirname(output), { recursive: true });
await writeFile(output, `${JSON.stringify(attestation, null, 2)}\n`, "utf8");
console.log(`Wrote hosted replay attestation for ${process.env.GITHUB_SHA} to ${output}.`);
