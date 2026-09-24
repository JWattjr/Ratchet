import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { SubmitInput } from "@genlayer/transaction-kit";
import {
  DEPLOYMENT_PATH,
  CHAIN_ID,
  NETWORK,
  NETWORK_LABEL,
  NETWORK_SLUG,
  EXPLORER_URL,
  PENDING_PATH,
  PROOF_PATH,
  ROOT,
  asRecord,
  canonicalJson,
  consensusStatus,
  deployerAccount,
  executionStatus,
  explorerTx,
  feeArgs,
  loadDeployment,
  publicEvidenceBase,
  quote,
  readContract,
  readJsonFile,
  receiptStatus,
  requireSuccessfulReceipt,
  sha256,
  stringify,
  waitFor,
  writeClient,
  writeJson,
} from "./studio.js";

const artifactPath = resolve(ROOT, "deploy", "demo-artifacts.json");
const seedReceiptDir = resolve(ROOT, "artifacts", `${NETWORK_SLUG}-seed`);
const finalStates: Record<string, string> = { ADVANCE: "ADVANCED", HOLD: "HELD", ROLLBACK: "ROLLED_BACK" };

type ActionProof = { action: string; hash: string; explorer_url: string; lifecycle: string; execution: string; consensus: string; receipt_file: string; receipt_sha256: string };

async function submitAction(account: Awaited<ReturnType<typeof deployerAccount>>, address: string, actionKey: string, method: string, args: unknown[]): Promise<ActionProof> {
  await mkdir(seedReceiptDir, { recursive: true });
  const actionPath = resolve(seedReceiptDir, `${actionKey}.json`);
  let hash: string | undefined;
  try {
    const pending = await readJsonFile(PENDING_PATH);
    if (pending.kind === "write" && pending.action_key === actionKey && typeof pending.hash === "string") hash = pending.hash;
  } catch { /* no matching pending write */ }
  if (!hash) {
    const tx: SubmitInput = { kind: "write", address: address as `0x${string}`, method, args };
    const priced = await quote(tx);
    console.log(`${actionKey}: submitting ${method} (${priced.gasless ? "gasless" : "live fee quote"}).`);
    hash = await (await writeClient(account)).writeContract({ address: address as `0x${string}`, functionName: method, args: args as never, ...feeArgs(priced) });
    await writeJson(PENDING_PATH, { kind: "write", action_key: actionKey, hash, submitted_at: new Date().toISOString() });
  }
  const finalHash = hash;
  if (!finalHash) throw new Error(`${actionKey} did not produce a transaction hash.`);
  const receipt = await waitFor(finalHash);
  try {
    requireSuccessfulReceipt(receipt as never, `${actionKey}`);
  } catch (error) {
    const failedReceipt = resolve(seedReceiptDir, `${actionKey}.failed-${finalHash.slice(2, 10)}.json`);
    const receiptFile = `artifacts/${NETWORK_SLUG}-seed/${actionKey}.failed-${finalHash.slice(2, 10)}.json`;
    await writeJson(failedReceipt, receipt);
    await writeJson(PENDING_PATH, { kind: "write", action_key: `${actionKey}-failed-${finalHash.slice(2, 10)}`, hash: finalHash, state: "FAILED", receipt_file: receiptFile });
    throw error;
  }
  await writeJson(actionPath, receipt);
  await writeJson(PENDING_PATH, { kind: "write", action_key: actionKey, hash: finalHash, state: "FINALIZED" });
  const bytes = await readFile(actionPath);
  return { action: actionKey, hash: finalHash, explorer_url: explorerTx(finalHash), lifecycle: receiptStatus(receipt as never), execution: executionStatus(receipt as never), consensus: consensusStatus(receipt as never), receipt_file: `artifacts/${NETWORK_SLUG}-seed/${actionKey}.json`, receipt_sha256: createHash("sha256").update(bytes).digest("hex") };
}

