# Threat model

## Assets and security goals

- Correctly identify the exact release declaration, source/build identifiers, replay corpus, and evidence bytes considered by an adjudication.
- Preserve an audit trail for proposal creation, sealing, evidence revisions, consensus outcomes, and bond bookkeeping.
- Prevent malformed input, excessive evidence, identifier confusion, owner spoofing, duplicate actions, and unbounded history/evidence processing from corrupting contract state.
- Show reviewers the actual configured network, finalized contract state, and receipt without presenting fixtures as live data.

## Adversaries and failure modes

- A release author may omit an expected change or attach a report that hides a capability or invariant failure.
- An evidence host may be offline, rate limited, compromised, or serve bytes that differ from the committed hash.
- A malformed, oversized, stale, or schema-incompatible report may arrive.
- LLM output may be malformed, inconsistent, or semantically wrong despite valid structure.
- A release owner may submit a misleading but well-formed declaration or try to hide an upgrade capability behind a familiar label.
- A leader may selectively interpret evidence; validators may disagree or a quorum may fail to form.
- Repeated adjudication, unauthorized evidence revisions, or a fake frontend success state may mislead users if the contract/client boundary is not checked.
- RPC providers, wallet state, or clients may be stale or report a transaction before finality.
- A network reset may remove a deployment or seeded records while stale local proof files remain.
- A reviewer may infer that an `ADVANCE` is a real proxy upgrade or that the demo bond represents token collateral.

## Controls

- The contract bounds release IDs, JSON sizes, URLs, lists, attempts, history pagination, and evidence bytes; validates stable identifier sets, fixed policy versions, declaration hashes, and full invariant declarations; and authorizes state writes to release owners.
- Reports pin their baseline/candidate source and bytecode hashes, and the validator prompt evaluates the claimed provenance, coverage, observed capabilities, permissions, external calls, and invariant results against the sealed declaration. A matching digest alone does not establish that a report is truthful.
- Every fetched document is HTTPS-only, bounded, SHA-256 pinned, UTF-8 JSON, and object-shaped. Content digest failure is contradictory evidence. Transient/inaccessible evidence is held rather than advanced.
- The leader and validator independently retrieve and assess the same evidence. Only a strictly shaped, normalized result using policy-defined IDs can reach the deterministic state machine.
- The custom comparative validator requires matching normalized results across leader and validator review. Malformed output or disagreement fails validation and cannot be stored as an authoritative verdict.
- `ADVANCE`, `HOLD`, and `ROLLBACK` consequences are fixed by the stored policy. Retry count and terminal states are contract-enforced.
- On-chain release and receipt reads are the UI authority. `verify:proof` compares saved artifacts to live transaction execution, contract state, and pinned hosted bytes after deployment resets.
- Wallet writes assert the configured network's chain ID, quote current fee policy, reject a quote mismatch, and wait for finalized status. Deployment keys never enter frontend source, are ignored locally, and are not printed.
- Public evidence and proof files distinguish local execution receipts from network-specific transaction receipts. Reports disclose representative coverage. Hosted CI regenerates and hash-checks the replay artifacts, but does not claim an independent security audit.
- A network-scoped release gate verifies a requested Studionet declaration hash against the live release and finalized `ADVANCE` receipt; a caller must still connect that authorization to its own promotion system.

## Residual risks

- A validator consensus result can share a correlated model failure; schema validation constrains shape, not truth.
- A report can be consistently wrong if the replay harness, corpus, compiler, or invariant checker is compromised. The report does not prove source correspondence beyond its own provenance and hash fields.
- An attacker with release-owner control can choose a misleading declaration; the system makes the sealed claim visible and compares evidence against it but does not authenticate an organization or prove source ownership.
- Leader manipulation may still expose correlated interpretation weaknesses; consensus agreement is an adjudication result, not an objective proof of semantic truth.
- Network resets can invalidate deployed addresses and old proofs; records must be regenerated and reverified before an app advertises the deployment as current.
- Coverage is limited to named corpus transactions and stated invariants; it is not a formal proof, audit, or exhaustive test.
- HTTPS and SHA-256 provide transport identity and content integrity relative to the committed digest, not long-term host availability.
- The demo contract has no real collateral, dispute appeal, timeout unlock, or EVM upgrade integration. A HOLD locks the demo ledger bond until an allowed revision or separate administrative design is made.
- Production adoption would require protocol-specific threat analysis, independent security review, reproducible build attestations, deployment ownership procedures, and tested monitoring and recovery plans.

## Out of scope

This prototype cannot execute candidate Solidity, pause a production chain, block an external upgrade, custody user funds, guarantee a semantic LLM judgment, or automatically roll back a deployment.
