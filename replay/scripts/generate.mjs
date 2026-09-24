import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const hre = require("hardhat");
const { ethers, network } = hre;
const { Interface, keccak256 } = ethers;

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CONTRACTS = resolve(ROOT, "replay", "contracts");
const CORPUS_PATH = resolve(ROOT, "replay", "corpus", "transactions.json");
const GENERATED = resolve(ROOT, "replay", "generated");
const VERIFY = process.argv.includes("--verify") || process.env.RATCHET_REPLAY_VERIFY === "1";
const SOURCE_DATE_EPOCH = Number(process.env.SOURCE_DATE_EPOCH ?? Math.floor(Date.UTC(2026, 8, 24) / 1000));
const REPLAY_BASE_BLOCK_TIMESTAMP = Math.floor(Date.UTC(2026, 8, 23) / 1000);
const generatedAt = new Date(SOURCE_DATE_EPOCH * 1000).toISOString();
const COMPILER_VERSION = require("solc").version();

const scenarios = [
  { slug: "honest-advance", candidate: "VaultV2Declared", omitCaseId: null },
  { slug: "incomplete-replay", candidate: "VaultV2Declared", omitCaseId: "PAUSE-OFF" },
  { slug: "undeclared-capability", candidate: "VaultV2Undeclared", omitCaseId: null },
  { slug: "invariant-break", candidate: "VaultV2InvariantBreak", omitCaseId: null },
];

