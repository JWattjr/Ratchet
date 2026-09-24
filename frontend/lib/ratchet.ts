import { createClient } from "genlayer-js";
import { TransactionHashVariant } from "genlayer-js/types";
import { createTransactionKit, type FeeSuggestions, type PolicyQuote, type SubmitInput } from "@genlayer/transaction-kit";
import { chain, CHAIN_ID, CONTRACT_ADDRESS, EXPLORER_URL, RPC_URL } from "./network";
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

let reader: ReturnType<typeof createClient> | null = null;
function readClient() {
  reader ??= createClient({ chain });
  return reader;
}

function requireContractAddress(): `0x${string}` {
  if (!CONTRACT_ADDRESS) throw new Error("No Ratchet contract address is configured for Studio Next.");
  return CONTRACT_ADDRESS as `0x${string}`;
}

async function view(functionName: string, args: (string | number)[] = []): Promise<unknown> {
  const address = requireContractAddress();
  return readClient().readContract({
    address,
    functionName,
    args,
    transactionHashVariant: TransactionHashVariant.LATEST_FINAL,
  });
}

function record<T>(value: unknown, label: string): T {
  let decoded = value;
  if (typeof decoded === "string") {
    try {
      decoded = JSON.parse(decoded);
    } catch {
      throw new Error(`Studio Next returned malformed ${label} JSON.`);
    }
  }
  if (!decoded || typeof decoded !== "object") throw new Error(`Studio Next returned an invalid ${label}.`);
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

export async function readDashboard(): Promise<DashboardSnapshot> {
  if (!CONTRACT_ADDRESS) {
    return { version: "unconfigured", stats: {}, releaseIds: [], networkOk: false, readAt: Date.now() };
  }
  const network = await probeNetwork();
  const [version, statsValue, idsValue] = await Promise.all([
    view("get_contract_version"),
    view("get_stats"),
    view("get_release_ids", [0, 50]),
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

export async function readRelease(releaseId: string): Promise<Release> {
  return record<Release>(await view("get_release", [releaseId]), "release");
}

export async function readReceipt(releaseId: string): Promise<Receipt | null> {
  try {
    return record<Receipt>(await view("get_receipt", [releaseId]), "receipt");
  } catch (error) {
    if (String(error).includes("NO_RECEIPT") || String(error).includes("NOT_FOUND")) return null;
    throw error;
  }
}

export async function readAttempts(releaseId: string, count: number): Promise<Attempt[]> {
  const attempts: Attempt[] = [];
  for (let index = 0; index < count; index++) {
    attempts.push(record<Attempt>(await view("get_release_attempt", [releaseId, index]), "attempt"));
  }
  return attempts;
}

export async function readHistory(releaseId: string): Promise<HistoryEvent[]> {
  const result = await view("get_release_history", [releaseId, 0, 50]);
  if (!Array.isArray(result)) return [];
  return result.map((item) => record<HistoryEvent>(item, "history event"));
}

export async function sendWrite(
  provider: InjectedProvider,
  account: string,
  method: string,
  args: unknown[],
  onQuote: (quote: PolicyQuote) => void,
): Promise<{ txId: `0x${string}`; explorerUrl: string; finalized: boolean; successful: boolean }> {
  const address = requireContractAddress();
  const tx: SubmitInput = { kind: "write", address, method, args };
  let suggestions: FeeSuggestions | undefined;
  try {
    const response = await fetch("/fee-profile.json", { cache: "no-store" });
    if (response.ok) {
      const profile = await response.json() as FeeSuggestions;
      if (String(profile.chainId) === String(chain.id)) suggestions = profile;
    }
  } catch {
    // A fresh network quote remains available when no measured profile is published.
  }
  const kit = createTransactionKit({
    chain,
    provider: guardedProvider(provider, account),
    account: account as `0x${string}`,
    suggestions,
  });
  const quote = await kit.estimate({ preset: "standard" }, tx);
  if (quote.verification.status === "mismatch") {
    throw new Error("Studio Next fee policy changed during the quote. Request a fresh quote and submit again.");
  }
  onQuote(quote);
  const { genlayerTxId } = await kit.submit(quote, tx);
  const final = await kit.track(genlayerTxId, () => {}, { until: "finalized" });
  return {
    txId: genlayerTxId,
    explorerUrl: `${EXPLORER_URL}/tx/${genlayerTxId}`,
    finalized: final.phase === "finalized",
    successful: final.phase === "finalized" && final.successful === true,
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
