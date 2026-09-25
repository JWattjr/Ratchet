import { copyFile, mkdir, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import {
  ROOT,
  NETWORK_SLUG,
  canonicalJson,
  publicEvidenceBase,
  readJsonFile,
  sha256,
  writeJson,
} from "./studio.js";

const evidenceDir = resolve(ROOT, "frontend", "public", "evidence", NETWORK_SLUG);
const declarationDir = resolve(evidenceDir, "declarations");
const reportDir = resolve(ROOT, "replay", "generated");
const declarationIds = ["DECL-SOURCE", "DECL-STORAGE", "DECL-PERMISSIONS", "DECL-EXTERNAL-CALLS", "DECL-CAPABILITIES", "DECL-MIGRATION", "DECL-ROLLBACK", "DECL-CORPUS"];
const invariantIds = ["INV-BALANCE-CONSERVATION", "INV-NO-UNDECLARED-ADMIN", "INV-WITHDRAWAL-BOUND"];
const evidenceIds = [...declarationIds, "COVERAGE-REQUIRED-CORPUS"];
const requiredCaseIds = ["ADMIN-WITHDRAW-ALICE-5", "DEPOSIT-ALICE-100", "DEPOSIT-BOB-40", "PAUSE-OFF", "PAUSE-ON", "WITHDRAW-ALICE-10-AFTER-PAUSE", "WITHDRAW-ALICE-20"].sort();

const policy = {
  policy_version: "ratchet-policy/1",
  declaration_ids: declarationIds,
  invariant_ids: invariantIds,
  evidence_ids: evidenceIds,
  required_case_ids: requiredCaseIds,
  retry_limit: 1,
  bond_amount: 90,
  advance_return_pct: 100,
  rollback_slash_pct: 50,
  timeout_consequence: "ROLLBACK_AFTER_HOLD_DEADLINE",
};

const manifest = [
  { releaseId: "RATCHET-ADVANCE", reportFile: "honest-advance.json", ciFile: "honest-advance.ci.json", declaration: "declared" },
  { releaseId: "RATCHET-HOLD", reportFile: "incomplete-replay.json", ciFile: "incomplete-replay.ci.json", declaration: "declared" },
  { releaseId: "RATCHET-ROLLBACK", reportFile: "undeclared-capability.json", ciFile: "undeclared-capability.ci.json", declaration: "undeclared" },
] as const;

function readString(record: Record<string, unknown>, key: string, label: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) throw new Error(`${label}.${key} is missing.`);
  return value;
}

