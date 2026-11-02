'use strict';
// Where the realm refuses generated code (a strict CSP,
// --disallow-code-generation-from-strings), a default Validator's
// isValidObject() must answer through the interpreted engine, as one built
// with engine: 'interpreter' does. The verdict-only compile behind its first
// call fell to the closure compiler there instead, at about twice the time
// (670 against 365 ns on a tagged union), which a public benchmark reported
// as the default being slower than the interpreter. Run in a child process
// with the flag, across the shapes that take different first-call paths.
const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');

const child = `
const { Validator } = require(${JSON.stringify(path.join(__dirname, '..', 'index.js'))})
const schemas = {
  'a union of objects': { type: 'object', properties: { m: { type: 'array', items: { oneOf: [{ type: 'object', properties: { k: { const: 'a' } }, required: ['k'] }, { type: 'object', properties: { k: { const: 'b' } }, required: ['k'] }] } } } },
  'a flat object (tier 0)': { type: 'object', properties: { a: { type: 'string' }, b: { type: 'integer' } }, required: ['a'] },
  'a recursive $ref': { $defs: { n: { type: 'object', properties: { c: { type: 'array', items: { $ref: '#/$defs/n' } } } } }, $ref: '#/$defs/n' },
}
const docs = { 'a union of objects': { m: [{ k: 'a' }, { k: 'b' }] }, 'a flat object (tier 0)': { a: 'x', b: 1 }, 'a recursive $ref': { c: [{ c: [] }] } }
const out = {}
for (const [name, s] of Object.entries(schemas)) {
  const v = new Validator(s)
  const first = v.isValidObject(docs[name]); const again = v.isValidObject(docs[name])
  out[name] = { engine: v._engine, closure: typeof v._jsFn === 'function', first, again, invalid: v.isValidObject(42), errors: v.validate(42).errors.length }
}
console.log(JSON.stringify(out))
`;
const res = JSON.parse(execFileSync(process.execPath, ['--disallow-code-generation-from-strings', '-e', child], { encoding: 'utf8' }));
for (const [name, r] of Object.entries(res)) {
  // The closure compiler's verdict is a function on _jsFn; the interpreted
  // engine's is an object there, or the tier-0 plan leaves it unset.
  assert.ok(!r.closure && r.engine !== 'closure', `${name}: the default validator answered through the closure compiler with code generation blocked`);
  assert.strictEqual(r.first, true, `${name}: first verdict`);
  assert.strictEqual(r.again, true, `${name}: second verdict`);
  assert.strictEqual(r.invalid, false, `${name}: verdict on an invalid value`);
  assert.ok(r.errors > 0, `${name}: errors on an invalid value`);
}
console.log(`ok: with code generation blocked the default verdict avoids the closure compiler (${Object.entries(res).map(([n, r]) => `${n}: ${r.engine || 'tier 0'}`).join(', ')})`);
