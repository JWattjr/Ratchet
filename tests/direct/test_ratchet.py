import json
import re
from pathlib import Path

import pytest

from conftest import (
    CASE_IDS,
    DECLARATION_IDS,
    EVIDENCE_IDS,
    INVARIANT_IDS,
    canonical,
    create_release,
    envelope,
    mock_artifacts,
    policy,
    sha,
)


def valid_advance():
    return {
        "verdict": "ADVANCE",
        "evidence_status": "COMPLETE",
        "violated_ids": [],
        "undeclared_change_ids": [],
        "missing_evidence_ids": [],
    }


def test_version_create_owner_and_bounded_index_views(deployed, direct_vm, direct_alice):
    assert deployed.get_contract_version() == "ratchet/1.0.9"
    stored = create_release(deployed, "REL-1")
    release = deployed.get_release("REL-1")
    assert release["state"] == "DRAFT"
    assert release["declaration_hash"] == stored["declaration_hash"]
    expected_owner = "0x" + direct_alice.hex() if isinstance(direct_alice, bytes) else str(direct_alice)
    assert release["owner"].lower() == expected_owner.lower()
    assert deployed.get_release_ids(0, 10) == ["REL-1"]
    assert deployed.get_release_id_by_index(0) == "REL-1"
    assert deployed.get_stats()["draft"] == 1
    with direct_vm.expect_revert("RELEASE_INDEX_OUT_OF_RANGE"):
        deployed.get_release_id_by_index(1)
    with direct_vm.expect_revert("INVALID_RELEASE_LIMIT"):
        deployed.get_release_ids(0, 51)


@pytest.mark.parametrize(
    "release_id, report_file, ci_file, normalized",
    [
        ("RATCHET-ADVANCE", "honest-advance.json", "honest-advance.ci.json", valid_advance()),
        (
            "RATCHET-HOLD",
            "incomplete-replay.json",
            "incomplete-replay.ci.json",
            {"verdict": "HOLD", "evidence_status": "INCOMPLETE", "violated_ids": [], "undeclared_change_ids": [], "missing_evidence_ids": ["COVERAGE-REQUIRED-CORPUS"]},
        ),
        (
            "RATCHET-ROLLBACK",
            "undeclared-capability.json",
            "undeclared-capability.ci.json",
            {"verdict": "ROLLBACK", "evidence_status": "COMPLETE", "violated_ids": ["INV-NO-UNDECLARED-ADMIN"], "undeclared_change_ids": ["DECL-CAPABILITIES", "DECL-EXTERNAL-CALLS"], "missing_evidence_ids": []},
        ),
    ],
)
def test_structured_replay_evidence_deterministically_confirms_all_demo_verdicts(
    deployed, direct_vm, release_id, report_file, ci_file, normalized
):
    root = Path(__file__).resolve().parents[2]
    report = json.loads((root / "replay" / "generated" / report_file).read_text(encoding="utf-8"))
    ci_report = json.loads((root / "replay" / "generated" / ci_file).read_text(encoding="utf-8"))
    declaration = json.loads((root / "frontend" / "public" / "evidence" / "declarations" / f"{release_id}.json").read_text(encoding="utf-8"))
    rules = json.loads((root / "deploy" / "demo-artifacts.json").read_text(encoding="utf-8"))["policy"]
    stored = create_release(deployed, release_id, rules, declaration, report, ci_report)
    deployed.seal_release(release_id)
    mock_artifacts(direct_vm, release_id, stored, normalized, report_override=report, ci_override=ci_report)
    direct_vm.mock_llm(r".*change-declaration auditor.*", json.dumps({"uncovered_claim_ids": []}))
    assert deployed.adjudicate(release_id) == normalized


def test_vague_declared_explanation_rolls_back(deployed, direct_vm):
    root = Path(__file__).resolve().parents[2]
    report = json.loads((root / "replay" / "generated" / "honest-advance.json").read_text(encoding="utf-8"))
    ci_report = json.loads((root / "replay" / "generated" / "honest-advance.ci.json").read_text(encoding="utf-8"))
    declaration = json.loads((root / "frontend" / "public" / "evidence" / "declarations" / "RATCHET-ADVANCE.json").read_text(encoding="utf-8"))
    rules = json.loads((root / "deploy" / "demo-artifacts.json").read_text(encoding="utf-8"))["policy"]
    stored = create_release(deployed, "RATCHET-ADVANCE", rules, declaration, report, ci_report)
    deployed.seal_release("RATCHET-ADVANCE")
    expected = {"verdict": "ROLLBACK", "evidence_status": "COMPLETE", "violated_ids": [], "undeclared_change_ids": ["DECL-EXTERNAL-CALLS"], "missing_evidence_ids": []}
    mock_artifacts(direct_vm, "RATCHET-ADVANCE", stored, expected, report_override=report, ci_override=ci_report)
    direct_vm.mock_llm(
        r".*change-declaration auditor.*",
        json.dumps({"uncovered_claim_ids": ["WITHDRAW-ALICE-10-AFTER-PAUSE:withdraw_recipient_native_transfer"]}),
    )
    assert deployed.adjudicate("RATCHET-ADVANCE") == expected


