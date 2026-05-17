'use strict';

const assert = require('assert');
const { suggestFor } = require('../lib/suggestions');

const cases = [
  // enum typo
  {
    err: { keyword: 'enum', received: '"adimn"', params: { allowedValues: ['admin', 'user', 'guest'] } },
    data: null,
    expectKind: 'typo',
    expectTextIncludes: 'admin',
  },
  // enum no close match
  {
    err: { keyword: 'enum', received: '"completely-different"', params: { allowedValues: ['admin', 'user', 'guest'] } },
    data: null,
    expect: null,
  },
  // required typo
  {
    err: { keyword: 'required', path: '', params: { missingProperty: 'email' } },
    data: { emial: 'a@b.co' },
    expectKind: 'similar-key',
    expectTextIncludes: 'email',
  },
  // required no similar
  {
    err: { keyword: 'required', path: '', params: { missingProperty: 'email' } },
    data: { foo: 'bar' },
    expect: null,
  },
  // format email no @
  {
    err: { keyword: 'format', received: '"nope"', params: { format: 'email' } },
    data: null,
    expectKind: 'format',
    expectTextIncludes: "missing '@'",
  },
  // format date bad month
  {
    err: { keyword: 'format', received: '"2026-13-01"', params: { format: 'date' } },
    data: null,
    expectKind: 'format',
    expectTextIncludes: 'month must be 01-12',
  },
  // type coercion integer
  {
    err: { keyword: 'type', received: '"42"', params: { type: 'integer' } },
    data: null,
    expectKind: 'coercion',
    expectTextIncludes: 'coerce',
  },
  // type no coercion (non-numeric string)
  {
    err: { keyword: 'type', received: '"nope"', params: { type: 'integer' } },
    data: null,
    expect: null,
  },
];

for (const c of cases) {
  const out = suggestFor(c.err, c.data);
  if (c.expect === null) {
    assert.strictEqual(out, null, `expected no suggestion for ${JSON.stringify(c.err)}, got ${JSON.stringify(out)}`);
    continue;
  }
  assert.ok(out, `expected suggestion for ${JSON.stringify(c.err)}`);
  if (c.expectKind) assert.strictEqual(out.kind, c.expectKind);
  if (c.expectTextIncludes) assert.ok(out.text.includes(c.expectTextIncludes), `expected text to include "${c.expectTextIncludes}", got "${out.text}"`);
  assert.ok(out.text.length <= 60, `suggestion text >60 chars: "${out.text}"`);
}

console.log(`ok: ${cases.length} suggestion table cases`);
