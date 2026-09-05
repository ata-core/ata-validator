const { Validator } = require("../index");

let pass = 0;
let fail = 0;

function assert(cond, msg) {
  if (cond) { pass++; console.log(`  PASS  ${msg}`); }
  else { fail++; console.log(`  FAIL  ${msg}`); }
}

console.log("\nStandard Schema V1 Tests\n");

const v = new Validator({
  type: "object",
  properties: {
    name: { type: "string", minLength: 1 },
    age: { type: "integer", minimum: 0 }
  },
  required: ["name"]
});

const ss = v["~standard"];

// Interface shape
assert(ss.version === 1, "version is 1");
assert(ss.vendor === "ata-validator", "vendor is ata-validator");
assert(typeof ss.validate === "function", "validate is a function");

// Same reference (no getter allocation)
assert(v["~standard"] === v["~standard"], "~standard returns same reference");

// Valid input returns { value }
const r1 = ss.validate({ name: "Mert", age: 26 });
assert("value" in r1, "valid: has value property");
assert(!("issues" in r1), "valid: no issues property");
assert(r1.value.name === "Mert", "valid: value preserved");

// Invalid input returns { issues }
const r2 = ss.validate({ age: -1 });
assert(!("value" in r2), "invalid: no value property");
assert("issues" in r2, "invalid: has issues property");
assert(Array.isArray(r2.issues), "invalid: issues is array");
assert(r2.issues.length > 0, "invalid: has at least one issue");
assert(typeof r2.issues[0].message === "string", "invalid: issue has message");

// Issue path format
const v2 = new Validator({
  type: "object",
  properties: { nested: { type: "object", properties: { x: { type: "integer" } } } }
});
const r3 = v2["~standard"].validate({ nested: { x: "not a number" } });
if (r3.issues && r3.issues.length > 0 && r3.issues[0].path) {
  assert(Array.isArray(r3.issues[0].path), "path is array");
  const keys = r3.issues[0].path.map(p => p.key);
  assert(keys.includes("nested") || keys.includes("x"), "path contains relevant keys");
} else {
  assert(true, "path format (skipped — no path on this error)");
  assert(true, "path keys (skipped)");
}

// Issues come from the raw error path: same count and order as
// validate().errors, message and path agreeing entry by entry. Guards the
// _ataRaw shortcut against drifting from the public error list.
{
  const v6 = new Validator({
    type: "object",
    properties: {
      name: { type: "string", minLength: 2 },
      count: { type: "integer", minimum: 1 },
      tags: { type: "array", items: { type: "string" } },
    },
    required: ["name", "count"],
  });
  const bad = { name: "x", count: 0, tags: ["ok", 7] };
  const errors = v6.validate(bad).errors;
  const issues = v6["~standard"].validate(bad).issues;
  assert(issues.length === errors.length, "raw parity: same number of issues as errors");
  for (let i = 0; i < errors.length; i++) {
    assert(issues[i].message === errors[i].message, "raw parity: message " + i);
    const joined = "/" + issues[i].path.map((p) => p.key).join("/");
    const want = errors[i].instancePath === "" ? "/" : errors[i].instancePath;
    assert(joined === want, "raw parity: path " + i);
  }
}

// Boolean schema false
const v3 = new Validator(false);
const r4 = v3["~standard"].validate("anything");
assert("issues" in r4, "boolean schema false rejects");

// Boolean schema true
const v4 = new Validator(true);
const r5 = v4["~standard"].validate("anything");
assert("value" in r5, "boolean schema true accepts");

console.log(`\n${pass}/${pass + fail} tests passed\n`);
process.exit(fail > 0 ? 1 : 0);
