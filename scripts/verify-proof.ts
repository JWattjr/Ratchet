import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  EXPLORER_URL,
  PROOF_PATH,
  ROOT,
  asRecord,
  canonicalJson,
  consensusStatus,
  executionStatus,
  explorerTx,
  loadDeployment,
  publicEvidenceBase,
  readClient,
  readContract,
  readJsonFile,
  receiptStatus,
  requireSuccessfulReceipt,
  sha256,
  writeJson,
} from "./studio.js";

const reportPath = resolve(ROOT, "deploy", "verification-report.json");

function recordFrom(value: unknown, label: string): Record<string, unknown> {
  return asRecord(value, label);
}

async function readRecord(address: string, method: string, args: (string | number)[] = []) {
  return recordFrom(await readContract(address, method, args), method);
}

async function main() {
  const deployment = await loadDeployment();
  if (!deployment || typeof deployment.contract !== "string" || typeof deployment.deployTransaction !== "string") {
    throw new Error("No complete Studio Next deployment manifest exists. Run npm run deploy first.");
  }
  const proof = await readJsonFile(PROOF_PATH);
  if (proof.contract !== deployment.contract || proof.network !== "studioDevnet" || proof.chain_id !== 61997) {
    throw new Error("Studio proof refers to a different contract or network than the deployment manifest.");
  }
  const evidenceBase = publicEvidenceBase();
  if (proof.evidence_base !== evidenceBase) throw new Error("Proof evidence origin does not match RATCHET_EVIDENCE_BASE_URL.");
  const client = readClient();
  const txResults: Record<string, unknown>[] = [];

  const deploymentReceipt = await readJsonFile(resolve(ROOT, "artifacts", "studio-next-deploy-receipt.json"));
  const deploymentRecord = deploymentReceipt as Record<string, unknown>;
  requireSuccessfulReceipt(deploymentRecord as never, "Saved deployment");
  const deployTx = await client.getTransaction({ hash: deployment.deployTransaction as never });
  requireSuccessfulReceipt(deployTx as never, "Live Studio Next deployment");
  txResults.push({ action: "deploy", hash: deployment.deployTransaction, explorer_url: explorerTx(deployment.deployTransaction), lifecycle: receiptStatus(deployTx as never), execution: executionStatus(deployTx as never), consensus: consensusStatus(deployTx as never) });

  const releases = proof.releases;
  if (!Array.isArray(releases) || releases.length !== 3) throw new Error("Proof must contain three on-chain demo releases.");
  for (const raw of releases) {
    const item = recordFrom(raw, "proof release");
    const releaseId = String(item.release_id);
    const onchainRelease = await readRecord(deployment.contract, "get_release", [releaseId]);
    const onchainReceipt = await readRecord(deployment.contract, "get_receipt", [releaseId]);
    if (String(onchainRelease.state) !== item.state || String(onchainReceipt.verdict) !== item.actual_verdict) {
      throw new Error(`${releaseId} proof differs from current finalized contract state.`);
    }
    if (canonicalJson(onchainReceipt) !== canonicalJson(item.receipt)) throw new Error(`${releaseId} saved adjudication receipt differs from the live contract receipt.`);

    const transactionProofs = item.transactions;
    if (!Array.isArray(transactionProofs) || transactionProofs.length !== 3) throw new Error(`${releaseId} must preserve create, seal, and adjudicate transaction receipts.`);
    for (const transactionRaw of transactionProofs) {
      const tx = recordFrom(transactionRaw, "transaction proof");
      const hash = String(tx.hash);
      if (tx.explorer_url !== explorerTx(hash) || tx.lifecycle !== "FINALIZED") throw new Error(`${releaseId}/${String(tx.action)} has an invalid final transaction link.`);
      const bytes = await readFile(resolve(ROOT, String(tx.receipt_file)));
      const localHash = createHash("sha256").update(bytes).digest("hex");
      if (localHash !== tx.receipt_sha256) throw new Error(`${releaseId}/${String(tx.action)} local receipt file hash mismatch.`);
      const savedReceipt = JSON.parse(bytes.toString("utf8")) as Record<string, unknown>;
      requireSuccessfulReceipt(savedReceipt as never, `${releaseId}/${String(tx.action)} saved receipt`);
      const live = await client.getTransaction({ hash: hash as never });
      requireSuccessfulReceipt(live as never, `${releaseId}/${String(tx.action)} live Studio receipt`);
      txResults.push({ release_id: releaseId, action: tx.action, hash, explorer_url: tx.explorer_url, lifecycle: receiptStatus(live as never), execution: executionStatus(live as never), consensus: consensusStatus(live as never), local_receipt_sha256: localHash });
    }
    for (const field of ["declaration_url", "replay_report_url", "ci_report_url"] as const) {
      const url = String(item[field]);
      if (!url.startsWith(`${evidenceBase}/`)) throw new Error(`${releaseId} ${field} points outside the proof origin.`);
      const response = await fetch(url, { redirect: "error", cache: "no-store" });
      if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}.`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const hashField = field === "declaration_url" ? "declaration_hash" : field === "replay_report_url" ? "replay_report_hash" : "ci_report_hash";
      if (sha256(bytes) !== item[hashField]) throw new Error(`${releaseId} hosted ${field} content no longer matches its pinned hash.`);
    }
  }

  const report = {
    schema_version: "1",
    verified_at: new Date().toISOString(),
    network: "studioDevnet",
    chain_id: 61997,
    contract: deployment.contract,
    explorer: EXPLORER_URL,
    verified_transactions: txResults,
    verified_release_count: releases.length,
    hosted_evidence_hashes_verified: true,
    live_contract_receipts_match: true,
  };
  await writeJson(reportPath, report);
  console.log(`Verified ${txResults.length} finalized Studio Next transactions, 3 live release receipts, and 9 hosted evidence hashes.`);
  console.log(`Saved verification summary to ${reportPath}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
