import { createClient } from "genlayer-js";
import { TransactionHashVariant, TransactionStatus, executionResultNumberToName, transactionsStatusNumberToName } from "genlayer-js/types";
import { chain, CHAIN_ID, CONTRACT_ADDRESS, EXPLORER_URL, NETWORK_LABEL, RPC_URL } from "./network";
import { guardedProvider, type InjectedProvider } from "./wallet";

export type ReleaseState = "DRAFT" | "SEALED" | "HELD" | "ADVANCED" | "ROLLED_BACK" | "CANCELLED" | string;
export type Release = {
  release_id: string;
  owner: string;
  state: ReleaseState;
  declaration: string;
  declaration_url: string;
  declaration_hash: string;
  replay_report_url: string;
  replay_report_hash: string;
  ci_report_url: string;
  ci_report_hash: string;
  policy: string;
  bond: string;
  attempt_count: number;
  final_result: string;
};
export type Receipt = {
  release_id: string;
  verdict: string;
  evidence_status: string;
  attempt_index: number;
  declaration_hash: string;
  replay_report_hash: string;
  ci_report_hash: string;
  policy_version: string;
  bond: string;
  transaction_hash?: string;
};
export type Attempt = {
  attempt_index: number;
  kind: string;
  declaration_hash: string;
  replay_report_url: string;
  replay_report_hash: string;
  ci_report_url: string;
  ci_report_hash: string;
  verdict?: string;
  normalized_result?: string;
  error_class?: string;
};
export type HistoryEvent = {
  event: string;
  state: string;
  attempt_index?: number;
  declaration_hash?: string;
  normalized_result?: string;
  error_class?: string;
};
export type Stats = Record<string, number>;
export type DashboardSnapshot = {
  version: string;
  stats: Stats;
  releaseIds: string[];
  networkOk: boolean;
  chainId?: string;
  readAt: number;
};
export type SavedProofRelease = {
  release_id: string;
  state: string;
  verdict: string;
  evidence_status: string;
  declaration_hash: string;
  replay_report_hash: string;
  ci_report_hash: string;
  bond: Record<string, unknown>;
  adjudication_transaction: string;
  adjudication_explorer_url: string;
};
export type SavedProofSummary = {
  schema_version: "1";
  proof_kind: "verified-archival-snapshot";
  verified_at: string;
  source_commit: string;
  network: string;
  chain_id: number;
  contract: string;
  explorer: string;
  deployment_transaction: string;
  github_ci_runs: string;
  releases: SavedProofRelease[];
};

let reader: ReturnType<typeof createClient> | null = null;
const readCache = new Map<string, { cachedAt: number; value?: unknown; pending?: Promise<unknown> }>();
const READ_CACHE_MS = 15_000;
function readClient() {
  reader ??= createClient({ chain });
  return reader;
}

export async function readSavedProofSummary(): Promise<SavedProofSummary | null> {
  try {
    const response = await fetch("/proof/verified-summary.json", { cache: "no-store", credentials: "omit" });
    if (!response.ok) return null;
    const summary = await response.json() as SavedProofSummary;
    if (summary.schema_version !== "1" || summary.proof_kind !== "verified-archival-snapshot" || !Array.isArray(summary.releases)) return null;
    return summary;
  } catch {
    return null;
  }
}

function requireContractAddress(): `0x${string}` {
  if (!CONTRACT_ADDRESS) throw new Error(`No Ratchet contract address is configured for ${NETWORK_LABEL}.`);
  return CONTRACT_ADDRESS as `0x${string}`;
}

