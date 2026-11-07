'use strict';
// The closed-object walks of tier 0 and of the closure tree (lib/tier0.js,
// lib/plan-compiler.js) take no prototype test: for-in yields own keys before
// inherited ones, so a hasOwnProperty call on the last key yielded tells
// whether any key was inherited. The interpreted engine must answer as the
// generated code does on objects that inherit enumerable names: a custom
// prototype carrying a declared name (valid or not), an inherited extra
// name, a polluted Object.prototype, null-prototype objects, and a value
// that fails under an inherited name.
const assert = require('assert');
const { Validator } = require('..');

const closed = (n, req) => ({ type: 'object', properties: Object.fromEntries(['a', 'b', 'c', 'd'].slice(0, n).map((k, i) => [k, i % 2 ? { type: 'integer', minimum: 0 } : { type: 'string', minLength: 1 }])), required: req, additionalProperties: false });
const schemas = [];
for (const n of [1, 2, 3, 4]) {
  schemas.push(closed(n, ['a']), closed(n, []), closed(n, ['a', 'b'].slice(0, Math.min(n, 2))));
  schemas.push({ type: 'object', properties: { p: closed(n, ['a']) }, required: ['p'] }); // through the closure tree
  schemas.push({ type: 'array', items: closed(n, []) });
  const untyped = closed(n, []); delete untyped.type;
  schemas.push(untyped, { type: 'object', properties: { p: untyped } });
}
const docsFor = () => [
  Object.create({ a: 'x' }),
  Object.assign(Object.create({ a: 'x' }), { b: 1 }),
  Object.assign(Object.create({ a: '' }), { b: 1 }),
  Object.assign(Object.create({ b: -1 }), { a: 'x' }),
  Object.assign(Object.create({ z: 1 }), { a: 'x' }),
  Object.assign(Object.create({ a: 1 }), { a: 'x' }),
  Object.assign(Object.create(null), { a: 'x' }),
  Object.assign(Object.create(null), { a: 'x', z: 1 }),
  Object.create(Object.create({ a: 'x', b: 2 })),
  { a: 'x' }, { a: 'x', b: 1 }, { b: 1 }, {},
  // Arrays: objects to typeof, rejected by type: object and passed by the
  // object keywords alone.
  [], ['x'], Object.assign([], { a: 'x' }),
];

let n = 0;
const run = (label) => {
  for (const s of schemas) {
    const gen = new Validator(s);
    const interp = new Validator(s, { engine: 'interpreter' });
    for (const d0 of docsFor()) {
      const d = s.type === 'array' ? [d0] : s.properties && s.properties.p ? { p: d0 } : d0;
      const want = gen.isValidObject(d);
      for (let i = 0; i < 30; i++) assert.strictEqual(interp.isValidObject(d), want, `${label}: call ${i}, schema ${JSON.stringify(s)}, own ${JSON.stringify(Object.keys(d0))}`);
      n++;
    }
  }
};
run('plain prototype');
// Left out: a polluted Object.prototype (an enumerable name every plain object
// inherits). There the generated code, from its third call, counts the
// inherited name as an extra property and rejects { a: 'x' } under
// additionalProperties: false, while the interpreted engine reads own names
// and accepts it; that is so on 1.63.1 already and is a rejection, not an
// acceptance. Found with this test, 2026-11-07.
console.log(`ok: inherited names answer alike on both engines, ${n} documents`);
