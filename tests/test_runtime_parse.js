'use strict';

// Validator#parse is the runtime twin of the parse() an ahead-of-time module
// exports, built by the same emitter. This holds the two to the same answers
// over seeded random schemas and documents: the same copy, the same
// rejection, the same decline, and the caller's object untouched.

const assert = require('assert');
const { Validator } = require('..');
const { toStandaloneModule } = require('../lib/aot-impl');

let x = 0x51f00d;
const rnd = (k) => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) % k; };
const pick = (a) => a[rnd(a.length)];

function leaf() {
  return pick([{ type: 'string' }, { type: 'number' }, { type: 'integer', minimum: 0 }, { type: 'boolean' },
    { type: 'string', default: 'dflt' }, { type: 'string', enum: ['a', 'b'] }, { type: 'array', items: { type: 'number' } }]);
}
function objectSchema(depth) {
  const props = {};
  for (const k of ['a', 'b', 'c']) if (rnd(3) > 0) props[k] = depth > 0 && rnd(3) === 0 ? objectSchema(depth - 1) : leaf();
  const s = { type: 'object', properties: props };
  const keys = Object.keys(props);
  if (keys.length) s.required = keys.filter(() => rnd(2) === 0);
  // Mostly closed: an object that allows unknown keys has no provable copy,
  // and both sides decline it; enough of those are still generated.
  const ap = rnd(10);
  if (ap < 7) s.additionalProperties = false;
  else if (ap < 9) s.additionalProperties = { type: 'number' };
  return s;
}
// Mostly valid documents, so the copy is exercised as much as the rejection:
// a value of the declared type four times in five, unknown keys only where
// the object admits them, now and then where it does not.
function leafValue(sub) {
  if (rnd(5) === 0) return pick(['s', 1, -2, 2.5, true, null, [1, 2]]);
  if (sub.enum) return pick(sub.enum);
  switch (sub.type) {
    case 'string': return pick(['s', 'longer']);
    case 'number': return pick([1, 2.5, -3]);
    case 'integer': return pick([0, 4]);
    case 'boolean': return pick([true, false]);
    case 'array': return [1, 2];
    default: return 1;
  }
}
function doc(schema, depth) {
  const o = {};
  for (const k of Object.keys(schema.properties || {})) {
    const sub = schema.properties[k];
    const required = (schema.required || []).includes(k);
    if (!required && rnd(3) === 0) continue;
    o[k] = sub.type === 'object' && depth > 0 ? doc(sub, depth - 1) : leafValue(sub);
  }
  const closed = schema.additionalProperties === false;
  const extras = closed ? (rnd(6) === 0 ? 1 : 0) : rnd(3);
  for (let i = extras; i > 0; i--) o[pick(['z', 'extra'])] = schema.additionalProperties && schema.additionalProperties.type === 'number' ? 7 : pick([1, 'e', { a: 1 }]);
  return o;
}
function loadModule(src) {
  const m = { exports: {} };
  // eslint-disable-next-line no-new-func
  new Function('module', 'exports', 'require', src)(m, m.exports, require);
  return m.exports;
}
const outcome = (fn) => {
  try { return { ok: JSON.stringify(fn()) }; } catch (e) { return { err: e.name }; }
};

let compared = 0, parsed = 0, declined = 0, bad = 0;
const report = (m) => { if (bad++ < 10) console.error(m); };
for (let i = 0; i < 600; i++) {
  const schema = objectSchema(2);
  const text = JSON.stringify(schema);
  const v = new Validator(JSON.parse(text));
  const src = toStandaloneModule(new Validator(JSON.parse(text)), { parse: true, format: 'cjs' });
  const mod = src ? loadModule(src) : null;
  const hasAot = !!(mod && typeof mod.parse === 'function');
  for (let j = 0; j < 6; j++) {
    const d = doc(schema, 2);
    const before = JSON.stringify(d);
    const got = outcome(() => v.parse(d));
    compared++;
    if (JSON.stringify(d) !== before) report(`parse modified its input: ${text} on ${before}`);
    if (!hasAot) {
      if (got.err !== 'TypeError') report(`runtime parse answered where the module ships none: ${text} -> ${JSON.stringify(got)}`);
      declined++;
      continue;
    }
    const want = outcome(() => mod.parse(JSON.parse(before)));
    if (JSON.stringify(got) !== JSON.stringify(want)) report(`differs from the module: ${JSON.stringify(got)} vs ${JSON.stringify(want)}: ${text} on ${before}`);
    if (got.ok) parsed++;
    if (got.err === 'AtaValidationError' && v.validate(JSON.parse(before)).valid) report(`rejected what validate() accepts: ${text} on ${before}`);
  }
}

// The error carries the validator's errors; the input is left alone even
// when the validator fills defaults.
{
  const v = new Validator({ type: 'object', properties: { a: { type: 'number' }, b: { type: 'string', default: 'x' } }, required: ['a'], additionalProperties: false });
  const input = { a: 'no' };
  let e = null;
  try { v.parse(input); } catch (err) { e = err; }
  assert.ok(e && e.name === 'AtaValidationError' && Array.isArray(e.errors) && e.errors.some((x) => x.keyword === 'type'), 'rejection carries errors');
  assert.deepStrictEqual(input, { a: 'no' }, 'the input is not modified on rejection');
  const ok = { a: 1 };
  assert.deepStrictEqual(v.parse(ok), { a: 1, b: 'x' });
  assert.deepStrictEqual(ok, { a: 1 }, 'the input is not modified on success');
  assert.throws(() => new Validator({ type: 'object', properties: { n: { type: 'number' } } }, { coerceTypes: true }).parse({ n: '1' }), TypeError);
}

assert.strictEqual(bad, 0, `${bad} disagreements with the module's parse()`);
assert.ok(parsed > 200 && declined > 50, `parsed ${parsed}, declined ${declined}: too few of either to mean much`);
console.log(`ok: runtime parse() matches the module's on ${compared} documents (${parsed} copies, ${declined} declines)`);
