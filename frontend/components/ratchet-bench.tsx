"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  canonicalJson,
  readAttempts,
  readDashboard,
  readHistory,
  readReceipt,
  readSavedProofSummary,
  readRelease,
  sendWrite,
  sha256,
  type Attempt,
  type DashboardSnapshot,
  type HistoryEvent,
  type Receipt,
  type Release,
  type SavedProofSummary,
} from "../lib/ratchet";
import { CHAIN_ID, CONTRACT_ADDRESS, EXPLORER_URL, NETWORK_LABEL, RPC_URL, explorerAddress } from "../lib/network";
import { connectWallet, ensureStudioChain, getInjectedProvider, readableError, type InjectedProvider } from "../lib/wallet";

type Stop = "declaration" | "replay" | "comparison" | "consensus" | "action";
type VerifiedArtifacts = {
  status: "VERIFIED" | "EXTERNAL" | "UNAVAILABLE" | "HASH_MISMATCH";
  report?: Record<string, unknown>;
  ci?: Record<string, unknown>;
};
const STOPS: { id: Stop; number: string; label: string; description: string }[] = [
  { id: "declaration", number: "01", label: "Declaration", description: "The sealed intent" },
  { id: "replay", number: "02", label: "Replay", description: "Transactions on a local EVM" },
  { id: "comparison", number: "03", label: "Comparison", description: "Declared beside observed" },
  { id: "consensus", number: "04", label: "Validators", description: "Independent evidence review" },
  { id: "action", number: "05", label: "Contract action", description: "A deterministic state change" },
];

const DECLARATION_TEMPLATE = {
  release_id: "REPLACE-ME",
  current_implementation_hash: "0".repeat(64),
  candidate_implementation_hash: "1".repeat(64),
  source_provenance: { repository: "https://example.org/repository", commit: "replace-with-commit" },
  build_provenance: { compiler: "solc-0.8.30", build_hash: "2".repeat(64) },
  declared_storage_changes: [],
  declared_permission_changes: [],
  declared_external_call_changes: [],
  declared_capabilities: [],
  safety_invariants: ["INV-BALANCE-CONSERVATION", "INV-NO-UNDECLARED-ADMIN", "INV-WITHDRAWAL-BOUND"],
  migration_procedure: "Describe the reviewed migration procedure.",
  rollback_procedure: "Describe how the current implementation remains approved.",
  replay_dataset: {
    dataset_id: "ratchet-demo-corpus-v1",
    dataset_hash: "3".repeat(64),
    required_case_ids: ["ADMIN-WITHDRAW-ALICE-5", "DEPOSIT-ALICE-10", "DEPOSIT-BOB-7", "PAUSE-OFF", "PAUSE-ON", "WITHDRAW-ALICE-4", "WITHDRAW-BOB-9"],
    replay_report_url: "https://example.org/evidence/replay.json",
    replay_report_hash: "4".repeat(64),
    ci_report_url: "https://example.org/evidence/ci.json",
    ci_report_hash: "5".repeat(64),
  },
  policy_version: "ratchet-policy/1",
  retry_limit: 1,
  bond: { amount: 90, advance_return_pct: 100, rollback_slash_pct: 50 },
};
const POLICY_TEMPLATE = {
  policy_version: "ratchet-policy/1",
  declaration_ids: ["DECL-SOURCE", "DECL-STORAGE", "DECL-PERMISSIONS", "DECL-EXTERNAL-CALLS", "DECL-CAPABILITIES", "DECL-MIGRATION", "DECL-ROLLBACK", "DECL-CORPUS"],
  invariant_ids: ["INV-BALANCE-CONSERVATION", "INV-NO-UNDECLARED-ADMIN", "INV-WITHDRAWAL-BOUND"],
  evidence_ids: ["DECL-SOURCE", "DECL-STORAGE", "DECL-PERMISSIONS", "DECL-EXTERNAL-CALLS", "DECL-CAPABILITIES", "DECL-MIGRATION", "DECL-ROLLBACK", "DECL-CORPUS", "COVERAGE-REQUIRED-CORPUS"],
  required_case_ids: ["ADMIN-WITHDRAW-ALICE-5", "DEPOSIT-ALICE-10", "DEPOSIT-BOB-7", "PAUSE-OFF", "PAUSE-ON", "WITHDRAW-ALICE-4", "WITHDRAW-BOB-9"],
  retry_limit: 1,
  bond_amount: 90,
  advance_return_pct: 100,
  rollback_slash_pct: 50,
  timeout_consequence: "LOCKED_NO_AUTO_EXPIRY",
};

function shortHash(value?: string): string {
  if (!value) return "Not available";
  return `${value.slice(0, 12)}…${value.slice(-8)}`;
}

function chainLabel(value?: string): string {
  if (!value) return String(CHAIN_ID);
  try { return BigInt(value).toString(); } catch { return value; }
}

function parseJson<T>(value: string | undefined, fallback: T): T {
  if (!value) return fallback;
  try { return JSON.parse(value) as T; } catch { return fallback; }
}

