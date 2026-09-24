import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createAccount, createClient, generatePrivateKey } from "genlayer-js";
import { studioDevnet, studionet } from "genlayer-js/chains";
import { TransactionHashVariant, executionResultNumberToName, transactionsStatusNumberToName } from "genlayer-js/types";
import { createTransactionKit, type FeeSuggestions, type SubmitInput } from "@genlayer/transaction-kit";

export const ROOT = process.cwd();
export const CONTRACT_PATH = resolve(ROOT, "contracts", "ratchet.py");
const requestedNetwork = process.env.RATCHET_NETWORK?.trim() || "studioDevnet";
if (requestedNetwork !== "studioDevnet" && requestedNetwork !== "studionet") {
  throw new Error("RATCHET_NETWORK must be studioDevnet or studionet.");
}
export const NETWORK = requestedNetwork;
export const NETWORK_SLUG = NETWORK === "studionet" ? "studionet" : "studio-next";
export const NETWORK_LABEL = NETWORK === "studionet" ? "Studionet" : "Studio Next";
export const DEPLOYMENT_PATH = resolve(ROOT, "deploy", NETWORK === "studionet" ? "ratchet-studionet-deployment.json" : "ratchet-deployment.json");
export const PROOF_PATH = resolve(ROOT, "deploy", `${NETWORK_SLUG}-proof.json`);
export const PENDING_PATH = resolve(ROOT, ".keys", `pending-${NETWORK_SLUG}-transaction.json`);
export const DEPLOYER_KEY_PATH = resolve(ROOT, ".keys", "deployer.key");
export const chain = NETWORK === "studionet" ? studionet : studioDevnet;
export const CHAIN_ID = chain.id;
export const RPC_URL = chain.rpcUrls.default.http[0];
export const EXPLORER_URL = chain.blockExplorers?.default?.url?.replace(/\/$/, "") ?? "https://explorer-studio-dev.genlayer.com";
export const RUNNER_HASH = "5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng";

const nativeFetch = globalThis.fetch.bind(globalThis);
let nextRpcSlot = 0;
const sleep = (ms: number) => new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
globalThis.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (!url.startsWith(RPC_URL)) return nativeFetch(input, init);
  for (let attempt = 0; ; attempt++) {
    const now = Date.now();
    const wait = Math.max(0, nextRpcSlot - now);
    nextRpcSlot = Math.max(now, nextRpcSlot) + 2_200;
    if (wait) await sleep(wait);
    let response: Response;
    try {
      response = await nativeFetch(input instanceof Request ? input.clone() : input, init);
    } catch (error) {
      if (attempt >= 6) throw error;
      await sleep(Math.min(1_000 * 2 ** attempt, 15_000));
      continue;
    }
    const text = await response.clone().text();
    const busy = /server busy|execution slots occupied|retry later/i.test(text);
    const throttled = response.status === 429 || response.status >= 500 || text.includes("-32029") || text.trimStart().startsWith("<") || busy;
    if (!throttled || attempt >= 6) return response;
    let retrySeconds = response.status >= 500 || text.trimStart().startsWith("<") ? 5 : 15;
    try { retrySeconds = JSON.parse(text)?.error?.data?.retry_after_seconds ?? retrySeconds; } catch { /* use bounded default */ }
    await sleep((Number(retrySeconds) + 1) * 1_000);
  }
};

export function stringify(value: unknown): string {
  return JSON.stringify(value, (_key, item) => typeof item === "bigint" ? item.toString() : item, 2);
}

export function canonicalJson(value: unknown): string {
  const sort = (item: unknown): unknown => {
    if (Array.isArray(item)) return item.map(sort);
    if (!item || typeof item !== "object") return item;
    return Object.fromEntries(Object.entries(item as Record<string, unknown>).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, child]) => [key, sort(child)]));
  };
  return JSON.stringify(sort(value));
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function explorerTx(hash: string): string { return `${EXPLORER_URL}/tx/${hash}`; }
export function explorerAddress(address: string): string { return `${EXPLORER_URL}/address/${address}`; }

export async function deployerAccount() {
  let key = process.env.RATCHET_DEPLOYER_KEY?.trim();
  if (key && !/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("RATCHET_DEPLOYER_KEY must be a 32-byte 0x-prefixed private key.");
  if (!key) {
    await mkdir(resolve(ROOT, ".keys"), { recursive: true });
    try {
      key = (await readFile(DEPLOYER_KEY_PATH, "utf8")).trim();
    } catch {
      key = generatePrivateKey();
      await writeFile(DEPLOYER_KEY_PATH, key, { mode: 0o600, flag: "wx" });
      console.log(`Created a fresh ${NETWORK_LABEL} development signer under ignored .keys/. Its private key is not printed.`);
    }
  }
  return createAccount(key as `0x${string}`);
}

export function readClient() { return createClient({ chain }); }
export function writeClient(account: ReturnType<typeof createAccount>) { return createClient({ chain, account }); }

export async function rpc(method: string, params: unknown[] = []): Promise<unknown> {
  const response = await fetch(RPC_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }),
  });
  const body = await response.json() as { result?: unknown; error?: { message?: string } };
  if (!response.ok || body.error) throw new Error(`${method}: ${body.error?.message ?? `HTTP ${response.status}`}`);
  return body.result;
}

