// Official JSON Schema Test Suite runner.
//
// This runner deliberately does not skip anything. Earlier versions curated a
// list of supported files and silently dropped any group whose schema failed to
// compile, which meant a schema ata could not handle was counted as absent
// rather than as a failure, and the reported pass rate did not describe the
// same thing bowtie.report measures. Every case in the dialect directory now
// runs, and a schema that fails to compile counts as errored.
//
// `format` and `default` are exercised under specification semantics
// (annotation, not assertion; no instance mutation), which is how the suite
// expects them to behave and how the Bowtie harness configures ata.
//
// Usage: node tests/run_suite.js [draft2020-12|draft7|v1]

const fs = require("fs");
const path = require("path");
const { Validator } = require("../index");

const DIALECTS = {
  "draft2020-12": "https://json-schema.org/draft/2020-12/schema",
  draft7: "http://json-schema.org/draft-07/schema#",
  v1: "https://json-schema.org/v1",
};

const dialect = process.argv[2] || "draft2020-12";
if (!DIALECTS[dialect]) {
  console.error(`unknown dialect "${dialect}" (expected one of: ${Object.keys(DIALECTS).join(", ")})`);
  process.exit(2);
}

const SUITE_DIR = path.join(__dirname, "suite/tests", dialect);
const REMOTES_DIR = path.join(__dirname, "suite/remotes");

// Cases the suite exercises that ata does not get right yet. Listed explicitly
// so a new failure is a hard error while a known one does not turn the run red,
// and so fixing one shows up as a line to delete rather than a silent pass.
const KNOWN_FAILURES = {
  "draft2020-12": new Set([]),
  draft7: new Set([
  ]),
  v1: new Set([]),
};

// Cases one engine misses and another passes would hide behind a shared
// total. There are none at present; a new one is a regression, not an entry.
const ENGINE_SPECIFIC = new Set([]);

// The suite serves its remote schemas from http://localhost:1234/<relative path>.
// Keying the registry by that URI is what lets a reference to the retrieval URI
// resolve even when the document declares a different $id.
const registry = {};
(function collect(dir, prefix) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full, prefix + entry.name + "/");
    else if (entry.name.endsWith(".json")) {
      try {
        registry["http://localhost:1234/" + prefix + entry.name] = JSON.parse(
          fs.readFileSync(full, "utf8"),
        );
      } catch {}
    }
  }
})(REMOTES_DIR, "");

// The suite states the dialect by directory rather than in every schema.
function withDialect(schema) {
  if (typeof schema !== "object" || schema === null || Array.isArray(schema)) return schema;
  return "$schema" in schema ? schema : { ...schema, $schema: DIALECTS[dialect] };
}

const options = { schemas: registry, assertFormat: false, useDefaults: false };
const known = KNOWN_FAILURES[dialect];

let pass = 0;
let knownFail = 0;
const regressions = [];
const fixed = [];

console.log(`\nJSON Schema Test Suite — ${dialect}\n`);

for (const file of fs.readdirSync(SUITE_DIR).filter((f) => f.endsWith(".json"))) {
  const groups = JSON.parse(fs.readFileSync(path.join(SUITE_DIR, file), "utf8"));
  let filePass = 0;
  let fileBad = 0;

  for (const group of groups) {
    let validator = null;
    let compileError = null;
    try {
      validator = new Validator(withDialect(group.schema), options);
    } catch (e) {
      compileError = e;
    }

    for (const test of group.tests) {
      const key = `${file} :: ${group.description} :: ${test.description}`;
      let ok = false;
      let detail = "";

      if (compileError) {
        detail = `schema failed to compile: ${compileError.message}`;
      } else {
        try {
          const got = validator.validate(test.data).valid;
          ok = got === test.valid;
          if (!ok) detail = `expected ${test.valid}, got ${got}`;
        } catch (e) {
          detail = `threw: ${e.message}`;
        }
      }

      if (ok) {
        filePass++;
        pass++;
        if (known.has(key)) fixed.push(key);
      } else {
        fileBad++;
        if (known.has(key) || ENGINE_SPECIFIC.has(key)) knownFail++;
        else regressions.push({ key, detail });
      }
    }
  }

  const status = fileBad === 0 ? "PASS" : "FAIL";
  console.log(`  ${status}  ${file.padEnd(30)} ${filePass}/${filePass + fileBad}`);
}

const total = pass + knownFail + regressions.length;
console.log("\n========================================");
console.log(`  ${pass} passed of ${total} (${((pass / total) * 100).toFixed(1)}%)`);
console.log(`  ${knownFail} known failures, ${regressions.length} regressions`);
console.log("========================================\n");

if (fixed.length > 0) {
  console.log("These cases now pass — remove them from KNOWN_FAILURES:");
  for (const key of fixed) console.log(`  ${key}`);
  console.log("");
}

if (regressions.length > 0) {
  console.log("Regressions:");
  for (const r of regressions) console.log(`  ${r.key}\n    ${r.detail}`);
  console.log("");
  process.exit(1);
}

if (fixed.length > 0) process.exit(1);
