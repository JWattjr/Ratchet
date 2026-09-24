# Implementation decisions

| Decision | Choice | Reason and boundary |
|---|---|---|
| GenLayer target | Studio Next, chain 61997 | Matches the requested runtime. Bradbury is not a target. |
| Runner | Full pinned `py-genlayer` hash in contract metadata | Reproducible GenVM runtime compatibility. |
| UI direction | Ratchet Calibration Bench | A light, friendly inspection workbench carries declaration-to-observation comparison while keeping severity and proof readable. |
| UI build path | Code-led | The brief explicitly selects disciplined code-led work; no comp is required. |
| State expiry | No automatic expiry | The target time model is not treated as a safe deterministic release deadline. Held bonds remain locked until the bounded allowed revision or a separately designed resolution. |
| Bond | Integer demonstration accounting units | The prototype must not imply custody or transfer of real funds. |
| Evidence storage | Public HTTPS URLs plus exact SHA-256 references | Reports remain inspectable without storing entire replay bundles on-chain. |
| Validator result | Strict normalized verdict and stable policy IDs | Consensus compares deterministic fields, not prose or model-selected remedies. |
| EVM execution | Local Hardhat replay only | The Intelligent Contract adjudicates evidence; it never executes the candidate implementation. |
| Error handling | Evidence retrieval failures produce HOLD; transient LLM-call failures and malformed LLM output fail validator comparison | Provider failures and malformed responses stay distinguishable using the pinned SDK's nondeterministic-response error cause. Neither is converted into an authoritative verdict. |
| Default screen state | Live contract reads only | An unconfigured or unreachable network remains visibly unavailable instead of using fixtures. |
| Integration proof | Read-only verification of finalized seeded Studio Next transactions | Consensus and execution evidence should be validated without additional production/demo writes. |
| Pinned runner compatibility | Use `gl.vm.run_nondet` supported by the exact pinned runner | The first Studio Next deployment used `run_nondet_unsafe`, which the deployed runner does not expose. That retired deployment is not part of the final proof. |
| LLM service failure during seeding | Keep failed attempts as receipts and leave the sealed release retryable | Two ADVANCE adjudication transactions on the prior contract returned `LLM_CALL_FAILED`; the release stayed SEALED. Receipts are retained under `deploy/receipts/`. Version 1.0.1 labels call failures as transient separately from malformed JSON. |
| Strict identifier mapping | Each normalized output list is restricted to its own frozen policy ID set | Two ROLLBACK attempts returned an unknown identifier in `violated_ids`; validators disagreed and no verdict was stored. Version 1.0.2 makes the list-to-ID mapping explicit in the prompt while the contract continues to reject unknown IDs. |
| Pause transfer declaration | Declare the recipient transfer suppressed by an active pause | The 1.0.2 ADVANCE receipt reached `MAJORITY_DISAGREE`: one leader treated the missing post-transfer `Withdrawn` event as an undeclared external-call change. The final declaration names this paused transfer path, and the replay report labels its completed-transfer receipt witness. |
| Proof transaction success | Require FINALIZED, FINISHED_WITH_RETURN, and `MAJORITY_AGREE` | A finalized transaction can still have `MAJORITY_DISAGREE` and leave the release SEALED. Seed and proof verification now check consensus result separately from lifecycle and GenVM execution. |
| Report-to-policy ID mapping | Copy explicit diff-row IDs first, then use fixed category mappings | Two 1.0.4 ROLLBACK adjudications produced the expected leader result but did not reach validator majority. Version 1.0.5 spells out how failed invariants and undeclared diff categories map to the frozen result IDs. |
| Consensus cross-check | Validators refetch pinned evidence and deterministically compare the leader result with structured hashes, coverage, invariants, declarations, and replay diffs | Repeated independent LLM classifications disagreed on exact normalized IDs. Version 1.0.6 keeps the leader LLM review and has validators independently verify its normalized result from the pinned structured artifacts. |

These decisions document the built system and its boundaries; they are not claims that the system is suitable for a production protocol.
