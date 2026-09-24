# 60-second demo script

This demo uses synthetic examples produced by the checked-in local EVM replay. It is not a production incident or independent security audit, and the seven transaction cases are representative rather than exhaustive.

1. **Open the bench (0–8 seconds).** Point out the live Studionet connection, chain ID `61999`, contract address, and release selector. If the address or RPC is unavailable, say so; do not switch to fixture state.
2. **Show the declared release (8–18 seconds).** Select `RATCHET-ADVANCE`. Read the current/candidate source hashes, the declared `paused` storage field and owner pause capability, policy version, corpus hash, and pinned evidence links.
3. **Follow the differential (18–30 seconds).** Show transaction receipts, storage-layout differences, runtime state changes, and invariant results. Explain that the local EVM replay generates the evidence and Ratchet does not run candidate bytecode.
4. **Show validator interpretation (30–40 seconds).** Open the finalized verdict and receipt. `ADVANCE` means the observed changes fit the declaration and required evidence passed; it does not mean an EVM proxy was upgraded.
5. **Contrast HOLD (40–49 seconds).** Select `RATCHET-HOLD`. `PAUSE-OFF` is missing, so the candidate is blocked and the demo bond remains locked. HOLD means insufficient evidence, not a confirmed vulnerability.
6. **Contrast ROLLBACK (49–57 seconds).** Select `RATCHET-ROLLBACK`. The replay exposes an undeclared privileged withdrawal and a failed invariant; the release path closes and the predeclared demonstration-bond rule applies. Ratchet does not execute an EVM rollback.
7. **Close (57–60 seconds).** Open the explorer link and the reproducibility instructions. State that validators independently retrieve hash-pinned web evidence and consensus owns the authoritative interpretation.

Before presenting, run `npm run verify:proof` with `RATCHET_NETWORK=studionet` and check that each link points to the currently deployed Studionet contract and current Vercel evidence origin. If the proof is absent or fails, present only the local replay and label it as such.
