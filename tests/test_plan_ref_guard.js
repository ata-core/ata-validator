'use strict';
// The closure tree's verdict counts references and scans for a repeated
// (schema, data) pair only past 64 deep (the 64 in the $ref step of lib/plan-compiler.js).
// Data that contains itself must still end, and a chain longer than the
// limit must still be checked to its end: both engines agree on each.
const assert = require('assert');
const { Validator } = require('..');

const schema = { $defs: { n: { type: 'object', properties: { v: { type: 'integer' }, next: { $ref: '#/$defs/n' } } } }, $ref: '#/$defs/n' };
let n = 0;
for (const bad of [false, true]) {
  const a = { v: 1 }, b = { v: bad ? 'x' : 2 };
  a.next = b; b.next = a;
  const chains = [63, 64, 65, 200].map((len) => {
    const head = { v: 0 }; let cur = head;
    for (let i = 0; i < len; i++) { cur.next = { v: i }; cur = cur.next; }
    cur.next = bad ? { v: 'x' } : { v: 1 };
    return [`chain ${len}`, head];
  });
  for (const [label, doc] of [['cycle', a], ...chains]) {
    const want = !bad;
    assert.strictEqual(new Validator(schema).isValidObject(doc), want, `${label} bad=${bad}: generated code`);
    const interp = new Validator(schema, { engine: 'interpreter' });
    for (let i = 0; i < 40; i++) assert.strictEqual(interp.isValidObject(doc), want, `${label} bad=${bad}: interpreter call ${i}`);
    assert.strictEqual(interp.validate(doc).valid, want, `${label} bad=${bad}: interpreter validate()`);
    n++;
  }
}
console.log(`ok: cyclic and deep data end with the same verdict on both engines, ${n} documents`);