async function view(functionName: string, args: (string | number)[] = [], force = false): Promise<unknown> {
  const address = requireContractAddress();
  const key = JSON.stringify([CHAIN_ID, address.toLowerCase(), functionName, args]);
  const cached = readCache.get(key);
  if (!force && cached && Date.now() - cached.cachedAt < READ_CACHE_MS) {
    return cached.pending ?? cached.value;
  }
  const pending = readClient().readContract({
    address,
    functionName,
    args,
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
  readCache.set(key, { cachedAt: Date.now(), pending });
  try {
    const value = await pending;
    readCache.set(key, { cachedAt: Date.now(), value });
    return value;
  } catch (error) {
    readCache.delete(key);
    throw error;
  }
}

function record<T>(value: unknown, label: string): T {
  let decoded = value;
  if (typeof decoded === "string") {
    try {
      decoded = JSON.parse(decoded);
    } catch {
      throw new Error(`${NETWORK_LABEL} returned malformed ${label} JSON.`);
    }
  }
  if (!decoded || typeof decoded !== "object") throw new Error(`${NETWORK_LABEL} returned an invalid ${label}.`);
  return decoded as T;
}

export async function probeNetwork(): Promise<{ ok: boolean; chainId?: string }> {
  try {
    const response = await fetch(RPC_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
      cache: "no-store",
    });
    if (!response.ok) return { ok: false };
    const body = await response.json() as { result?: unknown; error?: { message?: string } };
    if (body.error || typeof body.result !== "string") return { ok: false };
    return { ok: BigInt(body.result) === BigInt(CHAIN_ID), chainId: body.result };
  } catch {
    return { ok: false };
  }
}

export async function readDashboard(force = false): Promise<DashboardSnapshot> {
  if (!CONTRACT_ADDRESS) {
    return { version: "unconfigured", stats: {}, releaseIds: [], networkOk: false, readAt: Date.now() };
  }
  const [network, version, statsValue, idsValue] = await Promise.all([
    probeNetwork(),
    view("get_contract_version", [], force),
    view("get_stats", [], force),
    view("get_release_ids", [0, 50], force),
  ]);
  const releaseIds = Array.isArray(idsValue) ? idsValue.filter((id): id is string => typeof id === "string") : [];
  return {
    version: typeof version === "string" ? version : String(version),
    stats: record<Stats>(statsValue, "statistics"),
    releaseIds,
    networkOk: network.ok,
    chainId: network.chainId,
    readAt: Date.now(),
  };
}

export async function readRelease(releaseId: string, force = false): Promise<Release> {
  return record<Release>(await view("get_release", [releaseId], force), "release");
}

export async function readReceipt(releaseId: string, force = false): Promise<Receipt | null> {
  try {
    return record<Receipt>(await view("get_receipt", [releaseId], force), "receipt");
  } catch (error) {
    if (String(error).includes("NO_RECEIPT") || String(error).includes("NOT_FOUND")) return null;
    throw error;
  }
}

export async function readAttempts(releaseId: string, count: number, force = false): Promise<Attempt[]> {
  const attempts: Attempt[] = [];
  for (let index = 0; index < count; index++) {
    attempts.push(record<Attempt>(await view("get_release_attempt", [releaseId, index], force), "attempt"));
  }
  return attempts;
}

export async function readHistory(releaseId: string, force = false): Promise<HistoryEvent[]> {
  const result = await view("get_release_history", [releaseId, 0, 50], force);
  if (!Array.isArray(result)) return [];
  return result.map((item) => record<HistoryEvent>(item, "history event"));
}

export async function sendWrite(
  provider: InjectedProvider,
  account: string,
  method: string,
  args: unknown[],
  onSubmitted: (txId: string) => void,
): Promise<{ txId: string; explorerUrl: string; finalized: boolean; successful: boolean }> {
  const address = requireContractAddress();
  const client = createClient({
    chain,
    provider: guardedProvider(provider, account) as never,
    account: account as never,
  });
  const genlayerTxId = await client.writeContract({
    address,
    functionName: method,
    args: args as never,
    value: 0n,
  });
  onSubmitted(genlayerTxId);
  const final = await client.waitForTransactionReceipt({
    hash: genlayerTxId,
    status: TransactionStatus.FINALIZED,
    interval: 10_000,
    retries: 180,
  });
  const status = final.statusName ?? (typeof final.status === "number"
    ? (transactionsStatusNumberToName as Record<string, string>)[String(final.status)]
    : String(final.status ?? ""));
  const execution = final.txExecutionResultName ?? (typeof final.txExecutionResult === "number"
    ? (executionResultNumberToName as Record<string, string>)[String(final.txExecutionResult)]
    : "");
  const consensus = final.resultName ?? (final.consensus_data as { result_name?: string } | undefined)?.result_name ?? "";
  return {
    txId: genlayerTxId,
    explorerUrl: EXPLORER_URL + "/tx/" + genlayerTxId,
    finalized: status === "FINALIZED",
    successful: status === "FINALIZED" && execution === "FINISHED_WITH_RETURN" && consensus === "MAJORITY_AGREE",
  };
}

export async function sha256(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
}

export function canonicalJson(value: unknown): string {
  const sort = (entry: unknown): unknown => {
    if (Array.isArray(entry)) return entry.map(sort);
    if (!entry || typeof entry !== "object") return entry;
    return Object.fromEntries(Object.entries(entry as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([key, val]) => [key, sort(val)]));
  };
  return JSON.stringify(sort(value));
}
