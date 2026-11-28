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
// Usage: node tests/run_suite.js [draft2020-12|draft2019-09|draft7|draft6|draft4|v1]
// These answers compare the generated code with the interpreter: keep a small
// schema's first calls on the generated code (lib/codegen-engine.js SmallTwin).
process.env.ATA_NO_SMALL_TWIN = '1'

const { Validator } = require("../index");
const suite = require("./suite-loader");

const dialect = process.argv[2] || "draft2020-12";
if (!suite.DIALECTS[dialect]) {
  console.error(`unknown dialect "${dialect}" (expected one of: ${Object.keys(suite.DIALECTS).join(", ")})`);
  process.exit(2);
}
if (!suite.HAVE_SUITE) {
  console.error("tests/suite is not checked out (git submodule update --init tests/suite)");
  process.exit(2);
}

// Cases the suite exercises that ata does not get right yet. Listed explicitly
// so a new failure is a hard error while a known one does not turn the run red,
// and so fixing one shows up as a line to delete rather than a silent pass.
const KNOWN_FAILURES = {
  "draft2020-12": new Set([]),
  draft7: new Set([]),
  // The suite at e2a68a1 still asks v1 `date-time` to take RFC 9557 suffixes
  // ("...Z[Europe/London]"). The specification added them and then took them
  // out again (json-schema-org/json-schema-spec#1800, 2026-11-19), and the
  // pull request that removes these cases from the suite is open
  // (JSON-Schema-Test-Suite#1288). ata follows the specification.
  v1: new Set([
    "[format-assertion] format-date-time.json :: validation of date-time strings with RFC 9557 suffixes :: a valid date-time-ext with an elective time-zone suffix",
    "[format-assertion] format-date-time.json :: validation of date-time strings with RFC 9557 suffixes :: a valid date-time-ext with a numeric offset and a time-zone suffix",
    "[format-assertion] format-date-time.json :: validation of date-time strings with RFC 9557 suffixes :: a valid date-time-ext with a critical time-zone suffix",
    "[format-assertion] format-date-time.json :: validation of date-time strings with RFC 9557 suffixes :: a valid date-time-ext with a suffix-tag",
    "[format-assertion] format-date-time.json :: validation of date-time strings with RFC 9557 suffixes :: a valid date-time-ext with a numeric offset time-zone suffix",
    "[format-assertion] format-date-time.json :: validation of date-time strings with RFC 9557 suffixes :: a valid date-time-ext with a critical suffix-tag",
    "[format-assertion] format-date-time.json :: validation of date-time strings with RFC 9557 suffixes :: a valid date-time-ext with a time-zone suffix followed by suffix-tags",
    "[format-assertion] format-date-time.json :: validation of date-time strings with RFC 9557 suffixes :: a valid date-time-ext with a 14 character time-zone-part",
  ]),
  draft6: new Set([]),
  draft4: new Set([]),
  "draft2019-09": new Set([]),
};

// Cases one engine misses and another passes would hide behind a shared
// total. There are none at present; a new one is a regression, not an entry.
const ENGINE_SPECIFIC = new Set([]);

const known = KNOWN_FAILURES[dialect];

let pass = 0;
let knownFail = 0;
const regressions = [];
const fixed = [];

// One selection of the suite under one set of options. Each case gets a
// validator of its own with its own external documents.
function run(which, options, label) {
  let selPass = 0;
  let selTotal = 0;
  for (const { file, cases } of suite.files(dialect, { which })) {
    let filePass = 0;
    let fileBad = 0;

    for (const c of cases) {
      let validator = null;
      let compileError = null;
      try {
        validator = new Validator(c.schema, { ...options, schemas: suite.registry(c) });
      } catch (e) {
        compileError = e;
      }

      for (const test of c.tests) {
        const key = `${label}${file} :: ${c.description} :: ${test.description}`;
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

    selPass += filePass;
    selTotal += filePass + fileBad;
    const status = fileBad === 0 ? "PASS" : "FAIL";
    console.log(`  ${status}  ${(label + file).padEnd(36)} ${filePass}/${filePass + fileBad}`);
  }
  return [selPass, selTotal];
}

console.log(`\nJSON Schema Test Suite, ${dialect}\n`);

// The headline figure: every case that does not ask for format assertion,
// with format as an annotation and no instance mutation, as the suite expects
// and as the Bowtie harness configures ata.
const [reqPass, reqTotal] = run("required", { assertFormat: false, useDefaults: false }, "");

// The cases tagged format-assertion, with format asserted. Reported on their
// own line: up to 2020-12 the suite treats format assertion as optional.
console.log("");
const [fmtPass, fmtTotal] = run("assertion", { assertFormat: true, useDefaults: false }, "[format-assertion] ");

const total = pass + knownFail + regressions.length;
console.log("\n========================================");
console.log(`  ${reqPass} passed of ${reqTotal} (${((reqPass / reqTotal) * 100).toFixed(1)}%)`);
console.log(`  format assertion: ${fmtPass} passed of ${fmtTotal}`);
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
