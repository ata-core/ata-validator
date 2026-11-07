'use strict';
// A union of objects that each require one property fixed by a primitive
// const goes straight to the branch the document's value names (tagged() in
// lib/plan-compiler.js). The interpreted engine must answer as the generated
// code does wherever that shortcut could differ from trying every branch:
// non-objects, arrays, a missing or inherited tag, a tag held undefined, a
// value no branch names, number, boolean and null tags, and unions the table
// must decline (two branches fixing one value, a tag one branch does not
// require, an enum tag, a non-object branch, a $ref branch).
const assert = require('assert');
const { Validator } = require('..');

const msg = (tag, extra = {}, req = ['type']) => ({ type: 'object', properties: { type: { const: tag }, ...extra }, required: req, additionalProperties: false });
const unions = {
  'strings': { anyOf: [msg('ping', { id: { type: 'integer' } }, ['type', 'id']), msg('pong', { id: { type: 'integer', minimum: 0 } }, ['type', 'id']), msg('data', { body: { type: 'string' } }, ['type'])] },
  'number, boolean and null tags': { anyOf: [msg(1, { a: { type: 'string' } }), msg(true, { b: { type: 'integer' } }), msg(null), msg('1')] },
  'two branches fix one value': { anyOf: [msg('a', { x: { type: 'string' } }, ['type', 'x']), msg('a', { y: { type: 'integer' } }, ['type', 'y'])] },
  'a branch does not require the tag': { anyOf: [msg('a', { x: { type: 'string' } }, ['type']), msg('b', { y: { type: 'integer' } }, [])] },
  'an enum tag': { anyOf: [msg('a'), { type: 'object', properties: { type: { enum: ['b', 'c'] } }, required: ['type'] }] },
  'a non-object branch': { anyOf: [msg('a'), { type: 'string' }] },
  'a $ref branch': { $defs: { b: msg('b') }, anyOf: [msg('a'), { $ref: '#/$defs/b' }] },
  'open branches': { anyOf: [{ type: 'object', properties: { type: { const: 'a' } }, required: ['type'] }, { type: 'object', properties: { type: { const: 'b' }, n: { type: 'integer' } }, required: ['type', 'n'] }] },
};
const docs = [
  { type: 'ping', id: 1 }, { type: 'ping' }, { type: 'pong', id: -1 }, { type: 'pong', id: 3 }, { type: 'data' }, { type: 'data', body: 1 },
  { type: 'nope' }, {}, { id: 1 }, { type: undefined }, { type: 1, a: 's' }, { type: 1, a: 2 }, { type: '1' }, { type: true, b: 2 }, { type: true, b: 'x' },
  { type: null }, { type: 'a', x: 's' }, { type: 'a', y: 2 }, { type: 'a', x: 1, y: 2 }, { type: 'b', y: 1 }, { y: 1 }, { type: 'c' }, { type: 'b', n: 1 },
  { type: 'b' }, { type: 'a', extra: 1 }, 'a', 1, null, [], [{ type: 'a' }], Object.assign([], { type: 'a' }),
  Object.assign(Object.create({ type: 'ping' }), { id: 1 }), Object.assign(Object.create({ type: 'a' }), { x: 's' }),
];

let n = 0;
for (const [name, schema] of Object.entries(unions)) {
  const gen = new Validator(schema);
  const interp = new Validator(schema, { engine: 'interpreter' });
  for (const d of docs) {
    const want = gen.isValidObject(d);
    for (let i = 0; i < 40; i++) assert.strictEqual(interp.isValidObject(d), want, `${name}: call ${i} on ${JSON.stringify(d)}`);
    assert.strictEqual(interp.validate(d).valid, want, `${name}: validate() on ${JSON.stringify(d)}`);
    n++;
  }
}
console.log(`ok: tagged unions answer as the generated code, ${Object.keys(unions).length} unions, ${n} documents`);
