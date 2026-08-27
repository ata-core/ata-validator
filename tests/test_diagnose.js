'use strict';

const assert = require('node:assert');
const { toDiagnostics } = require('../lib/diagnose');

function err (o) {
  return Object.assign({ code: 'ATA1001', keyword: 'type', path: '', instancePath: '', params: {}, message: 'must be string' }, o);
}

// Junk in, empty out. A renderer must never throw.
{
  assert.deepStrictEqual(toDiagnostics(null), []);
  assert.deepStrictEqual(toDiagnostics([]), []);
  assert.deepStrictEqual(toDiagnostics([], undefined), []);
  console.log('ok: empty and malformed input');
}

// A code-less error renders without the literal "undefined".
{
  const d = toDiagnostics([{ keyword: 'validation', instancePath: '', schemaPath: '#', params: {}, message: 'schema validation failed' }]);
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].code, undefined, 'no code is carried as undefined, not invented');
  assert.strictEqual(d[0].headline, 'schema validation failed');
  console.log('ok: code-less error tolerated');
}

// The typo pair collapses into one diagnostic, and records what it absorbed.
{
  const errors = [
    err({ code: 'ATA7001', keyword: 'required', params: { missingProperty: 'name' }, message: "must have required property 'name'" }),
    err({ code: 'ATA7002', keyword: 'additionalProperties', params: { additionalProperty: 'nmae' }, message: 'must NOT have additional properties' }),
  ];
  const d = toDiagnostics(errors, { data: { nmae: 'x' } });
  assert.strictEqual(d.length, 1, 'two errors collapse to one diagnostic');
  assert.strictEqual(d[0].code, 'ATA7001', 'takes the required code');
  assert.match(d[0].headline, /unknown property "nmae"/);
  assert.match(d[0].headline, /did you mean "name"/);
  assert.strictEqual(d[0].mergedFrom.length, 2, 'records both raw errors');
  console.log('ok: typo pair collapses');
}

// An ambiguous pair does not collapse.
{
  const errors = [
    err({ code: 'ATA7001', keyword: 'required', params: { missingProperty: 'name' } }),
    err({ code: 'ATA7001', keyword: 'required', params: { missingProperty: 'mane' } }),
    err({ code: 'ATA7002', keyword: 'additionalProperties', params: { additionalProperty: 'nmae' } }),
  ];
  assert.strictEqual(toDiagnostics(errors).length, 3, 'ambiguity keeps all three');
  console.log('ok: ambiguity blocks collapse');
}

// Two additionalProperties errors are never byte-identical.
{
  const errors = [
    err({ code: 'ATA7002', keyword: 'additionalProperties', params: { additionalProperty: 'alpha' }, message: 'must NOT have additional properties' }),
    err({ code: 'ATA7002', keyword: 'additionalProperties', params: { additionalProperty: 'beta' }, message: 'must NOT have additional properties' }),
  ];
  const d = toDiagnostics(errors);
  assert.notStrictEqual(d[0].headline, d[1].headline, 'headlines must differ');
  assert.match(d[0].headline, /alpha/);
  assert.match(d[1].headline, /beta/);
  console.log('ok: additionalProperties headlines are distinguishable');
}

// Frames are synthesized from data when there is no text.
{
  const errors = [err({ path: '/tags/0', instancePath: '/tags/0', received: '1', params: { type: 'string' } })];
  const d = toDiagnostics(errors, { data: { tags: [1, 'ok'] } });
  assert.ok(d[0].frame, 'frame synthesized');
  assert.strictEqual(d[0].frame.synthesized, true, 'and marked as synthesized');
  assert.ok(d[0].notes.some((n) => /reconstructed/.test(n)), 'and says so');
  console.log('ok: frame synthesized from data');
}

// But never when preprocessing already changed that data.
{
  const errors = [err({ path: '/tags/0', instancePath: '/tags/0', received: '1' })];
  const d = toDiagnostics(errors, { data: { tags: [1] }, mutatesInput: true });
  assert.strictEqual(d[0].frame, null, 'no frame when the data was mutated');
  assert.ok(d[0].notes.some((n) => /no frame/.test(n)), 'and the reason is stated');
  console.log('ok: mutation refuses synthesis');
}

// Circular data does not throw.
{
  const circular = { a: 1 };
  circular.self = circular;
  const d = toDiagnostics([err({ path: '/a', instancePath: '/a' })], { data: circular });
  assert.strictEqual(d.length, 1);
  assert.strictEqual(d[0].frame, null, 'circular data yields no frame');
  console.log('ok: circular data tolerated');
}

// Ordering is by document position first, not by keyword class.
{
  const errors = [
    err({ path: '/z', instancePath: '/z', keyword: 'type', code: 'ATA1001' }),
    err({ path: '/a', instancePath: '/a', keyword: 'required', code: 'ATA7001', params: { missingProperty: 'q' } }),
  ];
  const d = toDiagnostics(errors, { data: { a: {}, z: 1 } });
  assert.strictEqual(d[0].pointer, '/a', 'earlier in the document comes first');
  assert.strictEqual(d[1].pointer, '/z');
  console.log('ok: ordering is positional');
}

// Within one position, cause comes before effect.
{
  const errors = [
    err({ path: '', instancePath: '', keyword: 'type', code: 'ATA1001', rank: 1 }),
    err({ path: '', instancePath: '', keyword: 'required', code: 'ATA7001', rank: 0, params: { missingProperty: 'q' } }),
  ];
  const d = toDiagnostics(errors, { data: {} });
  assert.strictEqual(d[0].code, 'ATA7001', 'key shape before type at the same position');
  console.log('ok: rank breaks ties');
}

// The discriminator is used when every branch pins one property with const.
{
  const schema = {
    anyOf: [
      { type: 'object', properties: { kind: { const: 'circle' }, radius: { type: 'number', minimum: 0 } } },
      { type: 'object', properties: { kind: { const: 'square' }, side: { type: 'number', minimum: 0 } } },
    ],
  };
  const errors = [err({
    code: 'ATA4003', keyword: 'anyOf', path: '', instancePath: '', schemaPath: '#/anyOf',
    message: 'value matched 0 of 2 anyOf variants',
    params: { variants: 2, closest: 0, closestName: 'variant 1' },
    branchErrors: [{ keyword: 'minimum', message: 'must be >= 0', instancePath: '/radius' }],
  })];
  const d = toDiagnostics(errors, { data: { kind: 'circle', radius: -1 }, schema });
  assert.match(d[0].headline, /kind "circle"/, 'names the discriminator the user wrote');
  console.log('ok: discriminator used in the headline');
}

// No discriminator, no guessing.
{
  const schema = { anyOf: [{ type: 'string' }, { type: 'number' }] };
  const errors = [err({ code: 'ATA4003', keyword: 'anyOf', schemaPath: '#/anyOf', message: 'value matched 0 of 2 anyOf variants', params: { variants: 2 } })];
  const d = toDiagnostics(errors, { data: true, schema });
  assert.match(d[0].headline, /2 anyOf variants/, 'falls back to the plain wording');
  console.log('ok: no discriminator means no guess');
}

console.log('ok: diagnose');
