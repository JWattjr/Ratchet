# Portal submission package

## Product

**Ratchet**

**One-liner:** Ratchet is a GenLayer-native release governor that compares declared upgrade intent with reproducible differential replay, then advances, holds, or rejects the release through validator consensus.

## Problem

Protocol teams need more than a green CI status when reviewing an upgrade. They need to compare a frozen declaration envelope with observed storage, permission, capability, external-call, state, and invariant changes before a release is cleared.

## Why GenLayer

The relationship between natural-language release intent and replay evidence requires subjective interpretation. GenLayer validators independently retrieve the web evidence and reach consensus on a normalized verdict; the Intelligent Contract then applies the frozen deterministic state and demonstration-bond rules. CI supplies replay facts but is not trusted as the release authority.

## Live deployment values

- Application URL: [https://ratchet-genlayer.vercel.app](https://ratchet-genlayer.vercel.app)
- Production deployment: the stable application URL above is the production alias.
- Repository URL: [https://github.com/JWattjr/Ratchet](https://github.com/JWattjr/Ratchet).
- Stable Studionet chain: `61999`.
- Contract version: `ratchet/1.0.9`.
- Contract address: [`0x9e9e4bA8eC40D0661C66E37C3892831718Fc9b0F`](https://genlayer-explorer.vercel.app/address/0x9e9e4bA8eC40D0661C66E37C3892831718Fc9b0F).
- Deployment transaction: [finalized deployment](https://genlayer-explorer.vercel.app/tx/0x7e71a87c939b10bed7ad60d4bbd5fd9bf0d43a3fa30a1ab0257ba2ded167a63d).
- ADVANCE: [`RATCHET-ADVANCE` — `ADVANCED`, evidence complete, 90 demo units returned](https://genlayer-explorer.vercel.app/tx/0xd77a86951d6c6ccf25e7893adec86389b07638ea2723974b549e6500a85b958d).
- HOLD: [`RATCHET-HOLD` — `HELD`, evidence incomplete, 90 demo units remain locked](https://genlayer-explorer.vercel.app/tx/0x7b1b3eb6061b0a728f1a7e961da0ccdd06bd1e24886f31be338e3021eb7bb072).
- ROLLBACK: [`RATCHET-ROLLBACK` — `ROLLED_BACK`, undeclared capability/invariant failure, 45 units returned and 45 slashed](https://genlayer-explorer.vercel.app/tx/0x1688bdb3437e8e80f21ff747b84f48fee501e0ee54d563fc0b87653b6ca59ec5).
- Screenshots: [ADVANCE desktop](../artifacts/screenshots/ratchet-advance-desktop.png) · [ADVANCE mobile](../artifacts/screenshots/ratchet-advance-mobile.png) · [HOLD desktop](../artifacts/screenshots/ratchet-hold-desktop.png) · [HOLD mobile](../artifacts/screenshots/ratchet-hold-mobile.png) · [ROLLBACK desktop](../artifacts/screenshots/ratchet-rollback-desktop.png) · [ROLLBACK mobile](../artifacts/screenshots/ratchet-rollback-mobile.png).

The deployment and all nine release lifecycle writes have finalized receipts. Each receipt reports `FINISHED_WITH_RETURN` execution and `MAJORITY_AGREE` consensus. The outcomes are recorded separately from those transaction lifecycle and consensus fields.

## 60-second demo

Use [DEMO_SCRIPT.md](DEMO_SCRIPT.md). Open the honest declaration-to-replay trace, contrast the missing-case HOLD and undeclared-capability ROLLBACK, and finish at the finalized explorer receipt and rerun command.

## Reset instructions

After a Studionet reset, regenerate the replay, redeploy and seed the three proposals, then refresh all live proof records:

```powershell
$env:RATCHET_EVIDENCE_BASE_URL = "https://ratchet-genlayer.vercel.app"
npm run reset:demo
```

The script runs replay generation and verification, prepares evidence, deploys and seeds Ratchet, verifies the live receipts, and builds the frontend. Update the production deployment manifest and remove any stale Vercel `NEXT_PUBLIC_RATCHET_ADDRESS` override before redeploying with `vercel --prod`. Replace the transaction links in this package from `deploy/studionet-proof.json`. A Studionet reset invalidates the old contract and transaction links.

## Architecture and reproducibility

Read [ARCHITECTURE.md](ARCHITECTURE.md), [THREAT_MODEL.md](THREAT_MODEL.md), [reproducibility.md](reproducibility.md), [DEMO_SCRIPT.md](DEMO_SCRIPT.md), and [DECISIONS.md](DECISIONS.md). The local replay uses a fixed seven-case EVM corpus and pinned Solidity compiler. It is representative, not exhaustive.

## Test summary

Observed checks for the deployed `ratchet/1.0.9` source and current frontend:

- Validation gates: replay compilation and verification, GenVM lint/schema, 26 direct tests, 5 replay tests, frontend lint/typecheck/build, UI checks, and responsive checks passed. UI and responsive commands were rerun after the final mobile spacing and touch-target adjustments.
- `npm run test:integration`: passed against Studionet; checks live contract state, bond accounting, successful execution, and consensus metadata.
- `npm run test:live`: passed against the deployed contract and live evidence at 1440, 1280, 768, 390, and 375 px; it refreshed all six verdict screenshots.
- `npm run verify:proof`: verified 10 finalized Studionet transactions, all 3 live release receipts, and 9 hosted evidence hashes.

## Limitations

The replay is a local deterministic Hardhat EVM run over a fixed representative corpus; no independent hosted CI run is claimed. Ratchet does not execute candidate EVM bytecode, perform a production upgrade or rollback, prove generator correctness, provide an independent security audit, or manage real collateral. Demo bonds are accounting units. The committed replay suite is policy-defined, not exhaustive.

## Tags

GenLayer, Intelligent Contract, release governance, differential replay, declaration envelope, web evidence, natural-language policy, AI-validator consensus, subjective adjudication, deterministic authorization, Studionet.
