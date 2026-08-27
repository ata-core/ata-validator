'use strict';

// The hybrid validator is the boolean program's source rewritten so that
// `return false` becomes `return E(d)` and `return true` becomes `return R`.
// That rewrite is only correct for returns at the top level of the function;
// a `return` inside a nested closure must keep its boolean meaning or the
// closure's result changes type. This is the program Validator installs as
// `validate()` for most schemas, so it must agree with the boolean it was
// derived from on every input.
const assert = require('node:assert');
const { compileToJSCodegen, compileToJSCodegenWithErrors } = require('../lib/js-compiler');
const { Validator } = require('..');

const VALID = { valid: true, errors: [] };

const cases = [
  ['^[a-z]+$ at root', { type: 'string', pattern: '^[a-z]+$' }, 'ABC'],
  ['^[0-9]{5}$ unrolled', { type: 'string', pattern: '^[0-9]{5}$' }, 'ABCDE'],
  ['^[0-9]{20}$ looped', { type: 'string', pattern: '^[0-9]{20}$' }, 'A'.repeat(20)],
  ['^[a-z]{2,4}$ bounded', { type: 'string', pattern: '^[a-z]{2,4}$' }, 'ABC'],
  ['^a.*b$ regex path', { type: 'string', pattern: '^a.*b$' }, 'xyz'],
  ['nested property', { type: 'object', properties: { a: { type: 'string', pattern: '^[a-z]+$' } } }, { a: 'ABC' }],
  ['array items', { type: 'array', items: { type: 'string', pattern: '^[a-z]+$' } }, ['ABC']],
  ['propertyNames', { type: 'object', propertyNames: { pattern: '^[a-z]+$' } }, { ABC: 1 }],
  ['valid input stays valid', { type: 'string', pattern: '^[a-z]+$' }, 'abc'],
];

for (const [label, schema, data] of cases) {
  const bool = compileToJSCodegen(schema, null, undefined);
  assert.ok(bool, `${label}: codegen must not decline this schema`);
  assert.ok(bool._hybridFactory, `${label}: hybrid factory must exist`);
  const errFn = compileToJSCodegenWithErrors(schema, null, undefined);
  const hybrid = bool._hybridFactory(VALID, (d) => errFn(d, true));
  const b = bool(data);
  const h = hybrid(data).valid;
  assert.strictEqual(h, b, `${label}: hybrid said valid=${h}, boolean said ${b}`);
}
console.log('ok: hybrid agrees with boolean on', cases.length, 'cases');

// The production consequence. With preprocessing on, Validator installs the
// hybrid directly and nothing double-checks it, so a hybrid that says valid
// on invalid data is a silent accept.
{
  const withDefault = { type: 'object', properties: { code: { type: 'string', pattern: '^[a-z]+$' }, note: { type: 'string', default: 'n/a' } } };
  const v = new Validator(withDefault);
  assert.strictEqual(v.isValidObject({ code: 'ABC' }), false, 'boolean path rejects');
  assert.strictEqual(v.validate({ code: 'ABC' }).valid, false, 'validate() must reject when a default is present');
  console.log('ok: no silent accept with useDefaults');
}
{
  const v = new Validator({ type: 'object', properties: { code: { type: 'string', pattern: '^[a-z]+$' } } }, { coerceTypes: true });
  assert.strictEqual(v.validate({ code: 'ABC' }).valid, false, 'validate() must reject under coerceTypes');
  console.log('ok: no silent accept with coerceTypes');
}
{
  // Without preprocessing the verdict was already right; the detail was lost.
  const v = new Validator({ type: 'string', pattern: '^[a-z]+$' });
  const e = v.validate('ABC').errors[0];
  assert.strictEqual(e.keyword, 'pattern', `error must name the keyword, got ${e.keyword}`);
  assert.strictEqual(e.params.pattern, '^[a-z]+$');
  console.log('ok: pattern error keeps its keyword and params');
}

// bundleStandalone embeds the hybrid source as each bundled validate(),
// with no boolean in front of it. Measured before the fix: the bundle for
// this schema returned valid:true for { code: 'ABC' }.
{
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const src = Validator.bundleStandalone([{ type: 'object', properties: { code: { type: 'string', pattern: '^[a-z]+$' } } }]);
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'ata-hybrid-bundle-')), 'b.js');
  fs.writeFileSync(file, src);
  const fns = require(file);
  const v = Array.isArray(fns) ? fns[0] : fns;
  assert.strictEqual(v({ code: 'ABC' }).valid, false, 'bundleStandalone validate() must reject');
  assert.strictEqual(v({ code: 'abc' }).valid, true, 'bundleStandalone validate() accepts valid input');
  fs.rmSync(path.dirname(file), { recursive: true, force: true });
  console.log('ok: bundleStandalone validate() agrees with the boolean');
}

// Standalone modules embed the hybrid as their validate() with no boolean
// double-check in front of it, so the same rewrite defect there is a silent
// accept with no option involved at all. Compiled output is ESM, so this
// block imports it the way tests/test_aot_error_dx.js does.
(async () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const { execSync } = require('child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-hybrid-aot-'));
  const schemaFile = path.join(dir, 'code.schema.json');
  const outFile = path.join(dir, 'code.validator.mjs');
  fs.writeFileSync(schemaFile, JSON.stringify({ type: 'object', properties: { code: { type: 'string', pattern: '^[a-z]+$' } } }));
  execSync(`node ${path.join(__dirname, '..', 'bin', 'ata.js')} compile ${schemaFile} -o ${outFile}`, { stdio: 'pipe' });
  const mod = await import('file://' + outFile);
  assert.strictEqual(mod.isValid({ code: 'ABC' }), false, 'AOT isValid rejects');
  assert.strictEqual(mod.validate({ code: 'ABC' }).valid, false, 'AOT validate() must reject; it is the hybrid with no double-check');
  assert.strictEqual(mod.validate({ code: 'abc' }).valid, true, 'AOT validate() accepts valid input');
  fs.rmSync(dir, { recursive: true, force: true });
  console.log('ok: standalone module validate() agrees with isValid');
  console.log('ok: hybrid agreement');
})().catch((e) => { console.error(e); process.exit(1); });
