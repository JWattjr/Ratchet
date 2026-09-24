import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  NETWORK_LABEL,
  NETWORK_SLUG,
  PROOF_PATH,
  ROOT,
  asRecord,
  loadDeployment,
  readClient,
  readJsonFile,
  requireSuccessfulReceipt,
  sha256,
  writeJson,
} from "./studio.js";

async function main() {
  const deployment = await loadDeployment();
  if (!deployment || typeof deployment.contract !== "string" || typeof deployment.deployTransaction !== "string") {
    throw new Error("No complete Studio deployment manifest exists.");
  }
  const proof = await readJsonFile(PROOF_PATH);
  if (proof.contract !== deployment.contract || typeof proof.deploy_transaction !== "string") {
    throw new Error("The Studio proof and deployment manifest refer to different contracts.");
  }
  if (!Array.isArray(proof.releases) || proof.releases.length !== 3) {
    throw new Error("The Studio proof must contain the three seeded releases.");
  }

  const client = readClient();
  const deployReceipt = await client.getTransaction({ hash: deployment.deployTransaction as never });
  requireSuccessfulReceipt(deployReceipt as never, "Live Studio deployment");
  await writeJson(resolve(ROOT, "artifacts", `${NETWORK_SLUG}-deploy-receipt.json`), deployReceipt);

  let restored = 1;
  for (const rawRelease of proof.releases) {
    const release = asRecord(rawRelease, "proof release");
    if (!Array.isArray(release.transactions) || release.transactions.length !== 3) {
      throw new Error(`${String(release.release_id)} must contain create, seal, and adjudicate transactions.`);
    }
    for (const rawTransaction of release.transactions) {
      const transaction = asRecord(rawTransaction, "proof transaction");
      if (typeof transaction.hash !== "string" || typeof transaction.receipt_file !== "string") {
        throw new Error(`${String(release.release_id)} has an incomplete transaction reference.`);
      }
      const receipt = await client.getTransaction({ hash: transaction.hash as never });
      requireSuccessfulReceipt(receipt as never, `${String(release.release_id)}/${String(transaction.action)}`);
      const path = resolve(ROOT, transaction.receipt_file);
      await writeJson(path, receipt);
      transaction.receipt_sha256 = sha256(await readFile(path));
      restored += 1;
    }
  }

  await writeJson(PROOF_PATH, proof);
  console.log(`Restored ${restored} finalized ${NETWORK_LABEL} receipts and refreshed their local SHA-256 pins.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