const calls = new Interface([
  "function setPaused(bool next)",
  "function emergencyWithdraw(address account,address recipient,uint256 amount)",
  "function paused() view returns (bool)",
  "event Deposited(address indexed account,uint256 amount)",
  "event Withdrawn(address indexed account,address indexed recipient,uint256 amount)",
  "event PauseChanged(bool paused)",
  "event PrivilegedWithdrawal(address indexed account,address indexed recipient,uint256 amount)",
]);

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}
function canonical(value) {
  return JSON.stringify(stable(value));
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
function readEpoch() {
  if (!Number.isFinite(SOURCE_DATE_EPOCH) || SOURCE_DATE_EPOCH < 0) {
    throw new Error("SOURCE_DATE_EPOCH must be a non-negative Unix timestamp.");
  }
  return generatedAt;
}
function parseCaseArgs(transaction, accountMap) {
  return transaction.args?.map((value) => {
    if (typeof value === "string" && value in accountMap) return accountMap[value];
    return value;
  }) ?? [];
}
function encodeCall(contract, transaction, accounts) {
  if (transaction.method === "deposit") {
    return { data: contract.interface.encodeFunctionData("deposit"), value: BigInt(transaction.value) };
  }
  if (transaction.method === "withdraw") {
    return { data: contract.interface.encodeFunctionData("withdraw", [BigInt(transaction.args[0])]), value: 0n };
  }
  if (transaction.method === "setPaused") {
    return { data: calls.encodeFunctionData("setPaused", parseCaseArgs(transaction, accounts)), value: 0n };
  }
  if (transaction.method === "emergencyWithdraw") {
    return { data: calls.encodeFunctionData("emergencyWithdraw", parseCaseArgs(transaction, accounts)), value: 0n };
  }
  throw new Error("Unknown replay corpus method: " + transaction.method);
}
function decodeLogs(logs) {
  return logs.map((log) => {
    let eventName = "UNKNOWN";
    let args = {};
    try {
      const parsed = calls.parseLog({ topics: log.topics, data: log.data });
      if (parsed) {
        eventName = parsed.name;
        args = Object.fromEntries(parsed.fragment.inputs.map((input, index) => [
          input.name || String(index),
          typeof parsed.args[index] === "bigint" ? parsed.args[index].toString() : String(parsed.args[index]),
        ]));
      }
    } catch {}
    return { address: log.address, topics: log.topics, data: log.data, event_name: eventName, args };
  });
}
async function stateSnapshot(address, contract, accounts) {
  const provider = ethers.provider;
  const aliases = {};
  for (const [name, account] of Object.entries(accounts)) {
    aliases[name] = (await contract.balances(account)).toString();
  }
  let paused = null;
  try {
    const raw = await provider.call({ to: address, data: calls.encodeFunctionData("paused") });
    paused = calls.decodeFunctionResult("paused", raw)[0];
  } catch {}
  return {
    total_deposits: (await contract.totalDeposits()).toString(),
    balances: aliases,
    contract_balance: (await provider.getBalance(address)).toString(),
    paused,
  };
}
async function transactionReason(from, to, data, value) {
  try {
    await ethers.provider.call({ from, to, data, value });
    return "";
  } catch (error) {
    const message = error?.shortMessage ?? error?.reason ?? error?.message ?? "execution reverted";
    return String(message).slice(0, 180);
  }
}
async function executeOne(contract, transaction, accounts, signers) {
  const sender = signers[transaction.sender];
  if (!sender) throw new Error("Unknown replay corpus sender: " + transaction.sender);
  const address = await contract.getAddress();
  const before = await stateSnapshot(address, contract, accounts);
  const { data, value } = encodeCall(contract, transaction, accounts);
  await setNextReplayBlockTimestamp();
  const tx = await sender.sendTransaction({ to: address, data, value, gasLimit: 1_000_000n });
  let receipt;
  try {
    receipt = await tx.wait();
  } catch {
    receipt = await ethers.provider.getTransactionReceipt(tx.hash);
  }
  if (!receipt) throw new Error("Local EVM did not return a receipt for " + transaction.case_id);
  const logs = decodeLogs(receipt.logs);
  const after = await stateSnapshot(address, contract, accounts);
  const reason = receipt.status === 1 ? "" : await transactionReason(
    await sender.getAddress(), address, data, value,
  );
  const block = await ethers.provider.getBlock(receipt.blockNumber);
  return {
    case_id: transaction.case_id,
    method: transaction.method,
    sender: transaction.sender,
    args: transaction.args ?? [],
    calldata: data,
    value: value.toString(),
    receipt: {
      transaction_hash: tx.hash,
      block_number: receipt.blockNumber,
      block_hash: receipt.blockHash,
      transaction_index: receipt.index,
      status: receipt.status === 1 ? "SUCCESS" : "FAILED",
      gas_used: receipt.gasUsed.toString(),
      gas_price: receipt.gasPrice?.toString() ?? "0",
      logs,
      block_timestamp: block?.timestamp ?? null,
    },
    output: {
      success: receipt.status === 1,
      revert_reason: reason,
      state_before: before,
      state_after: after,
      events: logs.map((log) => log.event_name).filter((name) => name !== "UNKNOWN"),
    },
  };
}
async function readStorageLayout(contractName) {
  const fullyQualifiedName = `replay/contracts/${contractName}.sol:${contractName}`;
  const buildInfo = await hre.artifacts.getBuildInfo(fullyQualifiedName);
  const sourceName = `replay/contracts/${contractName}.sol`;
  const layout = buildInfo?.output.contracts?.[sourceName]?.[contractName]?.storageLayout;
  if (!layout || !Array.isArray(layout.storage)) {
    throw new Error("Solidity storage layout is missing for " + contractName + ".");
  }
  return layout.storage.map((item) => {
    const type = layout.types[item.type] ?? {};
    return {
      label: item.label,
      slot: String(item.slot),
      offset: Number(item.offset),
      type: String(type.label ?? item.type),
      encoding: String(type.encoding ?? "inplace"),
      number_of_bytes: String(type.numberOfBytes ?? "0"),
    };
  }).sort((a, b) => a.slot.localeCompare(b.slot, undefined, { numeric: true }) || a.offset - b.offset || a.label.localeCompare(b.label));
}
async function setNextReplayBlockTimestamp() {
  const currentBlockNumber = Number(await ethers.provider.getBlockNumber());
  await network.provider.send("evm_setNextBlockTimestamp", [REPLAY_BASE_BLOCK_TIMESTAMP + currentBlockNumber + 1]);
}
function compareStorageLayout(baseline, candidate) {
  const before = new Map(baseline.storage_layout.map((item) => [item.label, item]));
  const after = new Map(candidate.storage_layout.map((item) => [item.label, item]));
  const labels = [...new Set([...before.keys(), ...after.keys()])].sort();
  return labels.flatMap((label) => {
    const oldEntry = before.get(label) ?? null;
    const newEntry = after.get(label) ?? null;
    if (canonical(oldEntry) === canonical(newEntry)) return [];
    return [{
      id: "STORAGE-LAYOUT-" + label.toUpperCase().replace(/[^A-Z0-9]+/g, "-"),
      declaration_id: "DECL-STORAGE",
      field: label,
      baseline: oldEntry,
      candidate: newEntry,
    }];
  });
}
async function runSide(contractName, transactions) {
  await network.provider.send("hardhat_reset");
  const signers = await ethers.getSigners();
  const accounts = {
    owner: await signers[0].getAddress(),
    alice: await signers[1].getAddress(),
    bob: await signers[2].getAddress(),
    recipient: await signers[3].getAddress(),
  };
  const factory = await ethers.getContractFactory(contractName, signers[0]);
  await setNextReplayBlockTimestamp();
  const contract = await factory.deploy();
  const deployment = await contract.deploymentTransaction().wait();
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  const storageLayout = await readStorageLayout(contractName);
  const txResults = [];
  for (const transaction of transactions) {
    txResults.push(await executeOne(contract, transaction, accounts, {
      owner: signers[0],
      alice: signers[1],
      bob: signers[2],
      recipient: signers[3],
    }));
  }
  const finalState = await stateSnapshot(address, contract, accounts);
  return {
    name: contractName,
    address,
    deployment: {
      transaction_hash: deployment.hash,
      block_hash: deployment.blockHash,
      block_number: deployment.blockNumber,
      status: deployment.status === 1 ? "SUCCESS" : "FAILED",
      gas_used: deployment.gasUsed.toString(),
      bytecode_hash: keccak256(factory.bytecode),
    },
    transactions: txResults,
    final_state: finalState,
    storage_layout: storageLayout,
  };
}
async function sourceBundleHash(contractName) {
  const fileNames = contractName === "VaultV1" ? ["VaultV1.sol"] : ["VaultV1.sol", contractName + ".sol"];
  const joined = [];
  for (const name of fileNames) {
    const source = await readFile(resolve(CONTRACTS, name));
    joined.push(name + "\n" + source.toString("utf8").replace(/\r\n/g, "\n"));
  }
  return sha256(joined.join("\n---\n"));
}
function checkBalanceInvariant(side) {
  const total = BigInt(side.final_state.total_deposits);
  const actual = BigInt(side.final_state.contract_balance);
  return {
    id: "INV-BALANCE-CONSERVATION",
    status: total === actual ? "PASS" : "FAIL",
    observed: { liabilities: total.toString(), assets: actual.toString() },
  };
}
function checkAdminInvariant(side) {
  const probe = side.transactions.find((item) => item.case_id === "ADMIN-WITHDRAW-ALICE-5");
  return {
    id: "INV-NO-UNDECLARED-ADMIN",
    status: probe?.output.success ? "FAIL" : "PASS",
    observed: { privileged_withdraw_succeeded: probe?.output.success ?? false },
  };
}
function checkWithdrawalBound(side) {
  const failures = [];
  for (const item of side.transactions) {
    if (!item.output.success || !["withdraw", "emergencyWithdraw"].includes(item.method)) continue;
    const account = item.method === "withdraw" ? item.sender : String(item.args[0]);
    const amount = BigInt(String(item.method === "withdraw" ? item.args[0] : item.args[2]));
    const prior = BigInt(item.output.state_before.balances[account]);
    if (prior < amount) failures.push(item.case_id);
  }
  return {
    id: "INV-WITHDRAWAL-BOUND",
    status: failures.length ? "FAIL" : "PASS",
    observed: { failing_case_ids: failures.sort() },
  };
}
function compareState(baseline, candidate) {
  const get = (side, key) => key === "paused"
    ? (side.final_state.paused === null ? "ABSENT" : String(side.final_state.paused))
    : key === "total_deposits" ? side.final_state.total_deposits
      : key === "contract_balance" ? side.final_state.contract_balance
        : side.final_state.balances[key.slice("balance:".length)];
  const keys = ["contract_balance", "total_deposits", "balance:alice", "balance:bob", "paused"];
  return keys.map((key) => ({
    id: "STATE-" + key.toUpperCase().replace(/[^A-Z0-9]+/g, "-"),
    baseline: get(baseline, key),
    candidate: get(candidate, key),
    changed: get(baseline, key) !== get(candidate, key),
  })).filter((item) => item.changed);
}
function comparePermissions(baseline, candidate) {
  const probes = [
    ["PAUSE-ON", "DECL-PERMISSIONS", "OWNER_PAUSE_CONTROL"],
    ["ADMIN-WITHDRAW-ALICE-5", "DECL-CAPABILITIES", "PRIVILEGED_WITHDRAWAL"],
  ];
  return probes.map(([caseId, declarationId, capability]) => {
    const before = baseline.transactions.find((item) => item.case_id === caseId);
    const after = candidate.transactions.find((item) => item.case_id === caseId);
    return {
      id: declarationId,
      capability,
      baseline_allowed: before?.output.success ?? false,
      candidate_allowed: after?.output.success ?? false,
      changed: (before?.output.success ?? false) !== (after?.output.success ?? false),
    };
  }).filter((item) => item.changed);
}
function compareExternalCalls(baseline, candidate) {
  const flatten = (side) => side.transactions.flatMap((item) => item.receipt.logs
    .filter((log) => ["Withdrawn", "PrivilegedWithdrawal"].includes(log.event_name))
    .map((log) => ({
      case_id: item.case_id,
      operation: log.event_name === "PrivilegedWithdrawal" ? "privileged_recipient_native_transfer" : "withdraw_recipient_native_transfer",
      outcome: "COMPLETED",
      recipient: log.args.recipient,
      amount: String(log.args.amount),
      receipt_event: log.event_name,
      witness: "post-transfer event in the actual EVM transaction receipt",
    })));
  const before = flatten(baseline);
  const after = flatten(candidate);
  return { baseline: before, candidate: after, changed: canonical(before) !== canonical(after) };
}
function compareCapabilities(baseline, candidate) {
  const before = new Map(baseline.transactions.map((item) => [item.case_id, item.output.success]));
  const after = new Map(candidate.transactions.map((item) => [item.case_id, item.output.success]));
  const specs = [
    ["PAUSE-ON", "DECL-PERMISSIONS", "CAP-OWNER-PAUSE"],
    ["ADMIN-WITHDRAW-ALICE-5", "DECL-CAPABILITIES", "CAP-PRIVILEGED-WITHDRAWAL"],
  ];
  return specs.map(([caseId, declarationId, id]) => ({
    id,
    declaration_id: declarationId,
    observed: Boolean(after.get(caseId)),
    baseline_observed: Boolean(before.get(caseId)),
    added: Boolean(after.get(caseId)) && !Boolean(before.get(caseId)),
  })).filter((item) => item.added);
}
async function makeScenario(scenario, corpus, corpusHash, sources) {
  const transactions = corpus.transactions.filter((item) => item.case_id !== scenario.omitCaseId);
  const baseline = await runSide("VaultV1", transactions);
  const candidate = await runSide(scenario.candidate, transactions);
  const required = [...corpus.required_case_ids].sort();
  const executed = transactions.map((item) => item.case_id).sort();
  const missing = required.filter((item) => !executed.includes(item));
  const invariants = [
    checkBalanceInvariant(candidate),
    checkAdminInvariant(candidate),
    checkWithdrawalBound(candidate),
  ];
  const runSeed = canonical({
    scenario: scenario.slug,
    corpus_hash: corpusHash,
    baseline_source_hash: sources.VaultV1.sourceHash,
    candidate_source_hash: sources[scenario.candidate].sourceHash,
    executed_case_ids: executed,
  });
  const report = {
    schema_version: "1",
    run_id: sha256(runSeed).slice(0, 24),
    generated_at: readEpoch(),
    source_date_epoch: SOURCE_DATE_EPOCH,
    scenario_id: scenario.slug,
    build: {
      executor: "Hardhat local EVM",
      hardhat_version: require("hardhat/package.json").version,
      compiler_version: COMPILER_VERSION,
      optimizer: { enabled: true, runs: 200 },
      chain_id: 31337,
    },
    baseline: {
      implementation: "VaultV1",
      source_hash: sources.VaultV1.sourceHash,
      bytecode_hash: baseline.deployment.bytecode_hash,
      storage_layout_hash: sha256(canonical(baseline.storage_layout)),
      deployment: baseline.deployment,
    },
    candidate: {
      implementation: scenario.candidate,
      source_hash: sources[scenario.candidate].sourceHash,
      bytecode_hash: candidate.deployment.bytecode_hash,
      storage_layout_hash: sha256(canonical(candidate.storage_layout)),
      deployment: candidate.deployment,
    },
    corpus: {
      dataset_id: corpus.dataset_id,
      dataset_hash: corpusHash,
      transaction_count: transactions.length,
    },
    transactions: transactions.map((source, index) => ({
      case_id: source.case_id,
      baseline: baseline.transactions[index],
      candidate: candidate.transactions[index],
    })),
    storage_diffs: compareStorageLayout(baseline, candidate),
    state_diffs: compareState(baseline, candidate),
    permission_diffs: comparePermissions(baseline, candidate),
    external_call_diffs: [compareExternalCalls(baseline, candidate)],
    capability_diffs: compareCapabilities(baseline, candidate),
    invariants,
    coverage: {
      required_case_ids: required,
      executed_case_ids: executed,
      missing_case_ids: missing,
    },
    final_state: {
      baseline: baseline.final_state,
      candidate: candidate.final_state,
    },
    artifact_sources: {
      corpus: "replay/corpus/transactions.json",
      baseline_solidity: "replay/contracts/VaultV1.sol",
      candidate_solidity: "replay/contracts/" + scenario.candidate + ".sol",
      transaction_corpus_hash: corpusHash,
    },
  };
  const rawReport = canonical(report);
  const reportHash = sha256(rawReport);
  const ciSummary = {
    schema_version: "1",
    generated_at: report.generated_at,
    executor: "local-hardhat",
    independent_ci_run: null,
    report_file: scenario.slug + ".json",
    report_hash: reportHash,
    corpus_hash: corpusHash,
    required_case_ids: required,
    executed_case_ids: executed,
    missing_case_ids: missing,
    transaction_count: transactions.length,
    note: "Generated from local EVM execution. No independent hosted CI run is claimed.",
  };
  const rawCiSummary = canonical(ciSummary);
  const evidenceHtml = makeEvidenceHtml(report);
  return { slug: scenario.slug, report: rawReport, reportHash, ciSummary: rawCiSummary, ciHash: sha256(rawCiSummary), html: evidenceHtml };
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);
}
function makeEvidenceHtml(report) {
  const transactionRows = report.transactions.map((item) =>
    "<article class=\"tx-row\"><h3>" + escapeHtml(item.case_id) + "</h3>" +
    "<div class=\"receipt-pair\"><div><span class=\"label\">Current receipt</span><span class=\"receipt " + item.baseline.receipt.status.toLowerCase() + "\">" +
    escapeHtml(item.baseline.receipt.status) + "</span><code>" + escapeHtml(item.baseline.receipt.transaction_hash) + "</code></div>" +
    "<div><span class=\"label\">Candidate receipt</span><span class=\"receipt " + item.candidate.receipt.status.toLowerCase() + "\">" +
    escapeHtml(item.candidate.receipt.status) + "</span><code>" + escapeHtml(item.candidate.receipt.transaction_hash) + "</code></div></div></article>"
  ).join("");
  const invariantRows = report.invariants.map((item) =>
    "<li class=\"check " + item.status.toLowerCase() + "\"><strong>" + escapeHtml(item.id) + "</strong><span>" +
    escapeHtml(item.status) + "</span></li>"
  ).join("");
  const layoutRows = report.storage_diffs.map((item) =>
    "<li><strong>" + escapeHtml(item.field) + "</strong><span>" + escapeHtml(item.baseline ? `${item.baseline.type} · slot ${item.baseline.slot}` : "absent") + "</span><span>→</span><span>" + escapeHtml(item.candidate ? `${item.candidate.type} · slot ${item.candidate.slot}` : "absent") + "</span></li>"
  ).join("") || "<li><span>No storage-layout difference.</span></li>";
  const stateRows = report.state_diffs.map((item) =>
    "<li><strong>" + escapeHtml(item.id) + "</strong><span>" + escapeHtml(item.baseline) + "</span><span>→</span><span>" + escapeHtml(item.candidate) + "</span></li>"
  ).join("") || "<li><span>No final-state difference.</span></li>";
  const changeRows = [...report.permission_diffs, ...report.capability_diffs].map((item) =>
    "<li><strong>" + escapeHtml(item.id) + "</strong><span>" + escapeHtml(item.capability ?? item.field ?? "observed change") + "</span><span>" + escapeHtml(item.changed || item.added ? "CHANGED" : "SAME") + "</span></li>"
  ).join("") || "<li><span>No added permission or capability was observed.</span></li>";
  const externalCallRows = report.external_call_diffs.flatMap((diff) => {
    const cases = [...new Set([...diff.baseline, ...diff.candidate].map((item) => item.case_id))];
    const summary = (rows, caseId) => {
      const item = rows.find((row) => row.case_id === caseId);
      return item
        ? `${item.operation} · ${item.recipient} · ${item.amount} · ${item.outcome}`
        : "No completed recipient transfer";
    };
    return cases.map((caseId) =>
      "<li><strong>" + escapeHtml(caseId) + "</strong><span>" + escapeHtml(summary(diff.baseline, caseId)) + "</span><span>→</span><span>" + escapeHtml(summary(diff.candidate, caseId)) + "</span></li>"
    );
  }).join("") || "<li><span>No recipient transfers were observed.</span></li>";
  const missing = report.coverage.missing_case_ids.length
    ? report.coverage.missing_case_ids.map(escapeHtml).join(", ")
    : "none";
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>Ratchet replay · " + escapeHtml(report.scenario_id) + "</title><style>" +
    ":root{color-scheme:light;--ink:#20304b;--muted:#536782;--paper:#f5f9ff;--line:#cbd9eb;--blue:#626fd2;--mint:#197d62;--amber:#85520d;--coral:#9a403d;--surface:#fff}" +
    "*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.55 'Nunito Sans', 'Segoe UI',sans-serif}main{max-width:1120px;margin:0 auto;padding:32px 24px 72px}" +
    "header{padding:24px 0 28px;border-bottom:1px solid var(--line)}h1{font-size:2.1rem;line-height:1.12;margin:0 0 10px;text-transform:capitalize}h2{font-size:1.2rem;margin:0 0 14px}h3{font-size:1rem;margin:0}" +
    "p{max-width:72ch;color:var(--muted)}.run{display:inline-flex;align-items:center;gap:8px;color:var(--blue);font-weight:700}.run:before{content:'';width:9px;height:9px;border-radius:50%;background:#73cfb1;border:2px solid #197d62}" +
    ".disclosure{margin:18px 0 26px;padding:15px 17px;background:#e6f1ff;border:1px solid #a8bee0;border-radius:12px}.disclosure p{margin:5px 0}.pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:24px;margin:24px 0}" +
    ".plate{padding:0 0 14px;border-bottom:1px solid var(--line)}.plate h2{display:flex;justify-content:space-between;align-items:baseline}.plate code,code{font:13px/1.5 'Azeret Mono',Consolas,monospace;overflow-wrap:anywhere}.hash{display:block;color:var(--muted);margin:7px 0}" +
    ".tx-list{border-top:1px solid var(--line)}.tx-row{padding:15px 0;border-bottom:1px solid var(--line)}.tx-row h3{margin:0 0 10px}.receipt-pair{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:20px}.receipt-pair>div{display:grid;grid-template-columns:auto auto 1fr;align-items:center;gap:8px}" +
    ".diff-list{list-style:none;margin:0;padding:0;border-top:1px solid var(--line)}.diff-list li{display:grid;grid-template-columns:minmax(130px,1fr) 1fr 20px 1fr;gap:10px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line);font-size:.86rem}.diff-list strong{font:700 .8rem 'Cascadia Code',Consolas,monospace}.diff-list span{overflow-wrap:anywhere;color:var(--muted)}" +
    ".label{color:var(--muted);font-size:.8rem}.receipt{border-radius:999px;padding:2px 9px;font-size:.78rem;font-weight:700;width:max-content}.receipt.success{background:#daf2e8;color:#155c49}.receipt.failed{background:#ffdfd9;color:#7d302e}" +
    ".checks{list-style:none;padding:0;display:grid;gap:0}.check{display:flex;justify-content:space-between;gap:12px;padding:11px 0;border-bottom:1px solid var(--line)}.check span{font-size:.8rem;font-weight:700}.check.pass span{color:var(--mint)}.check.fail span{color:var(--coral)}" +
    ".note{font-size:.9rem;color:var(--muted)}footer{margin-top:30px;padding-top:18px;border-top:1px solid var(--line);font-size:.86rem;color:var(--muted)}a{color:#394ab0;text-underline-offset:3px}a:focus-visible{outline:3px solid #394ab0;outline-offset:3px}::selection{background:#c9e8ff;color:#20304b}" +
    "@media(max-width:680px){main{padding:22px 16px 52px}.pair{grid-template-columns:1fr;gap:10px}.receipt-pair{grid-template-columns:1fr;gap:10px}.receipt-pair>div{grid-template-columns:1fr}.receipt-pair code{margin-top:-4px}.diff-list li{grid-template-columns:1fr auto;gap:3px 8px}.diff-list li span:nth-child(2){grid-column:1}.diff-list li span:nth-child(3){display:none}.diff-list li span:nth-child(4){grid-column:2;grid-row:1 / span 2}h1{font-size:1.75rem}}</style></head><body><main>" +
    "<header><p class=\"run\">Local EVM replay · schema 1</p><h1>" + escapeHtml(report.scenario_id.replaceAll("-", " ")) + "</h1><p>Ratchet compares the current implementation with a candidate using the same deterministic transaction corpus. The EVM execution happened locally; validators adjudicate the evidence separately.</p></header>" +
    "<div class=\"disclosure\" role=\"note\"><strong>Synthetic reviewer demonstration</strong><p>Generated from reproducible local EVM execution. This is not evidence of a production incident, not an independent security audit, and not proof that every execution path was tested.</p></div>" +
    "<section aria-labelledby=\"build-title\"><h2 id=\"build-title\">Build fingerprints</h2><div class=\"pair\"><div class=\"plate\"><h2>Current · " + escapeHtml(report.baseline.implementation) + "</h2><span class=\"hash\">Source: <code>" + escapeHtml(report.baseline.source_hash) + "</code></span><span class=\"hash\">Bytecode: <code>" + escapeHtml(report.baseline.bytecode_hash) + "</code></span></div>" +
    "<div class=\"plate\"><h2>Candidate · " + escapeHtml(report.candidate.implementation) + "</h2><span class=\"hash\">Source: <code>" + escapeHtml(report.candidate.source_hash) + "</code></span><span class=\"hash\">Bytecode: <code>" + escapeHtml(report.candidate.bytecode_hash) + "</code></span></div></div></section>" +
    "<section aria-labelledby=\"coverage-title\"><h2 id=\"coverage-title\">Replay coverage</h2><p>" + report.coverage.executed_case_ids.length + " of " + report.coverage.required_case_ids.length + " required cases executed. Missing: " + missing + ".</p><div class=\"tx-list\">" + transactionRows + "</div></section>" +
    "<section aria-labelledby=\"diff-title\"><h2 id=\"diff-title\">Differential observations</h2><h3>Storage layout</h3><ul class=\"diff-list\">" + layoutRows + "</ul><h3>Final-state values after replay</h3><ul class=\"diff-list\">" + stateRows + "</ul><h3>Recipient transfers</h3><ul class=\"diff-list\">" + externalCallRows + "</ul><h3>Permission and capability probes</h3><ul class=\"diff-list\">" + changeRows + "</ul></section>" +
    "<section aria-labelledby=\"checks-title\"><h2 id=\"checks-title\">Frozen invariant checks</h2><ul class=\"checks\">" + invariantRows + "</ul></section>" +
    "<footer><p>Dataset " + escapeHtml(report.corpus.dataset_id) + " · hash <code>" + escapeHtml(report.corpus.dataset_hash) + "</code> · generated " + escapeHtml(report.generated_at) + ".</p><p>Anyone can rerun the committed replay generator. Coverage is representative and policy-defined, not exhaustive. Ratchet does not execute EVM bytecode or a proxy upgrade.</p></footer>" +
    "</main></body></html>";
}

