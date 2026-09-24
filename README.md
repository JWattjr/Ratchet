# Ratchet

Ratchet is a GenLayer release-governance application. It freezes a release declaration, has Studio Next validators compare that declaration with hash-pinned replay evidence, and records an `ADVANCE`, `HOLD`, or `ROLLBACK` decision on-chain. It does not execute EVM bytecode, move production assets, or perform a proxy upgrade or rollback.

The shipped surface is the Ratchet Calibration Bench: a friendly, precise review workbench for tracing a declaration through replay observations, validator consensus, and the resulting contract state.

## Requirements

- Node.js 22 or newer
- Python 3.12
- npm
- A Studio Next connection for deployment and on-chain integration; chain ID `61997`
- A Vercel account for the public demo and its validator-readable evidence URLs

## Local setup

```powershell
npm install
npm run setup:python
npm run check
```

`npm run check` builds and verifies the deterministic Hardhat replay, lints and generates the GenLayer contract schema, runs direct contract tests and replay artifact tests, then runs frontend lint, TypeScript checks, a production build, browser UI checks, and responsive screenshots/overflow checks.

The Python environment is pinned by `requirements.txt`; the contract's GenVM runner is pinned in its first-line metadata. Solidity compilation uses the pinned local `solc` package. Generated deployment keys are stored under `.keys/`, which is ignored by Git.

## Studio Next demo deployment

The contract fetches its evidence from public HTTPS URLs. Publish the frontend and evidence before seeding a release:

1. Run `npm run replay:generate` and `npm run replay:verify`.
2. Deploy the frontend once to obtain its stable public origin.
3. Set `RATCHET_EVIDENCE_BASE_URL` to that HTTPS origin.
4. Run `npm run prepare:demo`; this creates three canonical, hash-pinned declarations for the current generated replay reports.
5. Redeploy the frontend so those declaration files are public.
6. Run `npm run deploy`. The script pins the runner, obtains the account from `RATCHET_DEPLOYER_KEY` or the ignored `.keys/deployer.key`, funds only the Studio Next test account if needed, quotes through Transaction Kit, waits for finality, and writes the deployment manifest and full receipt. It never prints the private key.
7. Run `npm run seed:demo`, `npm run test:integration`, `npm run verify:proof`, and `npm run profile:fees`.
8. Redeploy once more to publish the receipt-derived `fee-profile.json`, then set the frontend's public contract address if Vercel did not inherit it from `frontend/lib/deployment.json`.

The three demo releases illustrate an honest declared change, missing replay coverage, and an undeclared privileged capability/invariant failure. Their bonds are policy ledgers for this demonstration; they are not tokens or real funds. Validators may produce a different outcome if evidence delivery, model interpretation, or consensus differs. The scripts preserve and report the actual finalized outcome rather than relabeling it.

## Project map

- `contracts/ratchet.py` — GenLayer release state machine and validator evidence review.
- `replay/` — Solidity examples, deterministic EVM transaction corpus, schemas, and generator.
- `tests/direct/` — GenLayer direct-mode contract tests.
- `tests/replay/` — receipt, schema, hash, and public-mirror checks.
- `frontend/` — Next.js operator/reviewer interface and public evidence documents.
- `scripts/` — Studio Next deployment, evidence preparation, seeding, proof verification/recovery, and receipt-based fee profiling.
- `deploy/` and `artifacts/` — generated schemas, local receipts, and deployment/proof records.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md), [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md), [docs/PORTAL_SUBMISSION.md](docs/PORTAL_SUBMISSION.md), [docs/DECISIONS.md](docs/DECISIONS.md), and [docs/reproducibility.md](docs/reproducibility.md) before adapting or presenting the demo.

## Demo evidence boundary

The replay examples and their outputs are generated from local Hardhat EVM runs using a fixed corpus. They are synthetic, representative demonstrations, not exhaustive coverage, a security audit, a production incident, or a claim of complete correctness. The CI receipt says explicitly that no independent hosted CI run is claimed. Studio Next deployment or validator transactions are reported only when their finalized receipts exist in `deploy/` and `artifacts/`.