async function savedActionProof(address: string, actionKey: string): Promise<ActionProof | undefined> {
  const receiptPath = resolve(seedReceiptDir, `${actionKey}.json`);
  let bytes: Buffer;
  try {
    bytes = await readFile(receiptPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const receipt = asRecord(JSON.parse(bytes.toString("utf8")), `${actionKey} saved receipt`);
  requireSuccessfulReceipt(receipt as never, `${actionKey} saved receipt`);
  const hash = typeof receipt.hash === "string" ? receipt.hash : "";
  const target = String(receipt.to_address ?? receipt.recipient ?? "");
  if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error(`${actionKey} saved receipt has an invalid transaction hash.`);
  if (target.toLowerCase() !== address.toLowerCase()) return undefined;
  return {
    action: actionKey,
    hash,
    explorer_url: explorerTx(hash),
    lifecycle: receiptStatus(receipt as never),
    execution: executionStatus(receipt as never),
    consensus: consensusStatus(receipt as never),
    receipt_file: `artifacts/${NETWORK_SLUG}-seed/${actionKey}.json`,
    receipt_sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

async function parsedRead(address: string, method: string, args: (string | number)[] = []): Promise<Record<string, unknown>> {
  const value = await readContract(address, method, args);
  return asRecord(value, method);
}

function empty(value: unknown): boolean {
  return value === undefined || value === null || value === "" || (typeof value === "object" && value !== null && Object.keys(value).length === 0);
}

async function verifyHostedArtifacts(artifacts: Record<string, unknown>, base: string): Promise<Record<string, unknown>[]> {
  const releases = artifacts.releases;
  if (!Array.isArray(releases) || releases.length !== 3) throw new Error("demo-artifacts.json must list the three Ratchet releases.");
  const checked: Record<string, unknown>[] = [];
  for (const item of releases) {
    const row = asRecord(item, "demo release artifact");
    const refs = [
      { kind: "declaration", url: row.declaration_url, expected: row.declaration_hash },
      { kind: "replay_report", url: row.replay_report_url, expected: row.replay_report_hash },
      { kind: "ci_report", url: row.ci_report_url, expected: row.ci_report_hash },
    ];
    for (const ref of refs) {
      if (typeof ref.url !== "string" || !ref.url.startsWith(`${base}/`) || typeof ref.expected !== "string") throw new Error(`${String(row.release_id)} has an invalid hosted ${ref.kind} reference.`);
      const response = await fetch(ref.url, { redirect: "error", cache: "no-store" });
      if (!response.ok) throw new Error(`${ref.url} returned HTTP ${response.status}; publish/deploy the artifacts before seeding.`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      const actual = sha256(bytes);
      if (actual !== ref.expected) throw new Error(`${ref.url} hash mismatch; rerun prepare:demo and redeploy before seeding.`);
      checked.push({ release_id: row.release_id, artifact: ref.kind, url: ref.url, sha256: actual, byte_length: bytes.byteLength, http_status: response.status });
    }
  }
  return checked;
}

async function main() {
  const deployment = await loadDeployment();
  if (!deployment || typeof deployment.contract !== "string") throw new Error("Run npm run deploy first; there is no deployed Ratchet address.");
  const address = deployment.contract;
  const artifacts = await readJsonFile(artifactPath);
  const base = publicEvidenceBase();
  if (artifacts.evidence_base !== base) throw new Error("demo-artifacts.json targets a different origin; run prepare:demo again after choosing the public app origin.");
  const hostedArtifacts = await verifyHostedArtifacts(artifacts, base);
  const releaseArtifacts = artifacts.releases as Record<string, unknown>[];
  const account = await deployerAccount();
  const releaseProofs: Record<string, unknown>[] = [];
  let previousReleaseProofs = new Map<string, Record<string, unknown>>();
  try {
    const previous = await readJsonFile(PROOF_PATH);
    if (previous.contract === address && Array.isArray(previous.releases)) {
      previousReleaseProofs = new Map(previous.releases.map((row) => {
        const value = asRecord(row, "previous release proof");
        return [String(value.release_id), value];
      }));
    }
  } catch { /* no earlier proof to preserve */ }
  let unexpectedVerdict = false;

  for (const item of releaseArtifacts) {
    const releaseId = String(item.release_id);
    const expectedUrl = String(item.declaration_url);
    const declarationFile = resolve(ROOT, String(item.declaration_file));
    const declarationText = await readFile(declarationFile, "utf8");
    const declaration = JSON.parse(declarationText) as Record<string, unknown>;
    const compact = canonicalJson(declaration);
    const declarationBytes = Buffer.from(compact, "utf8");
    const declarationHash = sha256(declarationBytes);
    if (declarationHash !== item.declaration_hash) throw new Error(`${releaseId} declaration file does not match its canonical manifest hash.`);

    const actionProofs: ActionProof[] = [];
    const byAction = new Map<string, ActionProof>();
    for (const actionKey of [`${releaseId}-create`, `${releaseId}-seal`, `${releaseId}-adjudicate`]) {
      const saved = await savedActionProof(address, actionKey);
      if (saved) byAction.set(actionKey, saved);
    }
    let release: Record<string, unknown>;
    try {
      release = await parsedRead(address, "get_release", [releaseId]);
    } catch {
      actionProofs.push(await submitAction(account, address, `${releaseId}-create`, "create_release", [
        releaseId,
        compact,
        expectedUrl,
        declarationHash,
        stringify(artifacts.policy),
      ]));
      release = await parsedRead(address, "get_release", [releaseId]);
    }
    let state = String(release.state);
    if (state === "DRAFT") {
      actionProofs.push(await submitAction(account, address, `${releaseId}-seal`, "seal_release", [releaseId]));
      state = String((await parsedRead(address, "get_release", [releaseId])).state);
    }
    let receipt: Record<string, unknown>;
    try { receipt = await parsedRead(address, "get_receipt", [releaseId]); } catch { receipt = {}; }
    if (state === "SEALED") {
      actionProofs.push(await submitAction(account, address, `${releaseId}-adjudicate`, "adjudicate", [releaseId]));
      release = await parsedRead(address, "get_release", [releaseId]);
      receipt = await parsedRead(address, "get_receipt", [releaseId]);
      state = String(release.state);
    }
    if (empty(receipt)) throw new Error(`${releaseId} is ${state} without a finalized on-chain adjudication receipt.`);
    const verdict = String(receipt.verdict);
    const expectedState = finalStates[verdict];
    if (state !== expectedState) throw new Error(`${releaseId}: receipt verdict ${verdict} conflicts with state ${state}.`);
    if (verdict !== (releaseId.endsWith("ADVANCE") ? "ADVANCE" : releaseId.endsWith("HOLD") ? "HOLD" : "ROLLBACK")) unexpectedVerdict = true;
    const bondValue = release.bond;
    const bond = typeof bondValue === "string" ? JSON.parse(bondValue) as Record<string, unknown> : asRecord(bondValue, "bond");
    const previousActions = previousReleaseProofs.get(releaseId)?.transactions;
    if (Array.isArray(previousActions)) for (const raw of previousActions) {
      const prior = asRecord(raw, "prior transaction proof");
      if (typeof prior.action === "string" && typeof prior.hash === "string") byAction.set(prior.action, prior as unknown as ActionProof);
    }
    for (const action of actionProofs) byAction.set(action.action, action);
    const allActions = [...byAction.values()];
    releaseProofs.push({
      release_id: releaseId,
      state,
      expected_scenario: releaseId.endsWith("ADVANCE") ? "ADVANCE" : releaseId.endsWith("HOLD") ? "HOLD" : "ROLLBACK",
      actual_verdict: verdict,
      evidence_status: receipt.evidence_status,
      declaration_hash: item.declaration_hash,
      replay_report_hash: item.replay_report_hash,
      ci_report_hash: item.ci_report_hash,
      bond,
      receipt,
      transactions: allActions,
      declaration_url: item.declaration_url,
      replay_report_url: item.replay_report_url,
      ci_report_url: item.ci_report_url,
      explorer_transaction_urls: allActions.map((action) => action.explorer_url),
    });
    console.log(`${releaseId}: finalized ${verdict} (${state}); on-chain bond ${JSON.stringify(bond)}.`);
  }

  const proof = {
    schema_version: "1",
    network: NETWORK,
    chain_id: CHAIN_ID,
    contract: address,
    deploy_transaction: deployment.deployTransaction,
    deploy_explorer_url: deployment.deployExplorer,
    signer: account.address,
    evidence_base: base,
    evidence_verification: hostedArtifacts,
    replay_method: "local-hardhat deterministic EVM replay; no independent hosted CI run is claimed",
    policy: artifacts.policy,
    releases: releaseProofs,
    verified_at: new Date().toISOString(),
  };
  await writeJson(PROOF_PATH, proof);
  console.log(`Saved ${NETWORK_LABEL} transaction and adjudication proof to ${PROOF_PATH}.`);
  if (unexpectedVerdict) throw new Error("The network's actual validator verdict differed from at least one demo label; proof preserves the actual outcomes.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
