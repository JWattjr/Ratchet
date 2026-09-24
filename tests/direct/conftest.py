import hashlib
import json
import re

import pytest

from windows_stdin_compat import install as install_windows_stdin_compat

install_windows_stdin_compat()

DECLARATION_IDS = [
    "DECL-SOURCE",
    "DECL-STORAGE",
    "DECL-PERMISSIONS",
    "DECL-EXTERNAL-CALLS",
    "DECL-CAPABILITIES",
    "DECL-MIGRATION",
    "DECL-ROLLBACK",
    "DECL-CORPUS",
]
INVARIANT_IDS = [
    "INV-BALANCE-CONSERVATION",
    "INV-NO-UNDECLARED-ADMIN",
    "INV-WITHDRAWAL-BOUND",
]
EVIDENCE_IDS = DECLARATION_IDS + ["COVERAGE-REQUIRED-CORPUS"]
CASE_IDS = ["CASE-A", "CASE-B"]

DEFAULT_REPORT = {
    "schema_version": "1",
    "run_id": "demo-run",
    "corpus": {"dataset_id": "ratchet-demo-corpus-v1", "transaction_count": 2},
    "coverage": {"required_case_ids": CASE_IDS, "executed_case_ids": CASE_IDS, "missing_case_ids": []},
    "invariants": [],
    "storage_diffs": [],
    "permission_diffs": [],
    "external_call_diffs": [],
    "capability_diffs": [],
    "transactions": [],
}
DEFAULT_CI = {"schema_version": "1", "status": "GENERATED_LOCALLY"}


def canonical(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False)


def sha(value):
    data = value.encode("utf-8") if isinstance(value, str) else value
    return hashlib.sha256(data).hexdigest()


def policy(retry_limit=1, bond_amount=90, rollback_slash_pct=50):
    return {
        "policy_version": "ratchet-policy/1",
        "declaration_ids": list(DECLARATION_IDS),
        "invariant_ids": list(INVARIANT_IDS),
        "evidence_ids": list(EVIDENCE_IDS),
        "required_case_ids": list(CASE_IDS),
        "retry_limit": retry_limit,
        "bond_amount": bond_amount,
        "advance_return_pct": 100,
        "rollback_slash_pct": rollback_slash_pct,
        "timeout_consequence": "LOCKED_NO_AUTO_EXPIRY",
    }


def envelope(release_id, rules=None, report=None, ci_report=None):
    rules = rules or policy()
    report = report if report is not None else DEFAULT_REPORT
    ci_report = ci_report if ci_report is not None else DEFAULT_CI
    return {
        "release_id": release_id,
        "current_implementation_hash": "1" * 64,
        "candidate_implementation_hash": "2" * 64,
        "source_provenance": {"repository": "https://example.org/source", "commit": "deadbeef"},
        "build_provenance": {"compiler": "solc-0.8.30", "build_hash": "3" * 64},
        "declared_storage_changes": [],
        "declared_permission_changes": [],
        "declared_external_call_changes": [],
        "declared_capabilities": [],
        "safety_invariants": INVARIANT_IDS,
        "migration_procedure": "Deploy after review; copy no user funds in this demonstration.",
        "rollback_procedure": "Keep the current implementation active.",
        "replay_dataset": {
            "dataset_id": "ratchet-demo-corpus-v1",
            "dataset_hash": "4" * 64,
            "required_case_ids": CASE_IDS,
            "replay_report_url": f"https://evidence.example/{release_id}/replay.json",
            "replay_report_hash": sha(canonical(report)),
            "ci_report_url": f"https://evidence.example/{release_id}/ci.json",
            "ci_report_hash": sha(canonical(ci_report)),
        },
        "policy_version": rules["policy_version"],
        "retry_limit": rules["retry_limit"],
        "bond": {
            "amount": rules["bond_amount"],
            "advance_return_pct": rules["advance_return_pct"],
            "rollback_slash_pct": rules["rollback_slash_pct"],
        },
    }


def create_release(contract, release_id="REL-1", rules=None, declaration=None, report=None, ci_report=None):
    rules = rules or policy()
    declaration = declaration or envelope(release_id, rules, report, ci_report)
    payload = canonical(declaration)
    declaration_hash = sha(payload)
    url = f"https://evidence.example/{release_id}/declaration.json"
    contract.create_release(release_id, payload, url, declaration_hash, canonical(rules))
    return {
        "declaration": declaration,
        "declaration_json": payload,
        "declaration_hash": declaration_hash,
        "declaration_url": url,
        "policy": rules,
    }


def mock_artifacts(direct_vm, release_id, stored, normalized, *, declaration_override=None, report_override=None, ci_override=None, statuses=None, llm=True):
    statuses = statuses or {}
    envelope_doc = declaration_override if declaration_override is not None else stored["declaration"]
    report_doc = report_override if report_override is not None else DEFAULT_REPORT
    ci_doc = ci_override if ci_override is not None else DEFAULT_CI
    docs = [
        (stored["declaration_url"], envelope_doc, stored["declaration_hash"], statuses.get("declaration", 200)),
        (stored["declaration"]["replay_dataset"]["replay_report_url"], report_doc, stored["declaration"]["replay_dataset"]["replay_report_hash"], statuses.get("replay", 200)),
        (stored["declaration"]["replay_dataset"]["ci_report_url"], ci_doc, stored["declaration"]["replay_dataset"]["ci_report_hash"], statuses.get("ci", 200)),
    ]
    for url, document, expected_hash, status in docs:
        body = canonical(document).encode("utf-8")
        direct_vm.mock_web(re.escape(url), {"status": status, "body": body})
    if llm:
        direct_vm.mock_llm(
            r".*independent protocol-release reviewer.*",
            json.dumps(normalized, separators=(",", ":")),
        )


@pytest.fixture
def deployed(direct_vm, direct_deploy, direct_alice):
    contract = direct_deploy("contracts/ratchet.py")
    direct_vm.sender = direct_alice
    return contract