async function main() {
  const base = publicEvidenceBase();
  const git = (args: string[]) => execFileSync("git", ["-c", `safe.directory=${ROOT.replaceAll("\\", "/")}`, ...args], { cwd: ROOT, encoding: "utf8" }).trim();
  const sourceCommit = process.env.RATCHET_SOURCE_COMMIT?.trim() || git(["rev-parse", "HEAD"]);
  if (!/^[0-9a-f]{40}$/i.test(sourceCommit)) throw new Error("RATCHET_SOURCE_COMMIT must be a full Git commit SHA.");
  const dirtyFiles = git(["status", "--porcelain"]);
  if (dirtyFiles) throw new Error("Commit or stash source changes before preparing declarations so their Git provenance is reproducible.");
  const provenance = await readJsonFile(resolve(reportDir, "provenance.json"));
  await mkdir(declarationDir, { recursive: true });
  for (const row of manifest) {
    await copyFile(resolve(reportDir, row.reportFile), resolve(evidenceDir, row.reportFile));
    await copyFile(resolve(reportDir, row.ciFile), resolve(evidenceDir, row.ciFile));
  }
  const output = [];
  for (const row of manifest) {
    const reportBytes = await readFile(resolve(reportDir, row.reportFile));
    const ciBytes = await readFile(resolve(reportDir, row.ciFile));
    const report = JSON.parse(reportBytes.toString("utf8")) as Record<string, unknown>;
    const baseline = report.baseline as Record<string, unknown>;
    const candidate = report.candidate as Record<string, unknown>;
    const corpus = report.corpus as Record<string, unknown>;
    const build = report.build as Record<string, unknown>;
    const reportHash = sha256(reportBytes);
    const ciHash = sha256(ciBytes);
    const candidateHash = readString(candidate, "source_hash", row.reportFile);
    const sourceHash = readString(baseline, "source_hash", row.reportFile);
    const datasetHash = readString(corpus, "dataset_hash", row.reportFile);
    const reportUrl = `${base}/evidence/${NETWORK_SLUG}/${row.reportFile}`;
    const ciUrl = `${base}/evidence/${NETWORK_SLUG}/${row.ciFile}`;
    const declarationUrl = `${base}/evidence/${NETWORK_SLUG}/declarations/${row.releaseId}.json`;
    const declared = row.declaration === "declared";
    const envelope = {
      release_id: row.releaseId,
      current_implementation_hash: sourceHash,
      candidate_implementation_hash: candidateHash,
      source_provenance: {
        repository: process.env.RATCHET_SOURCE_REPOSITORY?.trim() || "https://github.com/JWattjr/Ratchet",
        commit: sourceCommit,
        worktree: "clean before declaration generation",
        baseline_file: "replay/contracts/VaultV1.sol",
        candidate_file: "replay/contracts/VaultV2Declared.sol",
        transaction_corpus_hash: datasetHash,
      },
      build_provenance: {
        compiler: readString(build, "compiler_version", row.reportFile),
        executor: readString(build, "executor", row.reportFile),
        chain_id: build.chain_id,
        hardhat_version: readString(build, "hardhat_version", row.reportFile),
        optimizer: build.optimizer,
        provenance_hash: sha256(canonicalJson(provenance)),
      },
      declared_storage_changes: declared ? [{ field: "paused", type: "bool", slot: "2", reason: "Adds explicit emergency pause state." }] : [],
      declared_permission_changes: declared ? [{ capability: "OWNER_PAUSE_CONTROL", actor: "owner", operations: ["setPaused(bool)"] }] : [],
      declared_external_call_changes: declared ? [{
        operation: "withdraw_recipient_native_transfer",
        case_ids: ["WITHDRAW-ALICE-10-AFTER-PAUSE"],
        expected_behavior: "When the candidate is paused, this withdrawal is rejected before sending value to the recipient. The unpaused withdrawal transfer remains unchanged.",
        reason: "The declared emergency pause feature blocks withdrawals while active.",
      }] : [],
      declared_capabilities: declared ? ["CAP-OWNER-PAUSE"] : [],
      safety_invariants: invariantIds,
      migration_procedure: "Deploy the candidate to a new address; verify the pinned source and replay bundle; transfer application traffic only after an ADVANCE receipt. No proxy migration is executed by Ratchet.",
      rollback_procedure: "Keep the prior implementation available; route traffic back to its verified address and preserve both addresses and receipts for review.",
      replay_dataset: {
        dataset_id: readString(corpus, "dataset_id", row.reportFile),
        dataset_hash: datasetHash,
        required_case_ids: requiredCaseIds,
        replay_report_url: reportUrl,
        replay_report_hash: reportHash,
        ci_report_url: ciUrl,
        ci_report_hash: ciHash,
      },
      policy_version: policy.policy_version,
      retry_limit: policy.retry_limit,
      bond: {
        amount: policy.bond_amount,
        advance_return_pct: policy.advance_return_pct,
        rollback_slash_pct: policy.rollback_slash_pct,
        timeout_consequence: policy.timeout_consequence,
      },
    };
    const declarationBytes = Buffer.from(canonicalJson(envelope), "utf8");
    const path = resolve(declarationDir, `${row.releaseId}.json`);
    const { writeFile } = await import("node:fs/promises");
    await writeFile(path, declarationBytes, "utf8");
    output.push({
      release_id: row.releaseId,
      declaration_file: `frontend/public/evidence/${NETWORK_SLUG}/declarations/${row.releaseId}.json`,
      declaration_url: declarationUrl,
      declaration_hash: sha256(declarationBytes),
      declaration_bytes: declarationBytes.length,
      replay_report_url: reportUrl,
      replay_report_hash: reportHash,
      ci_report_url: ciUrl,
      ci_report_hash: ciHash,
    });
  }
  await writeJson(resolve(ROOT, "deploy", "demo-artifacts.json"), {
    schema_version: "1",
    evidence_base: base,
    policy,
    releases: output,
  });
  console.log(`Prepared ${output.length} hash-pinned declarations for ${base}.`);
  console.log("Publish or redeploy the frontend before running seed:demo; the seeder verifies every public URL first.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
