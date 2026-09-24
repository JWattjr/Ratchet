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
- Production deployment: [READY deployment](https://ratchet-genlayer-hftg5cifw-wattxs-projects.vercel.app) (`dpl_ARdGzHta9sMYaPtmMmN2WoLC5ZVa`); the stable application URL above is the production alias.
- Repository URL: [https://github.com/JWattjr/Ratchet](https://github.com/JWattjr/Ratchet).
- Studio Next chain: `61997`.
- Contract version: `ratchet/1.0.9`.
- Contract address: [`0xB8d709F996B06C1a3990C7D8b6A3A1b520a9Fd20`](https://explorer-studio-dev.genlayer.com/address/0xB8d709F996B06C1a3990C7D8b6A3A1b520a9Fd20).
- Deployment transaction: [finalized deployment](https://explorer-studio-dev.genlayer.com/tx/0xd1de61450feba7ce62c6a2823240dbd241d137e3e6c9bdaf3912b967796f7368).
- ADVANCE: [`RATCHET-ADVANCE` — `ADVANCED`, evidence complete, 90 demo units returned](https://explorer-studio-dev.genlayer.com/tx/0xe3b866b97f709de677a353707a06f110feeab85828771fe5109c066f663439ba).
- HOLD: [`RATCHET-HOLD` — `HELD`, evidence incomplete, 90 demo units remain locked](https://explorer-studio-dev.genlayer.com/tx/0x6d286b502cc451343b8fa87943c7182910d6c74e64350ec521d1a2a7b04b7c73).
- ROLLBACK: [`RATCHET-ROLLBACK` — `ROLLED_BACK`, undeclared capability/invariant failure, 45 units returned and 45 slashed](https://explorer-studio-dev.genlayer.com/tx/0x465dda94d11e36f1e6b70dcd6facee80c68ebf342bcc4a578f97a9a64804ce4c).
- [Desktop screenshot](../artifacts/screenshots/desktop.png) · [Mobile screenshot](../artifacts/screenshots/mobile.png).

The deployment and all nine release lifecycle writes have finalized receipts. Each receipt reports `FINISHED_WITH_RETURN` execution and `MAJORITY_AGREE` consensus. The outcomes are recorded separately from those transaction lifecycle and consensus fields.

## 60-second demo

Use [DEMO_SCRIPT.md](DEMO_SCRIPT.md). Open the honest declaration-to-replay trace, contrast the missing-case HOLD and undeclared-capability ROLLBACK, and finish at the finalized explorer receipt and rerun command.

## Reset instructions

After a Studio Next reset, regenerate the replay, redeploy and seed the three proposals, then refresh all live proof records:

```powershell
$env:RATCHET_EVIDENCE_BASE_URL = "https://ratchet-genlayer.vercel.app"
npm run reset:demo
```

The script runs replay generation and verification, prepares evidence, deploys and seeds Ratchet, verifies the live receipts, profiles fees, and builds the frontend. Update the Vercel production `NEXT_PUBLIC_RATCHET_ADDRESS` to the new contract in `frontend/lib/deployment.json`, redeploy with `vercel --prod`, and replace the transaction links in this package from the new `deploy/studio-next-proof.json`. A Studio Next reset invalidates the old contract and transaction links.

## Architecture and reproducibility

Read [ARCHITECTURE.md](ARCHITECTURE.md), [THREAT_MODEL.md](THREAT_MODEL.md), [reproducibility.md](reproducibility.md), [DEMO_SCRIPT.md](DEMO_SCRIPT.md), and [DECISIONS.md](DECISIONS.md). The local replay uses a fixed seven-case EVM corpus and pinned Solidity compiler. It is representative, not exhaustive.

## Test summary

Observed checks for the deployed `ratchet/1.0.9` source and current frontend:

- `npm run check`: replay compilation and verification, GenVM lint/schema, direct and replay tests, frontend lint/typecheck/build, browser UI checks, and responsive checks passed.
- `npm run test:integration`: passed against Studio Next; checks live contract state, bond accounting, successful execution, and consensus metadata.
- `npm run test:responsive`: passed at 1440, 1280, 768, and 390 px; desktop and mobile captures show the live selected release.
- `npm run verify:proof`: verified 10 finalized Studio Next transactions, all 3 live release receipts, and 9 hosted evidence hashes.
- `npm run profile:fees`: generated the fee profile from the three finalized adjudication receipts.

## Limitations

The replay is a local deterministic Hardhat EVM run over a fixed representative corpus; no independent hosted CI run is claimed. Ratchet does not execute candidate EVM bytecode, perform a production upgrade or rollback, prove generator correctness, provide an independent security audit, or manage real collateral. Demo bonds are accounting units. The committed replay suite is policy-defined, not exhaustive.

## Tags

GenLayer, Intelligent Contract, release governance, differential replay, declaration envelope, web evidence, natural-language policy, AI-validator consensus, subjective adjudication, deterministic authorization, Studio Next.
