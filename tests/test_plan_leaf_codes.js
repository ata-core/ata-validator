'use strict';

// A closed object's walk (additionalProperties: false, a short list of names)
// checks the commonest leaves in place by a code and its operands instead of
// calling the leaf's closure (leafCode and leafOk in lib/plan-compiler.js).
// The two must answer alike: here every leaf form is checked inside a closed
// object, where the code runs, and inside an open one, where the closure
// runs, on values chosen around each bound and type.

const assert = require('assert');
const { createInterpreter } = require('../lib/interpreter.js');
const { Validator } = require('../index.js');

const leaves = [
  { type: 'string' },
  { type: 'string', minLength: 2 },
  { type: 'string', maxLength: 3 },
  { type: 'string', minLength: 2, maxLength: 3 },
  { type: 'string', minLength: 0, maxLength: 0 },
  { type: 'string', pattern: '^[a-c]+$' },
  { type: 'string', minLength: 2, maxLength: 4, pattern: 'b' },
  { type: 'string', format: 'email' },
  { type: 'integer' },
  { type: 'integer', minimum: -1, maximum: 3 },
  { type: 'integer', minimum: 0.5 },
  { type: 'integer', exclusiveMinimum: 0 },
  { type: 'number' },
  { type: 'number', minimum: -0.5, maximum: 2.5 },
  { type: 'number', maximum: 0 },
  { type: 'number', multipleOf: 0.5 },
  { type: 'boolean' },
  { enum: ['a', 1, null, false, 0] },
  { enum: [1.5, 'b'] },
  { enum: [{ a: 1 }, 'a'] },
  { const: 0 },
  { const: null },
  { const: 'x' },
  { const: false },
  { const: [1] },
  { type: 'string', enum: ['a', 'bb'] },
];
const values = [
  '', 'a', 'ab', 'abc', 'abcd', 'abcde', 'b', 'bb', 'x', 'd', '\u{1F600}', '\u{1F600}\u{1F600}', 'a\u{1F600}', '\u{1F600}a\u{1F600}', '\ud800', '\ud800\ud800\ud800',
  'ada@example.com', 'not an email',
  0, -0, 1, -1, 2, 3, 4, 0.5, -0.5, 1.5, 2.5, 3.5, 1e21, 2 ** 53, -(2 ** 53), NaN, Infinity, -Infinity,
  true, false, null, [], [1], {}, { a: 1 }, { a: 2 },
];

let pairs = 0;
for (const leaf of leaves) {
  for (const width of [1, 9]) {
    const others = Object.fromEntries(Array.from({ length: width - 1 }, (_, i) => ['o' + i, { type: 'string' }]));
    const properties = { x: leaf, ...others };
    const closed = createInterpreter({ type: 'object', properties, additionalProperties: false }, { tier: 0 });
    const open = createInterpreter({ type: 'object', properties }, { tier: 0 });
    // tier 0: both run the compiled tree from the first call.
    for (const v of values) {
      const doc = { x: v };
      assert.strictEqual(closed.isValid(doc), open.isValid(doc), `${JSON.stringify(leaf)} on ${typeof v === 'string' ? JSON.stringify(v) : String(v)} (${width} names)`);
      assert.strictEqual(closed.isValid(doc), closed.validate(doc).valid, `${JSON.stringify(leaf)} on ${String(v)}: verdict and errors agree`);
      pairs++;
    }
  }
}
console.log(`ok: in-place leaf checks answer as their closures on ${leaves.length} leaf forms and ${pairs} documents`);

// The closed walk itself, against the plain walk (no tier): extra keys,
// missing and undefined required names, names Object.prototype also has,
// and objects that are not ordinary.
let walks = 0;
for (const width of [1, 3, 8, 9, 32]) {
  const names = ['constructor', ...Array.from({ length: width - 1 }, (_, i) => 'p' + i)];
  const schema = { type: 'object', properties: Object.fromEntries(names.map((n) => [n, { type: 'string' }])), required: [names[0], names[names.length - 1]], additionalProperties: false };
  const tree = createInterpreter(schema, { tier: 0 });
  const plain = createInterpreter(schema, { tier: Infinity });
  const full = Object.fromEntries(names.map((n) => [n, 'v']));
  const docs = [
    full, {}, { [names[0]]: 'v' }, { ...full, extra: 1 }, { ...full, [names[0]]: undefined }, { ...full, [names[0]]: 1 },
    Object.fromEntries(names.slice(1).map((n) => [n, 'v'])), { ...Object.fromEntries(names.slice(1).map((n) => [n, 'v'])), extra: 'v' },
    Object.assign(Object.create(null), full), Object.assign(Object.create({ inherited: 1 }), full), Object.assign(new (class X {})(), full),
    { ...full, toString: 'v' }, { ...full, __proto__: null }, [], 'x', null,
  ];
  for (const d of docs) { assert.strictEqual(tree.isValid(d), plain.isValid(d), `closed walk, ${width} names: ${JSON.stringify(d)}`); walks++; }
}
console.log(`ok: the closed walk answers as the plain walk on ${walks} documents`);

// A name only properties lists is read by name on every path, enumerable or
// not, as the generated code reads it; a name none lists counts for
// patternProperties and additionalProperties only when for-in would meet it.
// The walk of a long list read Object.keys, so a hidden listed property passed
// there and failed on a short list.
{
  const hidden = (k, v) => Object.defineProperty({ a: 'x' }, k, { value: v, enumerable: false });
  for (const width of [3, 9, 20]) {
    const names = ['a', ...Array.from({ length: width - 1 }, (_, i) => 'p' + i)];
    for (const extra of [{}, { additionalProperties: false }, { patternProperties: { '^z': { type: 'integer' } } }, { propertyNames: { maxLength: 3 } }]) {
      const schema = { type: 'object', properties: Object.fromEntries(names.map((n) => [n, { type: 'string' }])), ...extra };
      const tree = createInterpreter(schema, { tier: 0 });
      const plain = createInterpreter(schema, { tier: Infinity });
      const gen = new Validator(schema);
      for (const d of [hidden('p0', 1), hidden('p0', 'ok'), hidden('zz', 'q'), hidden('unlisted', 1), hidden('toolong', 1)]) {
        const want = gen.isValidObject(d);
        assert.strictEqual(tree.isValid(d), want, `${width} names, ${JSON.stringify(extra)}, hidden ${Object.getOwnPropertyNames(d)[1]}: tree`);
        assert.strictEqual(plain.isValid(d), want, `${width} names, ${JSON.stringify(extra)}: plain walk`);
        assert.strictEqual(tree.validate(d).valid, want, `${width} names, ${JSON.stringify(extra)}: tree errors path`);
      }
    }
  }
}
console.log('ok: hidden own properties are read alike on the short and long property walks, as the generated code reads them');