function copyOf(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

async function readSameOriginArtifact(url: string, expectedHash: string): Promise<Record<string, unknown> | null> {
  if (typeof window === "undefined") return null;
  let target: URL;
  try { target = new URL(url); } catch { return null; }
  if (target.origin !== window.location.origin || target.protocol !== "https:" && target.hostname !== "localhost") return null;
  const response = await fetch(target, { cache: "no-store", credentials: "omit" });
  if (!response.ok) return null;
  const bytes = await response.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const actualHash = Array.from(new Uint8Array(digest), (value) => value.toString(16).padStart(2, "0")).join("");
  if (actualHash !== expectedHash.toLowerCase()) return { _ratchet_hash_mismatch: true };
  const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
}

function statusClass(state?: string): string {
  const value = state?.toLowerCase() ?? "unknown";
  return `status status-${value.replaceAll("_", "-")}`;
}

function GearMark() {
  return (
    <svg className="gear-mark" viewBox="0 0 40 40" aria-hidden="true">
      <path d="M17 3h6l1 4a14 14 0 0 1 3.2 1.3l3.5-2 4.2 4.2-2 3.5a14 14 0 0 1 1.3 3.2l4 1v6l-4 1a14 14 0 0 1-1.3 3.2l2 3.5-4.2 4.2-3.5-2A14 14 0 0 1 24 35l-1 4h-6l-1-4a14 14 0 0 1-3.2-1.3l-3.5 2-4.2-4.2 2-3.5A14 14 0 0 1 5.8 23l-4-1v-6l4-1a14 14 0 0 1 1.3-3.2l-2-3.5 4.2-4.2 3.5 2A14 14 0 0 1 16 7z" transform="translate(0 -1)" fill="currentColor" />
      <circle cx="20" cy="19" r="8" fill="var(--paper)" />
      <circle cx="20" cy="19" r="3" fill="currentColor" />
    </svg>
  );
}

function RefreshMark() {
  return <svg className="inline-mark" viewBox="0 0 20 20" aria-hidden="true"><path d="M16 9a6 6 0 0 0-10-4L4 7m0-4v4h4m-4 4a6 6 0 0 0 10 4l2-2m0 3v-3h-3" /></svg>;
}

function ReleaseActionMark() {
  return <svg className="inline-mark" viewBox="0 0 20 20" aria-hidden="true"><circle cx="10" cy="10" r="5.2" /><path d="M10 1.8v3m0 10.4v3M1.8 10h3m10.4 0h3" /></svg>;
}

function ComparisonMark() {
  return <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 6h13m0 0-3-3m3 3-3 3M17 14H4m0 0 3-3m-3 3 3 3" /></svg>;
}

function CloseMark() {
  return <svg className="inline-mark" viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg>;
}

function EmptyCell({ children }: { children: React.ReactNode }) {
  return <span className="empty-cell">{children}</span>;
}

export default function RatchetBench() {
  const [dashboard, setDashboard] = useState<DashboardSnapshot | null>(null);
  const [dashboardLoading, setDashboardLoading] = useState(Boolean(CONTRACT_ADDRESS));
  const [dashboardError, setDashboardError] = useState("");
  const [savedProof, setSavedProof] = useState<SavedProofSummary | null>(null);
  const [selectedId, setSelectedId] = useState("");
  const [release, setRelease] = useState<Release | null>(null);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [history, setHistory] = useState<HistoryEvent[]>([]);
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [artifacts, setArtifacts] = useState<VerifiedArtifacts | null>(null);
  const [lastTxHash, setLastTxHash] = useState("");
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState("");
  const [activeStop, setActiveStop] = useState<Stop>("declaration");
  const [walletProvider, setWalletProvider] = useState<InjectedProvider | null>(null);
  const [walletAddress, setWalletAddress] = useState("");
  const [walletBusy, setWalletBusy] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [actionMessage, setActionMessage] = useState("");
  const [actionError, setActionError] = useState("");
  const [feeQuote, setFeeQuote] = useState<unknown>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [createBusy, setCreateBusy] = useState(false);
  const [createError, setCreateError] = useState("");
  const [newReleaseId, setNewReleaseId] = useState("");
  const [declarationUrl, setDeclarationUrl] = useState("");
  const [declarationJson, setDeclarationJson] = useState(copyOf(DECLARATION_TEMPLATE));
  const [policyJson, setPolicyJson] = useState(copyOf(POLICY_TEMPLATE));
  const [revisionForm, setRevisionForm] = useState(false);
  const [revisionReportUrl, setRevisionReportUrl] = useState("");
  const [revisionReportHash, setRevisionReportHash] = useState("");
  const [revisionCiUrl, setRevisionCiUrl] = useState("");
  const [revisionCiHash, setRevisionCiHash] = useState("");

  const refreshDashboard = useCallback(async (quiet = false, force = false) => {
    if (!quiet) setDashboardLoading(true);
    try {
      const next = await readDashboard(force);
      setDashboard(next);
      setDashboardError("");
      setSelectedId((current) => current || next.releaseIds.at(-1) || "");
    } catch (error) {
      setDashboardError(readableError(error));
    } finally {
      setDashboardLoading(false);
    }
  }, []);

  const refreshRelease = useCallback(async (id: string, quiet = false, force = false) => {
    if (!id || !CONTRACT_ADDRESS) {
      setRelease(null);
      setAttempts([]);
      setHistory([]);
      setReceipt(null);
      setArtifacts(null);
      return;
    }
    if (!quiet) setDetailLoading(true);
    setArtifacts(null);
    try {
      const next = await readRelease(id, force);
      const [nextAttempts, nextHistory, nextReceipt] = await Promise.all([
        readAttempts(id, Math.min(4, Number(next.attempt_count) || 0), force),
        readHistory(id, force),
        readReceipt(id, force),
      ]);
      setRelease(next);
      setAttempts(nextAttempts);
      setHistory(nextHistory);
      setReceipt(nextReceipt && Object.keys(nextReceipt).length ? nextReceipt : null);
      setArtifacts(null);
      setDetailError("");
    } catch (error) {
      setDetailError(readableError(error));
      setRelease(null);
      setAttempts([]);
      setHistory([]);
      setReceipt(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    const initial = window.setTimeout(() => void refreshDashboard(), 0);
    return () => window.clearTimeout(initial);
  }, [refreshDashboard]);

  useEffect(() => {
    let active = true;
    void readSavedProofSummary().then((proof) => { if (active) setSavedProof(proof); });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (selectedId) {
      const initial = window.setTimeout(() => void refreshRelease(selectedId), 0);
      return () => window.clearTimeout(initial);
    }
  }, [selectedId, refreshRelease]);

  useEffect(() => {
    if (!release) return;
    let active = true;
    const urls = [release.replay_report_url, release.ci_report_url];
    const sameOrigin = urls.every((url) => {
      try { return new URL(url).origin === window.location.origin; } catch { return false; }
    });
    if (!sameOrigin) {
      Promise.resolve().then(() => {
        if (active) setArtifacts({ status: "EXTERNAL" });
      });
      return () => { active = false; };
    }
    Promise.all([
      readSameOriginArtifact(release.replay_report_url, release.replay_report_hash),
      readSameOriginArtifact(release.ci_report_url, release.ci_report_hash),
    ]).then(([report, ci]) => {
      if (!active) return;
      const mismatch = report?._ratchet_hash_mismatch || ci?._ratchet_hash_mismatch;
      setArtifacts({
        status: mismatch ? "HASH_MISMATCH" : report && ci ? "VERIFIED" : "UNAVAILABLE",
        report: report?._ratchet_hash_mismatch ? undefined : report ?? undefined,
        ci: ci?._ratchet_hash_mismatch ? undefined : ci ?? undefined,
      });
    }).catch(() => {
      if (active) setArtifacts({ status: "UNAVAILABLE" });
    });
    return () => { active = false; };
  }, [release]);

  const declaration = useMemo(() => parseJson<Record<string, unknown>>(release?.declaration, {}), [release]);
  const declarationHashes = {
    current: String(declaration.current_implementation_hash ?? ""),
    candidate: String(declaration.candidate_implementation_hash ?? ""),
  };
  const verdict = parseJson<Record<string, unknown>>(release?.final_result, {});
  const bond = parseJson<Record<string, unknown>>(release?.bond, {});
  const latestAttempt = attempts.at(-1);
  const latestOutcome = latestAttempt?.normalized_result
    ? parseJson<Record<string, unknown>>(latestAttempt.normalized_result, {})
    : verdict;
  const declaredChanges = [
    ...(Array.isArray(declaration.declared_storage_changes) ? declaration.declared_storage_changes : []),
    ...(Array.isArray(declaration.declared_permission_changes) ? declaration.declared_permission_changes : []),
    ...(Array.isArray(declaration.declared_external_call_changes) ? declaration.declared_external_call_changes : []),
    ...(Array.isArray(declaration.declared_capabilities) ? declaration.declared_capabilities : []),
  ];
  const policy = parseJson<Record<string, unknown>>(release?.policy, {});
  const selectedIndex = STOPS.findIndex((stop) => stop.id === activeStop);
  const replayReport = artifacts?.report ?? null;
  const coverage = replayReport && typeof replayReport.coverage === "object" ? replayReport.coverage as Record<string, unknown> : null;
  const replayRows = Array.isArray(replayReport?.transactions) ? replayReport.transactions as Record<string, unknown>[] : [];
  const invariantRows = Array.isArray(replayReport?.invariants) ? replayReport.invariants as Record<string, unknown>[] : [];

  async function handleConnect() {
    const provider = walletProvider ?? getInjectedProvider();
    if (!provider) {
      setActionError("No browser wallet was found. Install or unlock an EIP-1193 wallet to submit contract actions.");
      return;
    }
    setWalletBusy(true);
    setActionError("");
    try {
      const account = await connectWallet(provider);
      await ensureStudioChain(provider);
      setWalletAddress(account);
      setWalletProvider(provider);
      setActionMessage(`Wallet connected to ${NETWORK_LABEL}.`);
    } catch (error) {
      setActionError(readableError(error));
    } finally {
      setWalletBusy(false);
    }
  }

  async function act(method: string, args: unknown[], label: string): Promise<boolean> {
    if (!walletProvider || !walletAddress) {
      setActionError(`Connect a wallet on ${NETWORK_LABEL} to submit this transaction.`);
      return false;
    }
    setActionBusy(true);
    setActionError("");
    setActionMessage(`Quoting ${label.toLowerCase()} on ${NETWORK_LABEL}…`);
    setFeeQuote(null);
    try {
      const sent = await sendWrite(walletProvider, walletAddress, method, args, (quote) => {
        setFeeQuote(quote.breakdown);
        setActionMessage(`Submitted ${label.toLowerCase()}. Waiting for a finalized ${NETWORK_LABEL} receipt…`);
      });
      setLastTxHash(sent.txId);
      if (!sent.finalized) throw new Error(`Transaction ${sent.txId} did not reach finality.`);
      setActionMessage(sent.successful
        ? `${label} finalized. Contract state refreshed from ${NETWORK_LABEL}.`
        : `${label} finalized with a failed contract execution. The release state was not assumed to change.`);
      await refreshRelease(selectedId, true, true);
      await refreshDashboard(true, true);
      return sent.successful;
    } catch (error) {
      setActionError(readableError(error));
      setActionMessage("");
      return false;
    } finally {
      setActionBusy(false);
    }
  }

  async function createRelease() {
    if (!walletProvider || !walletAddress) {
      setCreateError(`Connect a wallet on ${NETWORK_LABEL} before creating a release.`);
      return;
    }
    setCreateBusy(true);
    setCreateError("");
    try {
      if (!/^[A-Z0-9][A-Z0-9._-]{1,47}$/.test(newReleaseId)) throw new Error("Release ID must be 2–48 uppercase letters, digits, dots, underscores, or hyphens.");
      const parsed = JSON.parse(declarationJson) as Record<string, unknown>;
      JSON.parse(policyJson);
      if (parsed.release_id !== newReleaseId) throw new Error("The declaration's release_id must match the release ID field.");
      if (!/^https:\/\/[^\s<>]+$/.test(declarationUrl)) throw new Error("Host the declaration at a public HTTPS URL before creating this release.");
      const canonical = canonicalJson(parsed);
      const hash = await sha256(canonical);
      const submitted = await act("create_release", [newReleaseId, canonical, declarationUrl, hash, canonicalJson(JSON.parse(policyJson))], "Create release");
      if (!submitted) {
        setCreateError("The release was not created. Review the wallet or transaction status before trying again.");
        return;
      }
      setShowCreate(false);
      setSelectedId(newReleaseId);
    } catch (error) {
      setCreateError(readableError(error));
    } finally {
      setCreateBusy(false);
    }
  }

  async function submitRevision() {
    if (!release) return;
    if (!/^https:\/\/[^\s<>]+$/.test(revisionReportUrl) || !/^[0-9a-f]{64}$/.test(revisionReportHash)) {
      setActionError("Replay evidence needs a public HTTPS URL and a lowercase SHA-256 hash.");
      return;
    }
    if (!/^https:\/\/[^\s<>]+$/.test(revisionCiUrl) || !/^[0-9a-f]{64}$/.test(revisionCiHash)) {
      setActionError("CI evidence needs a public HTTPS URL and a lowercase SHA-256 hash.");
      return;
    }
    const submitted = await act("submit_evidence_revision", [release.release_id, revisionReportUrl, revisionReportHash, revisionCiUrl, revisionCiHash], "Submit evidence revision");
    if (submitted) setRevisionForm(false);
  }

  function openCreate() {
    const id = `REL-${new Date().toISOString().slice(2, 10).replaceAll("-", "")}`;
    setNewReleaseId(id);
    setDeclarationJson(copyOf({ ...DECLARATION_TEMPLATE, release_id: id }));
    setDeclarationUrl("");
    setShowCreate(true);
    setCreateError("");
  }

  const verdictName = String(latestOutcome.verdict ?? "PENDING");
  const firstTrack = STOPS[selectedIndex] ?? STOPS[0];

  return (
    <div className="app-shell">
      <svg className="svg-definitions" aria-hidden="true" focusable="false">
        <filter id="pencil-ink" x="-8%" y="-8%" width="116%" height="116%">
          <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="1" seed="7" result="grain" />
          <feDisplacementMap in="SourceGraphic" in2="grain" scale="0.55" />
        </filter>
      </svg>
      <header className="topbar">
        <a className="brand" href="#top" aria-label="Ratchet home">
          <span className="brand-mark"><GearMark /></span>
          <span><strong>ratchet</strong><small>release calibration bench</small></span>
        </a>
        <nav className="top-nav" aria-label="Main navigation">
          <a href="#release">Release bench</a>
          <a href="#evidence">Evidence path</a>
          <a href="#method">Method</a>
        </nav>
        <button className="wallet-button" onClick={handleConnect} disabled={walletBusy}>
          <span className={`wallet-dot ${walletAddress ? "is-live" : ""}`} />
          {walletBusy ? "Connecting…" : walletAddress ? `${walletAddress.slice(0, 6)}…${walletAddress.slice(-4)}` : "Connect wallet"}
        </button>
      </header>

      <main id="top">
        <section className="workbench" aria-labelledby="page-title">
          <div className="bench-intro">
            <div className="intro-copy">
              <h1 id="page-title">Upgrades must stay inside<br className="desktop-break" /> what they declare.</h1>
              <p>Ratchet lines up a frozen release declaration with what local EVM replay actually observed. Validators review the evidence; the contract records the outcome.</p>
            </div>
            <div className="connection-stamp" aria-live="polite">
              <div className="connection-head">
                <span className={`connection-indicator ${dashboard?.networkOk ? "connected" : dashboardLoading ? "checking" : CONTRACT_ADDRESS ? "disconnected" : "checking"}`} />
                <span>{NETWORK_LABEL}</span>
                <button className="quiet-icon-button" aria-label="Refresh live status" onClick={() => void refreshDashboard(false, true)} disabled={dashboardLoading}>
                  <RefreshMark />
                </button>
              </div>
              <div className="connection-copy">
                {dashboardLoading && !dashboard ? "Checking the configured RPC…" : !CONTRACT_ADDRESS ? "Contract not configured · live reads unavailable" : dashboard?.networkOk ? `Live RPC · chain ${chainLabel(dashboard.chainId)}` : `RPC unavailable · ${NETWORK_LABEL} could not be reached`}
              </div>
              <div className={`address-copy ${CONTRACT_ADDRESS ? "configured" : "missing"}`}>
                <span className="address-label">CONTRACT</span>
                {CONTRACT_ADDRESS ? <a href={explorerAddress(CONTRACT_ADDRESS)} target="_blank" rel="noreferrer">{shortHash(CONTRACT_ADDRESS)}</a> : <span>Address not configured</span>}
              </div>
            </div>
          </div>

          <div className="registration-rule"><span>01</span><i /><span>DECLARED INTENT</span><i /><span>OBSERVED EXECUTION</span><i /><span>CONSENSUS</span><i /><span>CONTRACT ACTION</span></div>

          <section className="release-bay" id="release" aria-labelledby="release-heading">
            <div className="bay-head">
              <div className="bay-title">
                <h2 id="release-heading">Release bench</h2>
              </div>
              <div className="bay-actions">
                {dashboard?.releaseIds.length ? (
                  <label className="release-picker-label">SELECT RELEASE
                    <select value={selectedId} onChange={(event) => { setSelectedId(event.target.value); setActiveStop("declaration"); }}>
                      {dashboard.releaseIds.slice().reverse().map((id) => <option key={id} value={id}>{id}</option>)}
                    </select>
                  </label>
                ) : null}
                <button className="outline-button" onClick={openCreate} disabled={!CONTRACT_ADDRESS || !dashboard?.networkOk}>Prepare release</button>
              </div>
            </div>

            {dashboard?.releaseIds.length ? <div className="demo-shortcuts" aria-label="Seeded release scenarios">
              <span className="field-label">OPEN A LIVE EXAMPLE</span>
              {(["RATCHET-ADVANCE", "RATCHET-HOLD", "RATCHET-ROLLBACK"] as const)
                .filter((id) => dashboard.releaseIds.includes(id))
                .map((id) => <button className="demo-shortcut" key={id} onClick={() => { setSelectedId(id); setActiveStop("declaration"); }} aria-pressed={selectedId === id}>{id}</button>)}
            </div> : null}

            {dashboardError ? <div className="inline-alert error" role="status">Could not read {NETWORK_LABEL}: {dashboardError}</div> : null}
            {detailError ? <div className="inline-alert error" role="status">Could not read {selectedId}: {detailError}</div> : null}
            {actionError ? <div className="inline-alert error" role="alert">{actionError}</div> : null}
            {actionMessage ? <div className="inline-alert info" role="status">{actionMessage}</div> : null}

            <div className="specimen-layout">
              <div className="specimen-primary">
                <div className="release-heading-row">
                  <div>
                    <h3>{release?.release_id ?? (dashboardLoading ? "Reading release index…" : "No release selected")}</h3>
                  </div>
                  {release ? <span className={statusClass(release.state)}><span className="status-shape" />{release.state}</span> : <span className="status status-unavailable"><span className="status-shape" />UNAVAILABLE</span>}
                </div>

                {release ? (
                  <>
                    <div className="hash-register">
                      <div className="hash-side current">
                        <span className="hash-caption"><span className="hash-dot" /> CURRENT IMPLEMENTATION</span>
                        <code title={declarationHashes.current}>{shortHash(declarationHashes.current)}</code>
                      </div>
                      <div className="register-link" aria-hidden="true"><span /><span /><span /></div>
                      <div className="hash-side candidate">
                        <span className="hash-caption"><span className="hash-dot" /> CANDIDATE IMPLEMENTATION</span>
                        <code title={declarationHashes.candidate}>{shortHash(declarationHashes.candidate)}</code>
                      </div>
                    </div>

                    <div className="verdict-strip">
                      <svg className={`decision-doodle decision-doodle-${verdictName.toLowerCase()}`} viewBox="0 0 84 42" aria-hidden="true">
                        <path d="M79 3 C77 19 62 31 28 35" />
                        <path d="M42 25 27 35l-1-14" />
                      </svg>
                      <div className="verdict-main">
                        <span className="section-index">ACTIVE GATE <span className="gate-step">{String(Math.max(1, selectedIndex + 1)).padStart(2, "0")} / 05</span></span>
                        <strong className={`verdict-word verdict-${verdictName.toLowerCase()}`}>{verdictName}</strong>
                        <p>{verdictName === "ADVANCE" ? "The recorded checks agree with the frozen declaration." : verdictName === "HOLD" ? "The candidate stays blocked while the evidence gap is resolved." : verdictName === "ROLLBACK" ? "The candidate path is closed; the current implementation remains approved." : release.state === "DRAFT" ? "Declaration is editable until it is sealed." : release.state === "SEALED" ? "Evidence is sealed and waiting for validator adjudication." : "No validator verdict has been recorded for this attempt."}</p>
                      </div>
                      <div className="gate-consequence">
                        <span className="section-index">DEMO BOND · NOT ASSETS</span>
                        <strong>{String(bond.amount ?? "—")} <small>units</small></strong>
                        <span className="bond-breakdown">{String(bond.state ?? "UNSET")} · <span className="bond-locked">{String(bond.locked ?? 0)} locked</span> · <span className="bond-returned">{String(bond.returned ?? 0)} returned</span> · <span className="bond-slashed">{String(bond.slashed ?? 0)} slashed</span></span>
                      </div>
                    </div>

                    <div className="action-dock">
                      <div className="action-dock-copy">
                        <span className="section-index">CONTRACT CONTROL</span>
                        <strong>{release.state === "DRAFT" ? "Freeze the declaration when it is ready." : release.state === "SEALED" ? "Send this sealed attempt for independent review." : release.state === "HELD" ? "Add a bounded evidence revision to continue." : "This release has reached a terminal state."}</strong>
                        <span>On-chain actions require a wallet on chain {CHAIN_ID}.</span>
                      </div>
                      <div className="action-buttons">
                        {release.state === "DRAFT" ? <>
                          <button className="primary-button" onClick={() => void act("seal_release", [release.release_id], "Seal declaration")} disabled={actionBusy || !walletAddress}><span className="button-symbol"><ReleaseActionMark /></span>{actionBusy ? "Working…" : "Seal declaration"}</button>
                          <button className="text-button" onClick={() => void act("cancel_draft", [release.release_id], "Cancel draft")} disabled={actionBusy || !walletAddress}>Cancel draft</button>
                        </> : null}
                        {release.state === "SEALED" ? <button className="primary-button" onClick={() => void act("adjudicate", [release.release_id], "Adjudicate attempt")} disabled={actionBusy || !walletAddress}><span className="button-symbol"><ReleaseActionMark /></span>{actionBusy ? "Waiting for validators…" : "Adjudicate attempt"}</button> : null}
                        {release.state === "HELD" ? <button className="primary-button hold-button" onClick={() => { setRevisionForm((value) => !value); setActionError(""); }} disabled={actionBusy || !walletAddress}>Submit evidence revision</button> : null}
                        {!walletAddress && release.state !== "ADVANCED" && release.state !== "ROLLED_BACK" && release.state !== "CANCELLED" ? <button className="quiet-link" onClick={handleConnect}>Connect wallet</button> : null}
                      </div>
                    </div>

                    {feeQuote ? <div className="fee-note">Live transaction-kit estimate · {JSON.stringify(feeQuote)}</div> : null}
                    {revisionForm && release.state === "HELD" ? (
                      <div className="revision-form">
                        <div className="revision-title"><span className="section-index">ATTEMPT {release.attempt_count + 1} · EVIDENCE ONLY</span><button className="quiet-icon-button" aria-label="Close revision form" onClick={() => setRevisionForm(false)}><CloseMark /></button></div>
                        <label>Replay report HTTPS URL<input value={revisionReportUrl} onChange={(event) => setRevisionReportUrl(event.target.value)} placeholder="https://evidence.example/replay-r2.json" /></label>
                        <label>Replay report SHA-256<input value={revisionReportHash} onChange={(event) => setRevisionReportHash(event.target.value)} placeholder="64 lowercase hexadecimal characters" /></label>
                        <label>CI report HTTPS URL<input value={revisionCiUrl} onChange={(event) => setRevisionCiUrl(event.target.value)} placeholder="https://evidence.example/ci-r2.json" /></label>
                        <label>CI report SHA-256<input value={revisionCiHash} onChange={(event) => setRevisionCiHash(event.target.value)} placeholder="64 lowercase hexadecimal characters" /></label>
                        <p>Evidence is fetched independently by GenLayer validators. The sealed declaration and settlement policy stay frozen.</p>
                        <button className="primary-button" onClick={() => void submitRevision()} disabled={actionBusy || !walletAddress}>{actionBusy ? "Submitting…" : "Seal revised evidence"}</button>
                      </div>
                    ) : null}

                    <div className="flight-recorder" id="evidence">
                      <div className="recorder-heading"><strong className="recorder-name">Release flight recorder</strong><span className="recorder-note">Select a stop to inspect evidence</span></div>
                      <div className="recorder-rail" role="tablist" aria-label="Release evidence stages">
                        <span className="rail-track" aria-hidden="true" />
                        <span className="rail-progress" style={{ transform: `scaleX(${selectedIndex / 4})` }} aria-hidden="true" />
                        <span className="inspection-shuttle" style={{ left: `${selectedIndex * 25}%` }} aria-hidden="true"><span /></span>
                        {STOPS.map((stop, index) => (
                          <button className={`stop-button ${activeStop === stop.id ? "selected" : ""} ${index < selectedIndex ? "passed" : ""}`} key={stop.id} role="tab" aria-selected={activeStop === stop.id} aria-controls="evidence-inspection" onClick={() => setActiveStop(stop.id)}>
                            <span className="stop-node"><span>{index + 1}</span></span>
                            <strong>{stop.label}</strong>
                          </button>
                        ))}
                      </div>
                      <div className="inspection-panel" id="evidence-inspection" role="tabpanel" aria-label={`${firstTrack.label} evidence`}>
                        <div className="inspection-title">
                          <div><h4>{firstTrack.label}</h4></div>
                          <button className="quiet-link" onClick={() => void refreshRelease(selectedId, false, true)}>Refresh live read <RefreshMark /></button>
                        </div>
                        {detailLoading ? <div className="inspection-empty"><span className="small-spinner" />Reading the sealed record from {NETWORK_LABEL}…</div> : null}
                        {!detailLoading && activeStop === "declaration" ? <div className="inspection-grid">
                          <div className="inspection-note"><span className="field-label">PROVENANCE</span><strong>{String((declaration.source_provenance as Record<string, unknown> | undefined)?.repository ?? "No source repository declared")}</strong><span>{String((declaration.source_provenance as Record<string, unknown> | undefined)?.commit ?? "Commit not available")}</span></div>
                          <div className="inspection-note"><span className="field-label">POLICY VERSION</span><strong>{String(policy.policy_version ?? "—")}</strong><span>{String(policy.retry_limit ?? 0)} evidence revision(s) · {String(policy.bond_amount ?? 0)} demo units</span></div>
                          <div className="full-width code-evidence"><span className="field-label">FROZEN DECLARATION HASH</span><code>{release.declaration_hash}</code><a href={release.declaration_url} target="_blank" rel="noreferrer">Open declaration artifact</a><span>{artifacts?.status === "VERIFIED" ? "Same-origin replay and CI bytes match their recorded SHA-256 hashes." : artifacts?.status === "HASH_MISMATCH" ? "A same-origin artifact does not match its recorded SHA-256 hash." : artifacts?.status === "EXTERNAL" ? "External artifacts are linked for inspection; the browser does not fetch third-party URLs." : "Replay and CI artifacts are not browser-verified."}</span></div>
                          <div className="full-width code-evidence"><span className="field-label">DECLARED CHANGE SET</span>{declaredChanges.length ? <pre>{JSON.stringify(declaredChanges, null, 2)}</pre> : <EmptyCell>No storage, permission, external-call, or capability changes declared.</EmptyCell>}</div>
                        </div> : null}
                        {!detailLoading && activeStop === "replay" ? <div className="inspection-grid">
                          <div className="inspection-note"><span className="field-label">DATASET</span><strong>{String((declaration.replay_dataset as Record<string, unknown> | undefined)?.dataset_id ?? "Not declared")}</strong><span>{String(((declaration.replay_dataset as Record<string, unknown> | undefined)?.required_case_ids as unknown[] | undefined)?.length ?? 0)} policy-required cases</span></div>
                          <div className="inspection-note"><span className="field-label">REPLAY ARTIFACT</span><strong>{shortHash(release.replay_report_hash)}</strong><span>{coverage && Array.isArray(coverage.executed_case_ids) ? `${coverage.executed_case_ids.length} / ${Array.isArray(coverage.required_case_ids) ? coverage.required_case_ids.length : "?"} required cases · ` : ""}Attempt {Math.max(1, release.attempt_count)} · local EVM execution</span></div>
                          <div className="full-width code-evidence"><span className="field-label">CURRENT REPORT ADDRESS</span><a href={release.replay_report_url} target="_blank" rel="noreferrer">{release.replay_report_url}</a><code>{release.replay_report_hash}</code></div>
                          <div className="full-width code-evidence"><span className="field-label">CI RECEIPT</span><a href={release.ci_report_url} target="_blank" rel="noreferrer">{release.ci_report_url}</a><code>{release.ci_report_hash}</code><span>{artifacts?.status === "VERIFIED" ? "Browser verification: report and CI receipt match both hashes recorded by the contract." : "CI executes local EVM replay; it does not authorize a release."}</span></div>
                          {replayReport ? <div className="full-width code-evidence"><span className="field-label">TRANSACTION RECEIPTS · {replayRows.length} CASES</span>{replayRows.slice(0, 7).map((row, index) => {
                            const baseline = row.baseline && typeof row.baseline === "object" ? row.baseline as Record<string, unknown> : {};
                            const candidate = row.candidate && typeof row.candidate === "object" ? row.candidate as Record<string, unknown> : {};
                            const baseReceipt = baseline.receipt && typeof baseline.receipt === "object" ? baseline.receipt as Record<string, unknown> : {};
                            const nextReceipt = candidate.receipt && typeof candidate.receipt === "object" ? candidate.receipt as Record<string, unknown> : {};
                            return <div className="transaction-row" key={`${String(row.case_id)}-${index}`}><strong>{String(row.case_id ?? "CASE")}</strong><span>Current <b className={String(baseReceipt.status).toLowerCase()}>{String(baseReceipt.status ?? "—")}</b></span><span>Candidate <b className={String(nextReceipt.status).toLowerCase()}>{String(nextReceipt.status ?? "—")}</b></span><span className="transaction-hash">{shortHash(String(nextReceipt.transaction_hash ?? ""))}</span></div>;
                          })}</div> : null}
                        </div> : null}
                        {!detailLoading && activeStop === "comparison" ? <div className="comparison-sequence">
                          <div className="comparison-lane declared"><span className="field-label">DECLARED</span><strong>{declaredChanges.length} change group(s)</strong><span>Frozen at seal</span></div>
                          <div className="comparison-connector" aria-hidden="true"><ComparisonMark /></div>
                          <div className="comparison-lane observed"><span className="field-label">OBSERVED</span><strong>{attempts.length ? String(latestOutcome.evidence_status ?? "REPLAYED") : "Awaiting replay evidence"}</strong><span>From hash-pinned report</span></div>
                          <div className="comparison-lane decision"><span className="field-label">DECISION</span><strong>{String(latestOutcome.verdict ?? "PENDING")}</strong><span>Interpretation by GenLayer validators</span></div>
                          <div className="comparison-footnote">{artifacts?.status === "HASH_MISMATCH" ? "The browser found a hash mismatch; treat this artifact as contradictory until validators review it." : coverage && Array.isArray(coverage.executed_case_ids) ? `${coverage.executed_case_ids.length} of ${Array.isArray(coverage.required_case_ids) ? coverage.required_case_ids.length : "?"} required cases executed. Missing: ${Array.isArray(coverage.missing_case_ids) && coverage.missing_case_ids.length ? (coverage.missing_case_ids as unknown[]).join(", ") : "none"}.` : "The replay report is evidence for review, not a trusted oracle. Coverage is policy-defined and representative, not exhaustive."} Validators independently retrieve the evidence before contract action.</div>
                          {artifacts?.status === "VERIFIED" && replayReport ? <div className="diff-ledger full-width"><span className="field-label">OBSERVED CHANGE REGISTER</span>
                            {(["storage_diffs", "permission_diffs", "external_call_diffs", "capability_diffs"] as const).map((key) => {
                              const rows = Array.isArray(replayReport[key]) ? replayReport[key] as Record<string, unknown>[] : [];
                              if (!rows.length) return null;
                              return <div className="diff-group" key={key}><strong>{key.replaceAll("_", " ")}</strong>{rows.map((row, index) => <div className="diff-row" key={`${key}-${index}`}><span>{String(row.id ?? row.capability ?? row.case_id ?? key)}</span><code>{typeof row.baseline === "undefined" ? "observed" : `${String(row.baseline)} → ${String(row.candidate)}`}</code><b>{row.status ? String(row.status) : row.changed === false ? "SAME" : "CHANGED"}</b></div>)}</div>;
                            })}
                            {invariantRows.map((row, index) => <div className={`diff-row invariant-row invariant-${String(row.status ?? "unknown").toLowerCase()}`} key={`invariant-${index}`}><span>{String(row.id ?? "INVARIANT")}</span><code>{String(row.status ?? "UNKNOWN")}</code><b>{String(row.status ?? "UNKNOWN")}</b></div>)}
                          </div> : null}
                        </div> : null}
                        {!detailLoading && activeStop === "consensus" ? <div className="consensus-sequence">
                          <div className="consensus-result"><span className={`verdict-badge verdict-badge-${String(latestOutcome.verdict ?? "pending").toLowerCase()}`}>{String(latestOutcome.verdict ?? "PENDING")}</span><strong>{String(latestOutcome.evidence_status ?? "No result recorded")}</strong><span>Stable IDs and normalized fields determine the result; free-form explanations do not select remedies.</span></div>
                          <div className="consensus-record"><span className="field-label">VIOLATED INVARIANTS</span><code>{JSON.stringify(latestOutcome.violated_ids ?? [])}</code><span className="field-label">UNDECLARED CHANGES</span><code>{JSON.stringify(latestOutcome.undeclared_change_ids ?? [])}</code><span className="field-label">MISSING EVIDENCE</span><code>{JSON.stringify(latestOutcome.missing_evidence_ids ?? [])}</code><span className="field-label">BROWSER ARTIFACT CHECK</span><code>{artifacts?.status ?? "WAITING"}</code></div>
                          <div className="full-width code-evidence"><span className="field-label">INDEPENDENT REVIEW ATTEMPTS</span>{attempts.map((attempt) => <p className="attempt-chip" key={attempt.attempt_index}>Attempt {attempt.attempt_index + 1} · {attempt.kind} · {attempt.verdict ?? "awaiting adjudication"} · {attempt.error_class ?? "no classified error"}</p>)}</div>
                        </div> : null}
                        {!detailLoading && activeStop === "action" ? <div className="action-sequence">
                          <div className="action-outcome"><span className="field-label">CONTRACT STATE</span><strong>{release.state}</strong><p>{release.state === "ADVANCED" ? "The candidate passed its recorded release gate and the demo bond was returned. No EVM upgrade was executed." : release.state === "ROLLED_BACK" ? "Ratchet closed the candidate path and applied the frozen demo bond rule. The current implementation remains approved; no EVM rollback was executed." : release.state === "HELD" ? "The candidate remains blocked. The contract holds the demo units while bounded evidence revisions remain." : release.state === "CANCELLED" ? "The draft closed before sealing and the demo lock was released." : "No terminal contract action has been recorded."}</p></div>
                          <div className="action-proof"><span className="field-label">FINAL RECEIPT</span>{receipt ? <><code>{receipt.declaration_hash}</code><code>{receipt.replay_report_hash}</code><code>{receipt.ci_report_hash}</code><span>Attempt {receipt.attempt_index + 1} · {receipt.policy_version}</span></> : <EmptyCell>The contract has not recorded a final adjudication receipt.</EmptyCell>}</div>
                          {lastTxHash ? <a href={`${EXPLORER_URL}/tx/${lastTxHash}`} target="_blank" rel="noreferrer">Latest wallet transaction · {shortHash(lastTxHash)} · open explorer</a> : null}
                        </div> : null}
                        {detailError ? <p className="inspection-empty">{detailError}</p> : null}
                      </div>
                    </div>

                    <div className="history-strip">
                      <div className="history-heading"><strong>Release history</strong></div>
                      <ol>{history.slice(-5).map((item, index) => <li key={`${item.event}-${index}`}><span className="history-pin" /><span><strong>{item.event.replaceAll("_", " ")}</strong><small>{item.state}{typeof item.attempt_index === "number" ? ` · attempt ${item.attempt_index + 1}` : ""}</small></span></li>)}</ol>
                      {!history.length ? <EmptyCell>Contract history is unavailable.</EmptyCell> : null}
                    </div>
                  </>
                ) : (
                  <div className="no-release-state">
                    <div className="no-release-mark"><GearMark /></div>
                    <div><strong>{dashboardLoading ? "Reading the release index" : !CONTRACT_ADDRESS ? `Connect Ratchet to ${NETWORK_LABEL}` : "No releases are recorded yet"}</strong>
                      <p>{!CONTRACT_ADDRESS ? `The interface does not substitute sample records for chain state. Configure the deployed ${NETWORK_LABEL} contract to enable live review.` : dashboard?.networkOk ? "Create a release declaration to begin a live review. First publish its declaration, replay report, and CI receipt at public HTTPS addresses." : `The configured RPC is unavailable. Try again when ${NETWORK_LABEL} can answer a live read.`}</p>
                      {!CONTRACT_ADDRESS ? <code>chain {CHAIN_ID} · {RPC_URL}</code> : null}
                      {dashboard?.releaseIds.length ? null : <button className="primary-button" onClick={openCreate} disabled={!CONTRACT_ADDRESS || !dashboard?.networkOk}>Prepare first release</button>}
                      {savedProof && (dashboardError || !dashboard?.networkOk) ? <div className="archived-proof" aria-label="Saved verified proof">
                        <div className="archived-proof-heading"><strong>Saved proof · verified {new Date(savedProof.verified_at).toLocaleString()}</strong><span>Archived evidence, not live chain state</span></div>
                        <p>Contract <code>{shortHash(savedProof.contract)}</code> · chain {savedProof.chain_id} · source commit <code>{savedProof.source_commit.slice(0, 12)}</code></p>
                        <div className="archived-proof-releases">{savedProof.releases.map((item) => <article key={item.release_id}>
                          <strong className={`verdict-${item.verdict.toLowerCase()}`}>{item.verdict}</strong><span>{item.release_id} · {item.state}</span>
                          <a href={item.adjudication_explorer_url} target="_blank" rel="noreferrer">Open finalized receipt</a>
                        </article>)}</div>
                        <a className="quiet-link" href={savedProof.github_ci_runs} target="_blank" rel="noreferrer">Review hosted replay checks</a>
                      </div> : null}
                    </div>
                  </div>
                )}
              </div>

              <aside className="specimen-side" aria-label="Bench reference">
                <div className="side-instrument">
                  <div className="instrument-ring outer-ring"><span className="ring-tick tick-top" /><span className="ring-tick tick-right" /><span className="ring-tick tick-bottom" /><span className="ring-tick tick-left" /><div className="instrument-core"><span className="instrument-cross horizontal" /><span className="instrument-cross vertical" /><span className="core-dot" /></div></div>
                  <span className="instrument-caption">DECLARATION<br />ALIGNMENT</span>
                </div>
                <div className="side-rule" />
                <div className="side-stat"><span className="field-label">RELEASE RECORDS</span><strong>{dashboard?.stats.total_releases ?? "—"}</strong><small>live contract index</small></div>
                <div className="state-counts">
                  <span><i className="count-dot count-advance" />ADVANCED <b>{dashboard?.stats.advanced ?? "—"}</b></span>
                  <span><i className="count-dot count-hold" />ON HOLD <b>{dashboard?.stats.held ?? "—"}</b></span>
                  <span><i className="count-dot count-rollback" />ROLLED BACK <b>{dashboard?.stats.rolled_back ?? "—"}</b></span>
                </div>
                <a className="explorer-link" href={CONTRACT_ADDRESS ? explorerAddress(CONTRACT_ADDRESS) : EXPLORER_URL} target="_blank" rel="noreferrer">Open Studio explorer</a>
              </aside>
            </div>
          </section>

          <section className="method-band" id="method">
            <div><h2>Evidence first.<br />A clear decision after.</h2></div>
            <div className="method-columns">
              <article><span className="method-number">1</span><strong>CI replays transactions</strong><p>Current and candidate EVM implementations run the same policy-defined corpus in isolated local deployments.</p></article>
              <article><span className="method-number">2</span><strong>Validators inspect evidence</strong><p>GenLayer validators retrieve the hash-pinned declaration and replay artifacts independently.</p></article>
              <article><span className="method-number">3</span><strong>Ratchet records the outcome</strong><p>Consensus selects ADVANCE, HOLD, or ROLLBACK; the contract applies the frozen state and demo-bond rule.</p></article>
            </div>
            <p className="method-boundary">Ratchet does not execute candidate EVM bytecode, perform a proxy upgrade, or run a real EVM rollback. Demo bond units are not assets. Local replay evidence is synthetic and representative, not exhaustive or an independent security audit.</p>
            <a className="hosted-ci-link" href="https://github.com/JWattjr/Ratchet/actions/workflows/ci.yml" target="_blank" rel="noreferrer">Open hosted replay verification and downloadable commit attestation</a>
          </section>

          <footer className="footer"><a className="footer-brand" href="#top"><GearMark /> ratchet</a><span>{NETWORK_LABEL} · chain {CHAIN_ID} · evidence remains inspectable without a wallet</span><a href="https://docs.genlayer.com" target="_blank" rel="noreferrer">GenLayer documentation</a></footer>
        </section>
      </main>

      {showCreate ? <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowCreate(false); }}>
        <section className="create-dialog" role="dialog" aria-modal="true" aria-labelledby="create-heading">
          <div className="dialog-header"><div><h2 id="create-heading">Create a release record</h2></div><button className="quiet-icon-button close-button" aria-label="Close" onClick={() => setShowCreate(false)}><CloseMark /></button></div>
          <p className="dialog-intro">Publish these exact artifacts at public HTTPS URLs before sealing. Ratchet checks the declaration hash at creation and validators fetch the artifacts independently during adjudication.</p>
          <label>Release ID<input value={newReleaseId} maxLength={48} onChange={(event) => setNewReleaseId(event.target.value.toUpperCase())} /></label>
          <label>Public declaration artifact URL<input value={declarationUrl} onChange={(event) => setDeclarationUrl(event.target.value)} placeholder="https://evidence.example/releases/REL-123/declaration.json" /></label>
          <label>Declaration JSON <span className="label-hint">The release_id must match above. Hash uses canonical JSON.</span><textarea value={declarationJson} onChange={(event) => setDeclarationJson(event.target.value)} spellCheck={false} /></label>
          <details className="policy-editor"><summary>Settlement policy JSON</summary><textarea value={policyJson} onChange={(event) => setPolicyJson(event.target.value)} spellCheck={false} /></details>
          <div className="dialog-boundary">Release creation records a demonstration bond rule in contract state. It does not transfer real assets. Declaration and policy freeze when sealed.</div>
          {createError ? <div className="inline-alert error" role="alert">{createError}</div> : null}
          <div className="dialog-actions"><button className="text-button" onClick={() => setShowCreate(false)}>Close</button><button className="primary-button" onClick={() => void createRelease()} disabled={createBusy || !CONTRACT_ADDRESS || !dashboard?.networkOk || !walletAddress}>{createBusy ? "Submitting…" : "Create with wallet"}</button></div>
        </section>
      </div> : null}
    </div>
  );
}