def test_release_creation_rejects_bad_urls_hashes_and_unknown_policy_ids(deployed, direct_vm):
    rules = policy()
    env = envelope("BAD-URL", rules)
    payload = canonical(env)
    with direct_vm.expect_revert("INVALID_DECLARATION_ARTIFACT_REFERENCE"):
        deployed.create_release("BAD-URL", payload, "http://evidence.example/declaration.json", sha(payload), canonical(rules))
    with direct_vm.expect_revert("DECLARATION_HASH_MISMATCH"):
        deployed.create_release("BAD-HASH", payload.replace("BAD-URL", "BAD-HASH"), "https://evidence.example/declaration.json", "0" * 64, canonical(rules))
    bad_policy = policy()
    bad_policy["invariant_ids"][-1] = "INV-UNKNOWN"
    with direct_vm.expect_revert("INVALID_INVARIANT_POLICY_IDS"):
        deployed.create_release("BAD-POLICY", payload, "https://evidence.example/declaration.json", sha(payload), canonical(bad_policy))


def test_only_release_owner_can_edit_and_draft_edit_is_supported(deployed, direct_vm, direct_alice, direct_bob):
    original = create_release(deployed, "REL-EDIT")
    updated = envelope("REL-EDIT")
    updated["candidate_implementation_hash"] = "a" * 64
    updated_json = canonical(updated)
    updated_hash = sha(updated_json)
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("ONLY_RELEASE_OWNER"):
        deployed.update_draft("REL-EDIT", updated_json, original["declaration_url"], updated_hash, canonical(policy()))
    direct_vm.sender = direct_alice
    deployed.update_draft("REL-EDIT", updated_json, original["declaration_url"], updated_hash, canonical(policy()))
    assert deployed.get_release("REL-EDIT")["declaration_hash"] == updated_hash


def test_seal_freezes_declaration_and_cancel_is_preseal_only(deployed, direct_vm):
    create_release(deployed, "REL-SEAL")
    with direct_vm.expect_revert("ADJUDICATION_REQUIRES_SEALED_EVIDENCE_ATTEMPT"):
        deployed.adjudicate("REL-SEAL")
    deployed.seal_release("REL-SEAL")
    with direct_vm.expect_revert("DRAFT_IS_IMMUTABLE_AFTER_SEAL"):
        deployed.update_draft("REL-SEAL", "{}", "https://evidence.example/d.json", "1" * 64, canonical(policy()))
    with direct_vm.expect_revert("ONLY_DRAFT_CAN_BE_CANCELLED"):
        deployed.cancel_draft("REL-SEAL")
    assert deployed.get_release("REL-SEAL")["attempt_count"] == 1


def test_draft_can_be_cancelled_and_bond_released(deployed):
    create_release(deployed, "REL-CANCEL")
    deployed.cancel_draft("REL-CANCEL")
    release = deployed.get_release("REL-CANCEL")
    assert release["state"] == "CANCELLED"
    assert json.loads(release["bond"])["locked"] == 0


