"""Read-only full-consensus checks for the three seeded Studio Next flows.

Run after deploy/seed-demo has finalized its transactions:
  npm run test:integration
These checks inspect real existing receipts and never submit transactions.
"""

import json
from pathlib import Path

from gltest import get_contract_factory, get_default_account, get_gl_client
from gltest.assertions import tx_execution_succeeded


ROOT = Path(__file__).resolve().parents[2]
DEPLOYMENT = json.loads((ROOT / "deploy" / "ratchet-deployment.json").read_text(encoding="utf-8"))
PROOF = json.loads((ROOT / "deploy" / "studio-next-proof.json").read_text(encoding="utf-8"))
ADDRESS = DEPLOYMENT["contract"]
EXPECTED = {
    "RATCHET-ADVANCE": ("ADVANCE", "ADVANCED"),
    "RATCHET-HOLD": ("HOLD", "HELD"),
    "RATCHET-ROLLBACK": ("ROLLBACK", "ROLLED_BACK"),
}


def as_record(value, label):
    if isinstance(value, str):
        value = json.loads(value)
    assert isinstance(value, dict), f"{label} must be an object"
    return value


def test_seeded_studio_next_contract_and_validator_consensus():
    assert DEPLOYMENT["network"] == "studioDevnet"
    assert DEPLOYMENT["chainId"] == 61997
    assert PROOF["network"] == "studioDevnet"
    assert PROOF["chain_id"] == 61997
    assert PROOF["contract"].lower() == ADDRESS.lower()
    assert len(PROOF["releases"]) == 3

    factory = get_contract_factory(contract_file_path=str(ROOT / "contracts" / "ratchet.py"))
    contract = factory.build_contract(contract_address=ADDRESS, account=get_default_account())
    assert contract.get_contract_version(args=[]).call() == "ratchet/1.0.9"
    client = get_gl_client()
    observed_ids = set()

    for proof_release in PROOF["releases"]:
        release_id = proof_release["release_id"]
        expected_verdict, expected_state = EXPECTED[release_id]
        observed_ids.add(release_id)
        release = as_record(contract.get_release(args=[release_id]).call(), "get_release")
        receipt = as_record(contract.get_receipt(args=[release_id]).call(), "get_receipt")
        assert release["state"] == expected_state
        assert receipt["verdict"] == expected_verdict
        assert proof_release["actual_verdict"] == expected_verdict
        assert receipt["declaration_hash"] == proof_release["declaration_hash"]
        assert receipt["replay_report_hash"] == proof_release["replay_report_hash"]
        assert receipt["ci_report_hash"] == proof_release["ci_report_hash"]
        assert release["state"] == proof_release["state"]

        bond = as_record(release["bond"], "bond")
        assert bond == proof_release["bond"]
        assert bond["amount"] == 90
        if expected_verdict == "ADVANCE":
            assert (bond["returned"], bond["locked"], bond["slashed"]) == (90, 0, 0)
        elif expected_verdict == "HOLD":
            assert (bond["returned"], bond["locked"], bond["slashed"]) == (0, 90, 0)
        else:
            assert (bond["returned"], bond["locked"], bond["slashed"]) == (45, 0, 45)

        adjudication = next(tx for tx in proof_release["transactions"] if tx["action"] == f"{release_id}-adjudicate")
        transaction = client.get_transaction(transaction_hash=adjudication["hash"])
        assert tx_execution_succeeded(transaction), f"{release_id} adjudication did not execute successfully"
        assert transaction.get("result_name") == "MAJORITY_AGREE", f"{release_id} did not reach majority agreement"
        consensus = transaction.get("consensus_data")
        assert isinstance(consensus, dict), f"{release_id} is missing consensus metadata"
        leader_receipts = consensus.get("leader_receipt")
        assert isinstance(leader_receipts, list) and any(
            isinstance(item, dict) and item.get("mode") == "leader" for item in leader_receipts
        ), f"{release_id} is missing the leader receipt"
        votes = consensus.get("votes")
        validators = consensus.get("validators")
        assert isinstance(votes, dict) and votes, f"{release_id} has no validator vote record"
        assert isinstance(validators, list) and validators, f"{release_id} has no validator set record"

    assert observed_ids == set(EXPECTED)
