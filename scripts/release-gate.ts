import {
  CHAIN_ID,
  NETWORK,
  NETWORK_LABEL,
  PROOF_PATH,
  asRecord,
  consensusStatus,
  executionStatus,
  loadDeployment,
  readClient,
  readContract,
  readJsonFile,
  receiptStatus,
  requireSuccessfulReceipt,
} from "./studio.js";

function parseRecord(value: unknown, label: string): Record<string, unknown> {
  return asRecord(value, label);
}

async function main() {
  if (NETWORK !== "studionet") throw new Error("The hosted release gate only authorizes Studionet releases; set RATCHET_NETWORK=studionet.");
  const releaseId = process.env.RELEASE_ID?.trim();
  const expectedHashRaw = process.env.EXPECTED_DECLARATION_HASH?.trim().toLowerCase().replace(/^0x/, "");
  if (!releaseId || !/^[A-Z0-9][A-Z0-9._-]{0,47}$/.test(releaseId)) {
    throw new Error("Set RELEASE_ID to the exact release identifier to authorize.");
  }
  if (!expectedHashRaw || !/^[0-9a-f]{64}$/.test(expectedHashRaw)) {
    throw new Error("Set EXPECTED_DECLARATION_HASH to the expected 32-byte declaration SHA-256.");
  }

  const deployment = await loadDeployment();
  if (!deployment || deployment.network !== NETWORK || Number(deployment.chainId) !== Number(CHAIN_ID) || typeof deployment.contract !== "string") {
    throw new Error("No matching Studionet Ratchet deployment is configured.");
  }

  const release = parseRecord(await readContract(deployment.contract, "get_release", [releaseId]), "on-chain release");
  const receipt = parseRecord(await readContract(deployment.contract, "get_receipt", [releaseId]), "on-chain adjudication receipt");
  const actualHash = String(release.declaration_hash ?? "").toLowerCase().replace(/^0x/, "");
  if (actualHash !== expectedHashRaw) throw new Error(`${releaseId} declaration hash does not match the requested release hash.`);
  if (String(release.state) !== "ADVANCED" || String(receipt.verdict) !== "ADVANCE") {
    throw new Error(`${releaseId} is ${String(release.state)} with verdict ${String(receipt.verdict)}; only finalized ADVANCE outcomes pass this gate.`);
  }
  if (String(receipt.declaration_hash ?? "").toLowerCase().replace(/^0x/, "") !== expectedHashRaw) {
    throw new Error(`${releaseId} adjudication receipt does not bind the expected declaration hash.`);
  }

  const client = readClient();
  const proof = await readJsonFile(PROOF_PATH);
  if (proof.contract !== deployment.contract || proof.network !== NETWORK || Number(proof.chain_id) !== Number(CHAIN_ID) || !Array.isArray(proof.releases)) {
    throw new Error("The saved proof does not match the live Studionet deployment.");
  }
  const proofRelease = proof.releases.map((item) => parseRecord(item, "proof release")).find((item) => item.release_id === releaseId);
  if (!proofRelease || proofRelease.actual_verdict !== "ADVANCE" || proofRelease.declaration_hash !== release.declaration_hash) {
    throw new Error(`${releaseId} has no matching saved ADVANCE proof for this declaration.`);
  }
  const actions = Array.isArray(proofRelease.transactions) ? proofRelease.transactions.map((item) => parseRecord(item, "proof transaction")) : [];
  const action = actions.find((item) => item.action === `${releaseId}-adjudicate`);
  if (!action || typeof action.hash !== "string") throw new Error(`${releaseId} proof has no adjudication transaction.`);
  const liveTransaction = await client.getTransaction({ hash: action.hash as never });
  requireSuccessfulReceipt(liveTransaction as never, `${releaseId} live adjudication`);
  if (receiptStatus(liveTransaction as never) !== "FINALIZED" || !["FINISHED_WITH_RETURN", "SUCCESS"].includes(executionStatus(liveTransaction as never)) || consensusStatus(liveTransaction as never) !== "MAJORITY_AGREE") {
    throw new Error(`${releaseId} adjudication transaction is not finalized with successful majority agreement.`);
  }

  console.log(JSON.stringify({
    authorization: "PASS",
    release_id: releaseId,
    declaration_hash: expectedHashRaw,
    network: NETWORK_LABEL,
    chain_id: CHAIN_ID,
    contract: deployment.contract,
    state: release.state,
    verdict: receipt.verdict,
    adjudication_transaction: action.hash,
    lifecycle: receiptStatus(liveTransaction as never),
    execution: executionStatus(liveTransaction as never),
    consensus: consensusStatus(liveTransaction as never),
    scope: "This gate verifies Ratchet's recorded ADVANCE state. It does not deploy or upgrade an EVM contract.",
  }, null, 2));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