@pytest.mark.parametrize(
    "normalized, message",
    [
        ({"verdict": "UNKNOWN", "evidence_status": "COMPLETE", "violated_ids": [], "undeclared_change_ids": [], "missing_evidence_ids": []}, "UNKNOWN_VERDICT"),
        ({"verdict": "ADVANCE", "evidence_status": "UNKNOWN", "violated_ids": [], "undeclared_change_ids": [], "missing_evidence_ids": []}, "UNKNOWN_EVIDENCE_STATUS"),
        ({"verdict": "ADVANCE", "evidence_status": "COMPLETE", "violated_ids": ["INV-NOPE"], "undeclared_change_ids": [], "missing_evidence_ids": []}, "INVALID_IDENTIFIER"),
        ({"verdict": "ADVANCE", "evidence_status": "COMPLETE", "violated_ids": ["INV-BALANCE-CONSERVATION"], "undeclared_change_ids": [], "missing_evidence_ids": []}, "INVALID_ADVANCE_SHAPE"),
        ({"verdict": "HOLD", "evidence_status": "COMPLETE", "violated_ids": [], "undeclared_change_ids": [], "missing_evidence_ids": []}, "INVALID_HOLD_SHAPE"),
        ({"verdict": "HOLD", "evidence_status": "INCOMPLETE", "violated_ids": ["INV-NO-UNDECLARED-ADMIN"], "undeclared_change_ids": [], "missing_evidence_ids": ["DECL-CORPUS"]}, "INVALID_HOLD_SHAPE"),
        ({"verdict": "HOLD", "evidence_status": "INCOMPLETE", "violated_ids": [], "undeclared_change_ids": [], "missing_evidence_ids": []}, "INCOMPLETE_HOLD_REQUIRES_MISSING_EVIDENCE_ID"),
        ({"verdict": "ROLLBACK", "evidence_status": "COMPLETE", "violated_ids": [], "undeclared_change_ids": [], "missing_evidence_ids": []}, "INVALID_ROLLBACK_SHAPE"),
        ({"verdict": "ADVANCE", "evidence_status": "COMPLETE", "violated_ids": [], "undeclared_change_ids": [], "missing_evidence_ids": ["UNLISTED"]}, "INVALID_IDENTIFIER"),
    ],
)
def test_malformed_llm_shapes_never_become_a_verdict(deployed, direct_vm, normalized, message):
    stored = create_release(deployed, "REL-BAD-LLM")
    deployed.seal_release("REL-BAD-LLM")
    mock_artifacts(direct_vm, "REL-BAD-LLM", stored, normalized)
    with direct_vm.expect_revert(message):
        deployed.adjudicate("REL-BAD-LLM")


def test_malformed_llm_json_is_classified_and_does_not_settle(deployed, direct_vm):
    stored = create_release(deployed, "REL-LLM-JSON")
    deployed.seal_release("REL-LLM-JSON")
    mock_artifacts(direct_vm, "REL-LLM-JSON", stored, valid_advance(), llm=False)
    direct_vm.mock_llm(r".*independent protocol-release reviewer.*", "not-json")
    with direct_vm.expect_revert("MALFORMED_LLM"):
        deployed.adjudicate("REL-LLM-JSON")
    assert deployed.get_release("REL-LLM-JSON")["state"] == "SEALED"


def test_advance_is_terminal_and_returns_bond_deterministically(deployed, direct_vm):
    stored = create_release(deployed, "REL-ADVANCE")
    deployed.seal_release("REL-ADVANCE")
    mock_artifacts(direct_vm, "REL-ADVANCE", stored, valid_advance())
    result = deployed.adjudicate("REL-ADVANCE")
    assert result == valid_advance()
    release = deployed.get_release("REL-ADVANCE")
    assert release["state"] == "ADVANCED"
    assert json.loads(release["bond"]) == {"amount": 90, "returned": 90, "locked": 0, "slashed": 0, "state": "RETURNED"}
    assert deployed.get_verdict("REL-ADVANCE") == valid_advance()
    assert deployed.get_receipt("REL-ADVANCE")["verdict"] == "ADVANCE"
    with direct_vm.expect_revert("TERMINAL_RELEASE_CANNOT_BE_READJUDICATED"):
        deployed.adjudicate("REL-ADVANCE")


def test_hold_locks_bond_and_revision_preserves_previous_attempt(deployed, direct_vm, direct_alice, direct_bob):
    stored = create_release(deployed, "REL-HOLD")
    deployed.seal_release("REL-HOLD")
    hold = {
        "verdict": "HOLD",
        "evidence_status": "INCOMPLETE",
        "violated_ids": [],
        "undeclared_change_ids": [],
        "missing_evidence_ids": ["COVERAGE-REQUIRED-CORPUS"],
    }
    mock_artifacts(direct_vm, "REL-HOLD", stored, hold)
    deployed.adjudicate("REL-HOLD")
    first = deployed.get_release_attempt("REL-HOLD", 0)
    assert first["replay_report_hash"] == stored["declaration"]["replay_dataset"]["replay_report_hash"]
    assert deployed.get_release("REL-HOLD")["state"] == "HELD"
    assert json.loads(deployed.get_release("REL-HOLD")["bond"])["locked"] == 90
    direct_vm.sender = direct_bob
    with direct_vm.expect_revert("ONLY_RELEASE_OWNER"):
        deployed.submit_evidence_revision("REL-HOLD", "https://evidence.example/new.json", "7" * 64, "https://evidence.example/new-ci.json", "8" * 64)
    direct_vm.sender = direct_alice
    deployed.submit_evidence_revision("REL-HOLD", "https://evidence.example/new.json", "7" * 64, "https://evidence.example/new-ci.json", "8" * 64)
    assert deployed.get_release("REL-HOLD")["state"] == "SEALED"
    assert deployed.get_release("REL-HOLD")["attempt_count"] == 2
    assert deployed.get_release_attempt("REL-HOLD", 0)["replay_report_hash"] == first["replay_report_hash"]
    assert deployed.get_release_attempt("REL-HOLD", 1)["replay_report_hash"] == "7" * 64
    # A revision is retry budget, so the new sealed attempt must be adjudicated
    # before the contract can enforce the exhausted retry limit in HELD state.
    revision_report = {"schema_version": "1", "revision": 1}
    revision_ci = {"schema_version": "1", "status": "GENERATED_LOCALLY"}
    revision_report_url = "https://evidence.example/new.json"
    revision_ci_url = "https://evidence.example/new-ci.json"
    direct_vm.clear_mocks()
    for url, document in (
        (stored["declaration_url"], stored["declaration"]),
        (revision_report_url, revision_report),
        (revision_ci_url, revision_ci),
    ):
        direct_vm.mock_web(re.escape(url), {"status": 200, "body": canonical(document).encode("utf-8")})
    direct_vm.mock_llm(r".*independent protocol-release reviewer.*", hold)
    deployed.adjudicate("REL-HOLD")
    assert deployed.get_release("REL-HOLD")["state"] == "HELD"
    with direct_vm.expect_revert("EVIDENCE_REVISION_LIMIT_REACHED"):
        deployed.submit_evidence_revision("REL-HOLD", "https://evidence.example/third.json", "9" * 64, "https://evidence.example/third-ci.json", "a" * 64)