async function writeOrVerify(relativePath, contents, mirrorPaths = []) {
  const file = resolve(ROOT, relativePath);
  if (VERIFY) {
    const actual = await readFile(file).catch(() => null);
    if (!actual || actual.toString("utf8") !== contents) {
      throw new Error("Committed artifact differs: " + relativePath);
    }
    for (const mirror of mirrorPaths) {
      const copy = await readFile(resolve(ROOT, mirror)).catch(() => null);
      if (!copy || copy.toString("utf8") !== contents) {
        throw new Error("Published artifact differs: " + mirror);
      }
    }
    return;
  }
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, contents, "utf8");
  for (const mirror of mirrorPaths) {
    const mirrorPath = resolve(ROOT, mirror);
    await mkdir(dirname(mirrorPath), { recursive: true });
    await writeFile(mirrorPath, contents, "utf8");
  }
}
async function copyOrVerify(source, destination) {
  const sourceText = await readFile(source);
  if (VERIFY) {
    const target = await readFile(destination).catch(() => null);
    if (!target || !target.equals(sourceText)) {
      throw new Error("Committed replay input differs: " + relative(ROOT, destination));
    }
  } else {
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, sourceText);
  }
}
async function main() {
  const epoch = readEpoch();
  const corpusRaw = await readFile(CORPUS_PATH);
  const corpus = JSON.parse(corpusRaw.toString("utf8"));
  if (corpus.schema_version !== "1") throw new Error("Unsupported replay corpus schema.");
  const corpusHash = sha256(corpusRaw);
  const sourceNames = ["VaultV1", "VaultV2Declared", "VaultV2Undeclared", "VaultV2InvariantBreak"];
  const sources = {};
  for (const name of sourceNames) {
    sources[name] = { sourceHash: await sourceBundleHash(name) };
  }
  await mkdir(GENERATED, { recursive: true });
  const outputs = [];
  for (const scenario of scenarios) {
    outputs.push(await makeScenario(scenario, corpus, corpusHash, sources));
  }
  const provenance = canonical({
    schema_version: "1",
    generated_at: epoch,
    compiler_version: COMPILER_VERSION,
    hardhat_version: require("hardhat/package.json").version,
    corpus_hash: corpusHash,
    artifacts: outputs.map((output) => ({
      id: output.slug,
      report_hash: output.reportHash,
      ci_report_hash: output.ciHash,
    })),
    note: "This is a local reproducible replay bundle. No hosted CI run is claimed.",
  });
  for (const output of outputs) {
    await writeOrVerify(
      "replay/generated/" + output.slug + ".json",
      output.report,
      ["frontend/public/evidence/" + output.slug + ".json"],
    );
    await writeOrVerify(
      "replay/generated/" + output.slug + ".html",
      output.html,
      ["frontend/public/evidence/" + output.slug + ".html"],
    );
    await writeOrVerify(
      "replay/generated/" + output.slug + ".ci.json",
      output.ciSummary,
      ["frontend/public/evidence/" + output.slug + ".ci.json"],
    );
  }
  await writeOrVerify("replay/generated/provenance.json", provenance, ["frontend/public/evidence/provenance.json"]);
  await copyOrVerify(CORPUS_PATH, resolve(ROOT, "frontend", "public", "replay", "transactions.json"));
  for (const name of sourceNames) {
    const source = resolve(CONTRACTS, name + ".sol");
    await copyOrVerify(source, resolve(ROOT, "frontend", "public", "replay", "contracts", name + ".sol"));
  }
  if (VERIFY) {
    console.log("Replay artifacts match (" + outputs.length + " scenarios, compiler " + COMPILER_VERSION + ", source epoch " + SOURCE_DATE_EPOCH + ").");
  } else {
    console.log("Generated " + outputs.length + " real local EVM replay bundles in " + relative(ROOT, GENERATED) + ".");
  }
}
main().catch((error) => {
  console.error(error?.stack ?? String(error));
  process.exitCode = 1;
});