export async function ensureFunded(address: string): Promise<void> {
  const balance = BigInt(String(await rpc("eth_getBalance", [address, "latest"])));
  if (balance >= 10n ** 18n) return;
  await rpc("sim_fundAccount", [address, (10n ** 20n).toString()]);
  const funded = BigInt(String(await rpc("eth_getBalance", [address, "latest"])));
  if (funded < 10n ** 18n) throw new Error(`The ${NETWORK_LABEL} development faucet did not fund the deployer.`);
  console.log(`Funded the development signer from ${NETWORK_LABEL}'s test faucet.`);
}

const estimatingProvider = { request: async (): Promise<never> => { throw new Error("Fee estimation uses public chain reads only."); } };

export async function quote(tx: SubmitInput) {
  let suggestions: FeeSuggestions | undefined;
  try {
    const profile = await readJsonFile(resolve(ROOT, "deploy", "ratchet-fee-profile.json"));
    if (String(profile.chainId) === String(chain.id)) suggestions = profile as unknown as FeeSuggestions;
  } catch { /* Use the chain's live default quote until finalized receipts are profiled. */ }
  const kit = createTransactionKit({ chain, provider: estimatingProvider, suggestions });
  const result = await kit.estimate({ preset: "standard" }, tx);
  if (result.verification.status === "mismatch") throw new Error(`${NETWORK_LABEL} fee policy changed during estimation; run the command again for a fresh quote.`);
  return result;
}

export function feeArgs(quoteResult: Awaited<ReturnType<typeof quote>>) {
  return quoteResult.gasless ? {} : {
    fees: { distribution: quoteResult.distribution, feeValue: quoteResult.feeValue },
  };
}

export async function waitFor(hash: string) {
  return readClient().waitForTransactionReceipt({
    hash: hash as never,
    waitUntil: "finalized",
    interval: 10_000,
    retries: 180,
  });
}

type TransactionReceiptLike = {
  statusName?: string;
  status_name?: string;
  status?: number | string;
  txExecutionResultName?: string;
  txExecutionResult?: number;
  resultName?: string;
  result_name?: string;
  data?: Record<string, unknown>;
  to_address?: string;
  recipient?: string;
  [key: string]: unknown;
};

export function receiptStatus(receipt: TransactionReceiptLike): string {
  if (receipt.statusName) return receipt.statusName;
  if (receipt.status_name) return receipt.status_name;
  if (typeof receipt.status === "string") return receipt.status;
  return typeof receipt.status === "number" ? (transactionsStatusNumberToName as Record<string, string>)[String(receipt.status)] ?? "UNKNOWN" : "UNKNOWN";
}

export function executionStatus(receipt: TransactionReceiptLike): string {
  if (receipt.txExecutionResultName) return receipt.txExecutionResultName;
  if (typeof receipt.txExecutionResult === "number") return (executionResultNumberToName as Record<string, string>)[String(receipt.txExecutionResult)] ?? "UNKNOWN";
  const consensus = receipt.consensus_data as { leader_receipt?: Array<{ mode?: string; execution_result?: string }> } | undefined;
  return consensus?.leader_receipt?.filter((item) => item.mode === "leader").at(-1)?.execution_result ?? "UNKNOWN";
}

export function consensusStatus(receipt: TransactionReceiptLike): string {
  if (receipt.resultName) return receipt.resultName;
  if (receipt.result_name) return receipt.result_name;
  const consensus = receipt.consensus_data as Record<string, unknown> | undefined;
  if (typeof consensus?.result_name === "string") return consensus.result_name;
  return "UNKNOWN";
}

export function requireSuccessfulReceipt(receipt: TransactionReceiptLike, label: string): void {
  const status = receiptStatus(receipt);
  const execution = executionStatus(receipt);
  const consensus = consensusStatus(receipt);
  if (status !== "FINALIZED" || !["FINISHED_WITH_RETURN", "SUCCESS"].includes(execution) || consensus !== "MAJORITY_AGREE") {
    throw new Error(`${label} did not finalize with majority agreement (lifecycle ${status}, execution ${execution}, consensus ${consensus}).`);
  }
}

export async function readContract(address: string, functionName: string, args: (string | number)[] = []): Promise<unknown> {
  return readClient().readContract({
    address: address as `0x${string}`,
    functionName,
    args,
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
}

export function asRecord(value: unknown, label: string): Record<string, unknown> {
  let decoded = value;
  if (typeof decoded === "string") {
    try { decoded = JSON.parse(decoded); } catch { throw new Error(`${label} is not valid JSON.`); }
  }
  if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) throw new Error(`${label} is not an object.`);
  return decoded as Record<string, unknown>;
}

export async function readJsonFile(path: string): Promise<Record<string, unknown>> {
  return asRecord(await readFile(path, "utf8"), path);
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(resolve(path, ".."), { recursive: true });
  await writeFile(path, `${stringify(value)}\n`, "utf8");
}

export async function loadDeployment(): Promise<Record<string, unknown> | null> {
  try { return await readJsonFile(DEPLOYMENT_PATH); } catch { return null; }
}

export function checkRunner(code: string): string {
  const header = code.split(/\r?\n/, 1)[0] ?? "";
  if (!header.includes(RUNNER_HASH)) throw new Error("Ratchet contract runner does not match the pinned GenVM hash.");
  return header;
}

export function publicEvidenceBase(): string {
  const value = process.env.RATCHET_EVIDENCE_BASE_URL?.trim() || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "");
  if (!value) throw new Error("Set RATCHET_EVIDENCE_BASE_URL to the deployed HTTPS app origin before preparing or seeding demo evidence.");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Evidence URLs must use a public HTTPS origin without credentials.");
  return url.origin;
}
