'use strict';

// With removeAdditional alone, a document the verdict accepts is answered by a
// verdict function that deletes unknown keys as it walks, instead of a separate
// removal pass followed by the verdict. That is only allowed to be faster: the
// result, the errors and the object left behind must be what removing first
// and validating after gives. This compares against the interpreted engine,
// which removes with its own closure pass, over seeded random schemas, some
// inside the shapes the fused path accepts and some deliberately outside it
// (minProperties, a const object, uniqueItems, anyOf, a required name the node
// does not declare), and random documents with unknown keys at every level.

const assert = require('assert');
const { Validator } = require('..');
const jc = require('../lib/js-compiler');

let x = 0x1f2e3d;
const rnd = (k) => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) % k; };
const pick = (a) => a[rnd(a.length)];
const NAMES = ['a', 'b', 'c', 'toString'];

function leaf() {
  return pick([{ type: 'string' }, { type: 'number', minimum: 0 }, { type: 'integer' }, { type: 'boolean' },
    { type: 'string', minLength: 2 }, { enum: [1, 'x', null] }, { const: 3 }, {}]);
}
function objectSchema(depth, unsafe) {
  const props = {};
  for (const k of NAMES) if (rnd(3) > 0) props[k] = depth > 0 && rnd(3) === 0 ? objectSchema(depth - 1, unsafe) : leaf();
  const s = { type: 'object', properties: props };
  const keys = Object.keys(props);
  if (keys.length) s.required = keys.filter(() => rnd(2) === 0);
  s.additionalProperties = pick([false, false, false, true, { type: 'number' }]);
  if (depth > 0 && rnd(4) === 0) s.properties.list = { type: 'array', items: objectSchema(depth - 1, unsafe) };
  if (unsafe && rnd(3) === 0) {
    const kind = rnd(5);
    if (kind === 0) s.minProperties = 1 + rnd(3);
    else if (kind === 1) s.const = { a: 1 };
    else if (kind === 2) s.anyOf = [{ required: ['z'] }, { required: ['a'] }];
    else if (kind === 3) s.required = [...(s.required || []), 'z'];
    else s.maxProperties = rnd(3);
  }
  return s;
}
function value(schema, depth) {
  if (!schema || schema.type !== 'object') return pick(['s', 'ab', 1, -1, 2.5, true, null, 'x', 3]);
  const o = {};
  for (const k of Object.keys(schema.properties || {})) {
    if (rnd(5) === 0) continue;
    const sub = schema.properties[k];
    o[k] = sub.type === 'object' && depth > 0 ? value(sub, depth - 1)
      : sub.type === 'array' ? Array.from({ length: rnd(3) }, () => value(sub.items, depth - 1))
        : value(null, 0);
  }
  for (let i = rnd(3); i > 0; i--) o[pick(['z', 'extra', 'q'])] = pick([1, 'e', { a: 1 }]);
  return o;
}

let fusedSchemas = 0, compared = 0, bad = 0;
const report = (m) => { if (bad++ < 10) console.error(m); };
for (let i = 0; i < 1500; i++) {
  const unsafe = i % 3 === 0;
  const schema = objectSchema(2, unsafe);
  const text = JSON.stringify(schema);
  if (jc.compileToJSCodegen(JSON.parse(text), null, null, { removeAdditional: true })) fusedSchemas++;
  const v = new Validator(JSON.parse(text), { removeAdditional: true });
  const ref = new Validator(JSON.parse(text), { removeAdditional: true, engine: 'interpreter' });
  for (let j = 0; j < 8; j++) {
    const doc = value(schema, 2);
    const a = JSON.parse(JSON.stringify(doc)), b = JSON.parse(JSON.stringify(doc)), c = JSON.parse(JSON.stringify(doc));
    const ra = v.validate(a), rb = ref.validate(b);
    const vc = v.isValidObject(c);
    compared++;
    const ka = ra.valid ? '' : ra.errors.map((e) => e.keyword + e.instancePath).sort().join(',');
    const kb = rb.valid ? '' : rb.errors.map((e) => e.keyword + e.instancePath).sort().join(',');
    if (ra.valid !== rb.valid) report(`verdict ${ra.valid} vs interpreter ${rb.valid}: ${text} on ${JSON.stringify(doc)}`);
    else if (ka !== kb) report(`errors differ: ${ka} vs ${kb}: ${text} on ${JSON.stringify(doc)}`);
    if (JSON.stringify(a) !== JSON.stringify(b)) report(`data left differs: ${JSON.stringify(a)} vs ${JSON.stringify(b)}: ${text}`);
    if (vc !== rb.valid) report(`isValidObject ${vc} vs interpreter ${rb.valid}: ${text} on ${JSON.stringify(doc)}`);
    if (JSON.stringify(c) !== JSON.stringify(b)) report(`isValidObject left different data: ${JSON.stringify(c)} vs ${JSON.stringify(b)}: ${text}`);
    if (ra.valid && ra.data !== a) report('validate returned a different object as data');
  }
}
// Three faults this comparison found on the way, pinned by name.
{
  // The removal pass read a nested level through a parent that could be absent.
  const nested = { type: 'object', properties: { c: { type: 'object', properties: { d: { type: 'object', properties: { a: { type: 'number' } }, additionalProperties: false } } } } };
  for (const doc of [{}, { c: null }, { c: {} }, { c: { d: null } }]) {
    assert.doesNotThrow(() => new Validator(nested, { removeAdditional: true }).validate(JSON.parse(JSON.stringify(doc))), `threw on ${JSON.stringify(doc)}`);
  }
  // With no declared property every key is additional.
  const empty = { type: 'object', properties: { o: { type: 'object', properties: {}, additionalProperties: false } } };
  const d = { o: { x: 1, y: 2 } };
  new Validator(empty, { removeAdditional: true }).validate(d);
  assert.deepStrictEqual(d, { o: {} }, 'keys under empty properties are removed');
  // Where the generator declines (a property named toString), isValidObject
  // skipped the rewrite validate() applies and disagreed with it.
  const coerce = { type: 'object', properties: { toString: { type: 'string' }, n: { type: 'integer' } }, required: ['n'] };
  assert.strictEqual(new Validator(coerce, { coerceTypes: true }).isValidObject({ n: '5' }), true, 'isValidObject coerces as validate does');
  assert.strictEqual(new Validator(coerce, { coerceTypes: true }).validate({ n: '5' }).valid, true);
  compared += 7;
}

assert.strictEqual(bad, 0, `${bad} disagreements with remove-then-validate`);
assert.ok(fusedSchemas > 150, `only ${fusedSchemas} schemas took the fused path; the comparison is not exercising it`);
console.log(`ok: fused removeAdditional matches remove-then-validate on ${compared} documents, ${fusedSchemas} fused schemas`);
