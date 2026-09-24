# Ratchet

Ratchet is a GenLayer release-governance application. It freezes a release declaration, has GenLayer validators compare that declaration with hash-pinned replay evidence, and records an `ADVANCE`, `HOLD`, or `ROLLBACK` decision on-chain. The application targets stable Studionet (chain `61999`). Earlier Studio Next (`61997`) deployments are retained as historical proof only. Ratchet does not execute EVM bytecode, move production assets, or perform a proxy upgrade or rollback.

The shipped surface is the Ratchet Calibration Bench: a friendly, precise review workbench for tracing a declaration through replay observations, validator consensus, and the resulting contract state.

## Requirements

- Node.js 22 or newer
- Python 3.12
- npm
- A Studionet connection for the public deployment; chain ID `61999`
- A Vercel account for the public demo and its validator-readable evidence URLs

## Local setup

```powershell
npm install
npm run setup:python
npm run check
```

`npm run check` builds and verifies the deterministic Hardhat replay, lints and generates the GenLayer contract schema, runs direct contract tests and replay artifact tests, then runs frontend lint, TypeScript checks, a production build, browser UI checks, and responsive screenshots/overflow checks.

The Python environment is pinned by `requirements.txt`; the contract's GenVM runner is pinned in its first-line metadata. Solidity compilation uses the pinned local `solc` package. Generated deployment keys are stored under `.keys/`, which is ignored by Git.

## Studionet demo deployment

The contract fetches its evidence from public HTTPS URLs. Publish the frontend and evidence before seeding a release:

1. Run `npm run replay:generate` and `npm run replay:verify`.
2. Deploy the frontend once to establish its stable public HTTPS origin.
3. Set `RATCHET_EVIDENCE_BASE_URL` to that origin and run `npm run prepare:demo` to make three canonical, hash-pinned declarations.
4. Deploy the frontend again so the declaration, replay, and CI evidence URLs return their final public bytes.
5. Set `$env:RATCHET_NETWORK = "studionet"`. Run `npm run deploy`, `npm run seed:demo`, `npm run test:integration`, and `npm run verify:proof`. The active scripts accept Studionet only and write its deployment and proof records to stable-specific paths.
6. Build and redeploy the frontend so it picks up the generated Studionet deployment manifest and verified proof snapshot. Remove the stale Vercel `NEXT_PUBLIC_RATCHET_ADDRESS` override, or update it to exactly match the verified Studionet address.
7. Run `npm run check` and `npm run test:live`. Before any external promotion, run the gate with the exact ADVANCE release ID and declaration hash:

   ```powershell
   $env:RATCHET_NETWORK = "studionet"
   $env:RELEASE_ID = "RATCHET-ADVANCE"
   $env:EXPECTED_DECLARATION_HASH = "<64-character SHA-256 from the verified proof>"
   npm run release:gate
   ```

   The gate verifies Ratchet’s finalized ADVANCE record; it does not perform an EVM upgrade. The same gate is available as a manual GitHub Actions workflow.

The three demo releases illustrate an honest declared change, missing replay coverage, and an undeclared privileged capability/invariant failure. Their bonds are policy ledgers for this demonstration; they are not tokens or real funds. Validators may produce a different outcome if evidence delivery, model interpretation, or consensus differs. The scripts preserve and report the actual finalized outcome rather than relabeling it.

## Project map

- `contracts/ratchet.py` — GenLayer release state machine and validator evidence review.
- `replay/` — Solidity examples, deterministic EVM transaction corpus, schemas, and generator.
- `tests/direct/` — GenLayer direct-mode contract tests.
- `tests/replay/` — receipt, schema, hash, and public-mirror checks.
- `frontend/` — Next.js operator/reviewer interface and public evidence documents.
- `scripts/` — Studionet deployment, evidence preparation, seeding, proof verification/recovery, and release gate.
- `deploy/` and `artifacts/` — generated schemas, local receipts, and deployment/proof records.

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md), [docs/THREAT_MODEL.md](docs/THREAT_MODEL.md), [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md), [docs/PORTAL_SUBMISSION.md](docs/PORTAL_SUBMISSION.md), [docs/DECISIONS.md](docs/DECISIONS.md), and [docs/reproducibility.md](docs/reproducibility.md) before adapting or presenting the demo.

## Demo evidence boundary

The replay examples and their outputs are generated from local Hardhat EVM runs using a fixed corpus. They are synthetic, representative demonstrations, not exhaustive coverage, a security audit, a production incident, or a claim of complete correctness. GitHub Actions regenerates and hash-checks the replay bundle and publishes a commit-bound artifact; this is reproducibility evidence, not an independent security audit. Chain transactions are reported only when finalized receipts exist in the network-specific files under `deploy/` and `artifacts/`.
