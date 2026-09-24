import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  PROOF_PATH,
  ROOT,
  asRecord,
  consensusStatus,
  readClient,
  readJsonFile,
  writeJson,
} from "./studio.js";

const deployProfilePath = resolve(ROOT, "deploy", "ratchet-fee-profile.json");
const publicProfilePath = resolve(ROOT, "frontend", "public", "fee-profile.json");
const headroomNumerator = 5n;
const headroomDenominator = 4n;

function asBigInt(value: unknown, label: string): bigint {
  if (value === undefined || value === null || value === "") throw new Error(`Missing ${label} in finalized transaction fee accounting.`);
  try { return BigInt(String(value)); } catch { throw new Error(`${label} is not an integer fee measurement.`); }
}

function ceilHeadroom(value: bigint): bigint {
  return (value * headroomNumerator + headroomDenominator - 1n) / headroomDenominator;
}

function field(record: Record<string, unknown>, ...names: string[]): unknown {
  for (const name of names) if (record[name] !== undefined && record[name] !== null) return record[name];
  return undefined;
}

function observe(transaction: Record<string, unknown>, releaseId: string) {
  const data = (transaction.data && typeof transaction.data === "object" ? transaction.data : {}) as Record<string, unknown>;
  const accountingValue = data.fee_accounting ?? transaction.fee_accounting;
  if (!accountingValue || typeof accountingValue !== "object") throw new Error(`${releaseId}: finalized receipt has no fee_accounting; no fee profile was emitted.`);
  const accounting = accountingValue as Record<string, unknown>;
  const report = (accounting.execution_fee_report ?? accounting.executionFeeReport ?? {}) as Record<string, unknown>;
  const distributionValue = accounting.fees_distribution ?? accounting.feesDistribution ?? (accounting.recommended_fee_preset as Record<string, unknown> | undefined)?.distribution ?? (accounting.recommendedFeePreset as Record<string, unknown> | undefined)?.distribution;
  if (!distributionValue || typeof distributionValue !== "object") throw new Error(`${releaseId}: receipt has no fee distribution; no fee profile was emitted.`);
  const distribution = distributionValue as Record<string, unknown>;
  const rawRotations = distribution.rotations;
  const rotations = Array.isArray(rawRotations) && rawRotations.length ? rawRotations.map((value) => asBigInt(value, `${releaseId}.rotations`)) : [0n];
  const messageConsumed = asBigInt(field(accounting, "message_fee_consumed", "messageFeeConsumed") ?? 0, `${releaseId}.message_fee_consumed`);
  const genvmMessageConsumed = asBigInt(field(accounting, "genvm_message_fee_consumed", "genvmMessageFeeConsumed") ?? 0, `${releaseId}.genvm_message_fee_consumed`);
  const executionConsumed = asBigInt(field(accounting, "execution_fee_consumed", "executionFeeConsumed"), `${releaseId}.execution_fee_consumed`);
  const totalEstimatedFee = asBigInt(field(report, "totalEstimatedFee", "total_estimated_fee"), `${releaseId}.execution_fee_report.totalEstimatedFee`);
  const observed = {
    leaderTimeunitsAllocation: asBigInt(field(distribution, "leaderTimeunitsAllocation", "leader_timeunits_allocation"), `${releaseId}.leaderTimeunitsAllocation`),
    validatorTimeunitsAllocation: asBigInt(field(distribution, "validatorTimeunitsAllocation", "validator_timeunits_allocation"), `${releaseId}.validatorTimeunitsAllocation`),
    executionBudgetPerRound: executionConsumed + totalEstimatedFee,
    totalMessageFees: messageConsumed > genvmMessageConsumed ? messageConsumed : genvmMessageConsumed,
    rotationsPerRound: rotations.reduce((max, value) => value > max ? value : max, 0n),
  };
  return observed;
}

function withHeadroom(values: Record<string, bigint>): Record<string, string> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, key === "rotationsPerRound" ? value.toString() : ceilHeadroom(value).toString()]));
}

async function main() {
  const proof = await readJsonFile(PROOF_PATH);
  if (proof.network !== "studioDevnet" || proof.chain_id !== 61997 || !Array.isArray(proof.releases) || proof.releases.length !== 3) {
    throw new Error("A verified three-release Studio Next proof is required before profiling fees.");
  }
  const client = readClient();
  const samples: Record<string, unknown>[] = [];
  const maxima: Record<string, bigint> = {};
  for (const raw of proof.releases) {
    const release = asRecord(raw, "release proof");
    const transactions = release.transactions;
    if (!Array.isArray(transactions)) throw new Error(`${String(release.release_id)} has no transaction evidence.`);
    const action = transactions.map((item) => asRecord(item, "transaction proof")).find((item) => item.action === `${release.release_id}-adjudicate`);
    if (!action || typeof action.hash !== "string") throw new Error(`${String(release.release_id)} has no recorded finalized adjudication transaction.`);
    const transaction = await client.getTransaction({ hash: action.hash as never }) as unknown as Record<string, unknown>;
    const status = String(transaction.statusName ?? transaction.status_name ?? "");
    const execution = String(transaction.txExecutionResultName ?? "");
    if (status !== "FINALIZED" || !["FINISHED_WITH_RETURN", "SUCCESS"].includes(execution) || consensusStatus(transaction as never) !== "MAJORITY_AGREE") throw new Error(`${String(release.release_id)} adjudication is not finalized with successful majority agreement.`);
    const observed = observe(transaction, String(release.release_id));
    for (const [key, value] of Object.entries(observed)) if (maxima[key] === undefined || value > maxima[key]) maxima[key] = value;
    samples.push({
      release_id: release.release_id,
      verdict: release.actual_verdict,
      transaction: action.hash,
      explorer_url: action.explorer_url,
      observed: Object.fromEntries(Object.entries(observed).map(([key, value]) => [key, value.toString()])),
      profiled: withHeadroom(observed),
    });
  }
  const methods = { adjudicate: withHeadroom(maxima) };
  const profile = {
    version: 1,
    network: "studioDevnet",
    chainId: 61997,
    measuredAt: new Date().toISOString(),
    headroom: 1.25,
    source: "Three successful finalized Studio Next adjudication receipts from deploy/studio-next-proof.json. This is measured usage, not a fee guarantee.",
    methods,
    scenarios: samples,
  };
  await writeJson(deployProfilePath, profile);
  await writeJson(publicProfilePath, profile);
  console.log(`Wrote a measured adjudicate fee profile from ${samples.length} finalized Studio Next receipts to ${deployProfilePath}.`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
