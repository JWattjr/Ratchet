import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  CONTRACT_PATH,
  DEPLOYMENT_PATH,
  EXPLORER_URL,
  PENDING_PATH,
  ROOT,
  RUNNER_HASH,
  asRecord,
  checkRunner,
  deployerAccount,
  ensureFunded,
  explorerAddress,
  explorerTx,
  feeArgs,
  quote,
  readClient,
  readContract,
  receiptStatus,
  requireSuccessfulReceipt,
  sha256,
  stringify,
  waitFor,
  writeClient,
  writeJson,
} from "./studio.js";

const deploymentMirror = resolve(ROOT, "frontend", "lib", "deployment.json");
const schemaPath = resolve(ROOT, "deploy", "studio-next-schema.json");
const receiptPath = resolve(ROOT, "artifacts", "studio-next-deploy-receipt.json");

async function main() {
  const codeBytes = await readFile(CONTRACT_PATH);
  const code = codeBytes.toString("utf8");
  const runner = checkRunner(code);
  const client = readClient();
  const schema = await client.getContractSchemaForCode(code);
  await writeJson(schemaPath, schema);
  const account = await deployerAccount();
  const chainId = BigInt(String(await (await import("./studio.js")).rpc("eth_chainId")));
  if (chainId !== 61_997n) throw new Error(`Connected Studio chain id ${chainId}; expected 61997.`);
  await ensureFunded(account.address);

  let hash: string | undefined;
  try {
    const pending = await (await import("./studio.js")).readJsonFile(PENDING_PATH);
    if (pending.kind === "deploy" && pending.code_hash === sha256(codeBytes) && typeof pending.hash === "string") {
      hash = pending.hash;
      console.log(`Resuming finality check for pending deployment ${hash}.`);
    }
  } catch { /* no matching deploy is pending */ }

  if (!hash) {
    const tx = { kind: "deploy", code } as const;
    const priced = await quote(tx);
    console.log(`Submitting Ratchet deployment with ${priced.gasless ? "gasless" : "Transaction Kit fee estimate"}.`);
    hash = await (await writeClient(account)).deployContract({ code, ...feeArgs(priced) });
    await writeJson(PENDING_PATH, { kind: "deploy", code_hash: sha256(codeBytes), hash, submitted_at: new Date().toISOString() });
  }

  const receipt = await waitFor(hash);
  await writeJson(receiptPath, receipt);
  requireSuccessfulReceipt(receipt as never, "Ratchet deployment");
  const record = receipt as unknown as Record<string, unknown>;
  const decoded = record.txDataDecoded as Record<string, unknown> | undefined;
  const data = record.data as Record<string, unknown> | undefined;
  const address = [decoded?.contractAddress, decoded?.contract_address, data?.contract_address, data?.contractAddress, record.contract_address]
    .find((value): value is string => typeof value === "string" && /^0x[0-9a-fA-F]{40}$/.test(value));
  if (!address) throw new Error("Deployment finalized but its receipt did not include a contract address. Receipt saved for inspection.");

  const [versionRaw, ownerRaw, statsRaw] = await Promise.all([
    readContract(address, "get_contract_version"),
    readContract(address, "get_contract_owner"),
    readContract(address, "get_stats"),
  ]);
  const version = String(versionRaw);
  if (version !== "ratchet/1.0.9") throw new Error(`Deployed contract reported unexpected version ${version}.`);
  const owner = String(ownerRaw);
  const stats = asRecord(statsRaw, "get_stats");
  const deployment = {
    network: "studioDevnet",
    chainId: 61997,
    rpc: "https://studio-dev.genlayer.com/api",
    explorer: EXPLORER_URL,
    contract: address,
    owner,
    deployTransaction: hash,
    deployExplorer: explorerTx(hash),
    addressExplorer: explorerAddress(address),
    deployedAt: new Date().toISOString(),
    contractVersion: version,
    runner: RUNNER_HASH,
    runnerHeader: runner,
    sourceSha256: sha256(codeBytes),
    abiSchema: "deploy/studio-next-schema.json",
    initialStats: stats,
    receiptStatus: receiptStatus(record as never),
    deployer: account.address,
  };
  await writeJson(DEPLOYMENT_PATH, deployment);
  await writeJson(deploymentMirror, {
    network: deployment.network,
    chainId: deployment.chainId,
    rpc: deployment.rpc,
    explorer: deployment.explorer,
    contract: deployment.contract,
    owner: deployment.owner,
    deployTransaction: deployment.deployTransaction,
    deployedAt: deployment.deployedAt,
    runner: deployment.runner,
  });
  await writeJson(PENDING_PATH, { kind: "deploy", hash, code_hash: sha256(codeBytes), state: "FINALIZED", address });
  console.log(`Ratchet ${version} deployed at ${address} on Studio Next (chain 61997).`);
  console.log(`Deployment transaction: ${explorerTx(hash)}`);
  console.log("Deployer private key remains in the ignored .keys directory and was not printed.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : stringify(error));
  process.exitCode = 1;
});