def test_rollback_requires_material_reason_and_applies_fixed_slash(deployed, direct_vm):
    rules = policy(bond_amount=100, rollback_slash_pct=35)
    stored = create_release(deployed, "REL-ROLLBACK", rules)
    deployed.seal_release("REL-ROLLBACK")
    result = {
        "verdict": "ROLLBACK",
        "evidence_status": "COMPLETE",
        "violated_ids": ["INV-NO-UNDECLARED-ADMIN"],
        "undeclared_change_ids": ["DECL-CAPABILITIES"],
        "missing_evidence_ids": [],
    }
    mock_artifacts(direct_vm, "REL-ROLLBACK", stored, result)
    deployed.adjudicate("REL-ROLLBACK")
    release = deployed.get_release("REL-ROLLBACK")
    assert release["state"] == "ROLLED_BACK"
    assert json.loads(release["bond"]) == {"amount": 100, "returned": 65, "locked": 0, "slashed": 35, "state": "PARTIAL"}


@pytest.mark.parametrize("status, error_class", [(404, "EXTERNAL_4XX"), (503, "TRANSIENT_5XX")])
def test_http_failures_are_classified_as_hold_not_false_advance(deployed, direct_vm, status, error_class):
    stored = create_release(deployed, f"REL-HTTP-{status}")
    deployed.seal_release(f"REL-HTTP-{status}")
    mock_artifacts(direct_vm, f"REL-HTTP-{status}", stored, valid_advance(), statuses={"replay": status})
    result = deployed.adjudicate(f"REL-HTTP-{status}")
    assert result["verdict"] == "HOLD"
    assert result["evidence_status"] == "INCOMPLETE"
    assert deployed.get_release_attempt(f"REL-HTTP-{status}", 0)["error_class"] == error_class


def test_malformed_report_and_contradictory_declaration_hold(deployed, direct_vm):
    malformed_report = ["not-an-object"]
    stored = create_release(deployed, "REL-MALFORMED", report=malformed_report)
    deployed.seal_release("REL-MALFORMED")
    mock_artifacts(direct_vm, "REL-MALFORMED", stored, valid_advance(), report_override=malformed_report)
    result = deployed.adjudicate("REL-MALFORMED")
    assert result["verdict"] == "HOLD"
    assert result["missing_evidence_ids"] == ["DECL-CORPUS"]

    stored2 = create_release(deployed, "REL-CONTRADICT")
    deployed.seal_release("REL-CONTRADICT")
    different = envelope("REL-CONTRADICT")
    different["candidate_implementation_hash"] = "b" * 64
    mock_artifacts(direct_vm, "REL-CONTRADICT", stored2, valid_advance(), declaration_override=different)
    result2 = deployed.adjudicate("REL-CONTRADICT")
    assert result2["verdict"] == "HOLD"
    assert result2["evidence_status"] == "CONTRADICTORY"


def test_history_is_bounded_append_only_and_stats_remain_consistent(deployed):
    create_release(deployed, "REL-HISTORY")
    deployed.seal_release("REL-HISTORY")
    history = deployed.get_release_history("REL-HISTORY", 0, 10)
    assert [item["event"] for item in history] == ["DRAFT_CREATED", "DECLARATION_SEALED"]
    assert deployed.get_stats()["sealed"] == 1
    with pytest.raises(Exception):
        deployed.get_release_history("REL-HISTORY", 0, 51)
