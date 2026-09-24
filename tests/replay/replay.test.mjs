import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";

const root = resolve(import.meta.dirname, "../..");
const scenarioIds = ["honest-advance", "incomplete-replay", "undeclared-capability", "invariant-break"];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

async function json(relativePath) {
  const raw = await readFile(resolve(root, relativePath), "utf8");
  return { raw, value: JSON.parse(raw) };
}

function resolveRef(schema, ref, rootSchema) {
  if (!ref.startsWith("#/")) throw new Error(`Only local schema refs are supported: ${ref}`);
  return ref.slice(2).split("/").reduce((value, key) => value?.[key.replaceAll("~1", "/").replaceAll("~0", "~")], rootSchema);
}

function matchesType(value, type) {
  if (type === "null") return value === null;
  if (type === "array") return Array.isArray(value);
  if (type === "object") return value !== null && typeof value === "object" && !Array.isArray(value);
  if (type === "integer") return Number.isInteger(value);
  if (type === "number") return typeof value === "number" && Number.isFinite(value);
  return typeof value === type;
}

function validate(schema, value, rootSchema, path = "$", errors = []) {
  if (schema.$ref) {
    const referenced = resolveRef(rootSchema, schema.$ref, rootSchema);
    if (!referenced) errors.push(`${path}: unresolved $ref ${schema.$ref}`);
    else validate(referenced, value, rootSchema, path, errors);
    return errors;
  }
  if (schema.oneOf) {
    const validAlternatives = schema.oneOf.filter((choice) => validate(choice, value, rootSchema, path, []).length === 0);
    if (validAlternatives.length !== 1) errors.push(`${path}: expected exactly one schema alternative`);
  }
  if (schema.const !== undefined && !same(value, schema.const)) errors.push(`${path}: must equal ${JSON.stringify(schema.const)}`);
  if (schema.enum && !schema.enum.some((item) => same(value, item))) errors.push(`${path}: must match one of the allowed values`);
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!types.some((type) => matchesType(value, type))) {
      errors.push(`${path}: expected ${types.join(" or ")}`);
      return errors;
    }
  }
  if (typeof value === "string") {
    if (schema.minLength !== undefined && value.length < schema.minLength) errors.push(`${path}: shorter than minLength`);
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) errors.push(`${path}: does not match ${schema.pattern}`);
    if (schema.format === "date-time" && Number.isNaN(Date.parse(value))) errors.push(`${path}: invalid date-time`);
  }
  if (typeof value === "number" && schema.minimum !== undefined && value < schema.minimum) errors.push(`${path}: below minimum`);
  if (Array.isArray(value)) {
    if (schema.minItems !== undefined && value.length < schema.minItems) errors.push(`${path}: fewer than minItems`);
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${path}: more than maxItems`);
    if (schema.items) value.forEach((item, index) => validate(schema.items, item, rootSchema, `${path}[${index}]`, errors));
  }
  if (value !== null && typeof value === "object" && !Array.isArray(value)) {
    for (const key of schema.required ?? []) if (!(key in value)) errors.push(`${path}.${key}: required property is missing`);
    for (const [key, childSchema] of Object.entries(schema.properties ?? {})) {
      if (key in value) validate(childSchema, value[key], rootSchema, `${path}.${key}`, errors);
    }
  }
  return errors;
}

test("generated replay and CI artifacts satisfy their versioned JSON schemas and content hashes", async () => {
  const reportSchema = (await json("replay/schemas/report.schema.json")).value;
  const ciSchema = (await json("replay/schemas/ci-receipt.schema.json")).value;
  const corpus = await readFile(resolve(root, "replay/corpus/transactions.json"));
  const provenance = (await json("replay/generated/provenance.json")).value;
  assert.equal(hash(corpus), provenance.corpus_hash);

  for (const scenarioId of scenarioIds) {
    const reportFile = `replay/generated/${scenarioId}.json`;
    const ciFile = `replay/generated/${scenarioId}.ci.json`;
    const { raw: reportRaw, value: report } = await json(reportFile);
    const { value: ci } = await json(ciFile);
    assert.deepEqual(validate(reportSchema, report, reportSchema), [], `${reportFile} schema errors`);
    assert.deepEqual(validate(ciSchema, ci, ciSchema), [], `${ciFile} schema errors`);
    assert.equal(hash(reportRaw), ci.report_hash, `${scenarioId} report checksum`);
    assert.equal(report.corpus.dataset_hash, hash(corpus), `${scenarioId} corpus checksum`);
    assert.equal(report.corpus.dataset_hash, ci.corpus_hash, `${scenarioId} CI corpus checksum`);
    assert.equal(report.scenario_id, scenarioId);
    assert.equal(report.transactions.length, report.corpus.transaction_count);
    assert.deepEqual(report.coverage.executed_case_ids, report.transactions.map((item) => item.case_id).sort());
    assert.deepEqual(report.coverage.missing_case_ids, report.coverage.required_case_ids.filter((id) => !report.coverage.executed_case_ids.includes(id)));
    assert.deepEqual(ci.required_case_ids, report.coverage.required_case_ids);
    assert.deepEqual(ci.executed_case_ids, report.coverage.executed_case_ids);
    assert.deepEqual(ci.missing_case_ids, report.coverage.missing_case_ids);
    assert.equal(ci.independent_ci_run, null, "local evidence must not claim a hosted CI run");

    for (const transaction of report.transactions) {
      assert.equal(transaction.baseline.receipt.status === "SUCCESS", transaction.baseline.output.success);
      assert.equal(transaction.candidate.receipt.status === "SUCCESS", transaction.candidate.output.success);
      for (const side of [transaction.baseline, transaction.candidate]) {
        assert.match(side.receipt.transaction_hash, /^0x[0-9a-fA-F]{64}$/);
        assert.ok(BigInt(side.receipt.gas_used) > 0n, "each corpus entry must have a real EVM receipt");
      }
    }
    const html = await readFile(resolve(root, `replay/generated/${scenarioId}.html`), "utf8");
    assert.match(html, /Synthetic reviewer demonstration/);
    assert.match(html, /not an independent security audit/);
    assert.match(html, /Differential observations/);
    assert.match(html, /Recipient transfers/);
  }

  const first = (await json("replay/generated/honest-advance.json")).value;
  const badShape = { ...first, schema_version: "future" };
  assert.ok(validate(reportSchema, badShape, reportSchema).some((issue) => issue.includes("schema_version")), "schema validation rejects malformed output");
});

test("the honest calibration candidate adds only its declared pause slot and passes its replay invariants", async () => {
  const { value: report } = await json("replay/generated/honest-advance.json");
  assert.deepEqual(report.storage_diffs.map((item) => item.field), ["paused"]);
  assert.deepEqual(report.invariants.map((item) => item.status), ["PASS", "PASS", "PASS"]);
  assert.equal(report.permission_diffs.some((item) => item.capability === "OWNER_PAUSE_CONTROL" && item.changed), true);
  assert.equal(report.capability_diffs.some((item) => item.id === "CAP-PRIVILEGED-WITHDRAWAL"), false);
  assert.ok(report.state_diffs.some((item) => item.id === "STATE-BALANCE-ALICE"), "runtime state differences stay separate from layout changes");
  const transfers = report.external_call_diffs[0];
  assert.equal(transfers.changed, true);
  assert.ok(transfers.baseline.some((item) => item.case_id === "WITHDRAW-ALICE-10-AFTER-PAUSE" && item.operation === "withdraw_recipient_native_transfer" && item.outcome === "COMPLETED"));
  assert.equal(transfers.candidate.some((item) => item.case_id === "WITHDRAW-ALICE-10-AFTER-PAUSE"), false, "the declared pause suppresses the recipient transfer");
  const { value: declaration } = await json("frontend/public/evidence/declarations/RATCHET-ADVANCE.json");
  assert.ok(declaration.declared_external_call_changes.some((item) => item.operation === "withdraw_recipient_native_transfer" && item.case_ids.includes("WITHDRAW-ALICE-10-AFTER-PAUSE")));
});

test("the incomplete corpus identifies its missing required case", async () => {
  const { value: report } = await json("replay/generated/incomplete-replay.json");
  assert.deepEqual(report.coverage.missing_case_ids, ["PAUSE-OFF"]);
  assert.equal(report.transactions.some((item) => item.case_id === "PAUSE-OFF"), false);
});

test("the undeclared capability and invariant-break examples fail distinct checks", async () => {
  const { value: capability } = await json("replay/generated/undeclared-capability.json");
  assert.equal(capability.invariants.find((item) => item.id === "INV-NO-UNDECLARED-ADMIN").status, "FAIL");
  assert.equal(capability.capability_diffs.some((item) => item.id === "CAP-PRIVILEGED-WITHDRAWAL" && item.added), true);
  assert.equal(capability.storage_diffs.length, 0, "the unsafe capability adds no storage slot");

  const { value: broken } = await json("replay/generated/invariant-break.json");
  assert.equal(broken.invariants.find((item) => item.id === "INV-BALANCE-CONSERVATION").status, "FAIL");
  assert.equal(broken.capability_diffs.length, 0);
});

test("hosted copies, source snapshots, and local provenance are exact mirrors", async () => {
  for (const scenarioId of scenarioIds) {
    for (const extension of ["json", "html", "ci.json"]) {
      const generated = await readFile(resolve(root, `replay/generated/${scenarioId}.${extension}`));
      const published = await readFile(resolve(root, `frontend/public/evidence/${scenarioId}.${extension}`));
      assert.deepEqual(published, generated, `${scenarioId}.${extension} public mirror`);
    }
  }
  for (const name of ["VaultV1", "VaultV2Declared", "VaultV2Undeclared", "VaultV2InvariantBreak"]) {
    const source = await readFile(resolve(root, `replay/contracts/${name}.sol`));
    const published = await readFile(resolve(root, `frontend/public/replay/contracts/${name}.sol`));
    assert.deepEqual(published, source, `${name} source snapshot`);
  }
  const provenance = await readFile(resolve(root, "replay/generated/provenance.json"));
  const publishedProvenance = await readFile(resolve(root, "frontend/public/evidence/provenance.json"));
  assert.deepEqual(publishedProvenance, provenance);
});
