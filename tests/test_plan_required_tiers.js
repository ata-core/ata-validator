'use strict';

// The interpreted engine answers the first thousand calls with the plan
// compiler and then installs the closure plan. The two have to agree, and
// they did not for a `required` list that names a declared property next to
// an undeclared one: the plan walk flagged the declared key as required and
// counted it against a total of zero, since the leaf checks every required
// name itself when one is undeclared. `{a: 1, b: 2}` was refused for the
// first thousand calls and accepted from then on; under `not` the same
// document was accepted and then refused. Runs with code generation blocked
// too, which is where the interpreted engine is the only one.

const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { Validator } = require('..');

const ap = { additionalProperties: { type: 'number' } };
const nine = Object.fromEntries('abcdefghi'.split('').map((c) => [c, { type: 'number' }]));
const CASES = [
  [{ type: 'object', properties: { a: { type: 'number' } }, required: ['a', 'b'], ...ap }, { a: 1, b: 2 }, true],
  [{ not: { type: 'object', properties: { a: { type: 'number' } }, required: ['a', 'b'], ...ap } }, { a: 1, b: 2 }, false],
  [{ type: 'object', properties: { a: { type: 'number' } }, required: ['a', 'b'], patternProperties: { '^z': {} } }, { a: 1, b: 2 }, true],
  [{ not: { type: 'object', properties: { a: { type: 'number' } }, required: ['a', 'b'], patternProperties: { '^z': {} } } }, { a: 1, b: 2 }, false],
  [{ type: 'object', properties: nine, required: ['a', 'zz'] }, { a: 1, zz: 2 }, true],
  [{ not: { type: 'object', properties: nine, required: ['a', 'zz'] } }, { a: 1, zz: 2 }, false],
  [{ anyOf: [{ type: 'object', properties: { a: { type: 'number' } }, required: ['a', 'b'], ...ap }] }, { a: 1, b: 2 }, true],
  [{ type: 'object', properties: { o: { type: 'object', properties: { a: { type: 'number' } }, required: ['a', 'b'], ...ap } } }, { o: { a: 1, b: 2 } }, true],
  // the missing key is still missing on every call
  [{ type: 'object', properties: { a: { type: 'number' } }, required: ['a', 'b'], ...ap }, { a: 1 }, false],
  [{ type: 'object', properties: { a: { type: 'number' } }, required: ['a', 'b'], ...ap }, { b: 2 }, false],
  [{ not: { type: 'object', properties: { a: { type: 'number' } }, required: ['a', 'b'], ...ap } }, { a: 1 }, true],
];
const CALLS = 1001;

let checked = 0;
for (const [schema, doc, expect] of CASES) {
  assert.strictEqual(new Validator(schema).validate(doc).valid, expect, 'generated code: ' + JSON.stringify(schema));
  const it = new Validator(schema, { engine: 'interpreter' });
  for (let i = 0; i < CALLS; i++) {
    const r = it.validate(doc).valid;
    if (r !== expect) assert.fail(`interpreter validate says ${r} on call ${i + 1}, expected ${expect}: ${JSON.stringify(schema)}`);
    const b = it.isValidObject(doc);
    if (b !== expect) assert.fail(`interpreter isValidObject says ${b} on call ${i + 1}, expected ${expect}: ${JSON.stringify(schema)}`);
  }
  checked++;
}

// The same with eval and new Function blocked, where nothing but the
// interpreted engine can answer.
const child = `
const assert = require('node:assert');
process.env.ATA_NO_NATIVE = '1';
const RealFunction = Function;
globalThis.eval = () => { throw new EvalError('eval blocked'); };
const G = new Proxy(RealFunction, { construct() { throw new EvalError('new Function blocked'); }, apply(t, th, a) { if (a.length > 0) throw new EvalError('Function(source) blocked'); return Reflect.apply(t, th, a); } });
Object.defineProperty(globalThis, 'Function', { value: G, writable: true, configurable: true });
const { Validator } = require(${JSON.stringify(path.join(__dirname, '..'))});
const CASES = ${JSON.stringify(CASES)};
for (const [schema, doc, expect] of CASES) {
  const v = new Validator(schema);
  for (let i = 0; i < ${CALLS}; i++) {
    if (v.validate(doc).valid !== expect) { console.error('validate differs on call ' + (i + 1) + ' for ' + JSON.stringify(schema)); process.exit(1); }
    if (v.isValidObject(doc) !== expect) { console.error('isValidObject differs on call ' + (i + 1) + ' for ' + JSON.stringify(schema)); process.exit(1); }
  }
}
console.log('child ok');
`;
const r = spawnSync(process.execPath, ['-e', child], { encoding: 'utf8' });
assert.strictEqual(r.status, 0, (r.stderr || '').split('\n').slice(-4).join(' '));
assert.ok(r.stdout.includes('child ok'));

console.log(`ok: required with an undeclared name answers the same on every one of ${CALLS} interpreted calls, ${checked} shapes, with and without code generation`);
