'use strict';

// Declaration-order sorting used to rank every error at read time by walking
// its schemaPath through the root schema (a Map lookup keyed by the path
// string, a wrapper object per error, an array-compare sort). The rank of a
// path is its pre-order position in the schema tree, which is one integer
// the code generator can compute once and write into the error literal.
// The read-time sort then compares integers, and skips the sort altogether
// when the errors already come out in order.

const assert = require('node:assert');
const { Validator } = require('../index');
const { rankFor, ordinalFor } = require('../lib/schema-order');

const schema = {
  type: 'object',
  properties: {
    id: { type: 'number' },
    title: { type: 'string', minLength: 1 },
    tags: { type: 'array', items: { type: 'string', minLength: 1 } },
    images: { type: 'array', items: { $ref: '#/$defs/image' } },
    discount: { oneOf: [{ type: 'number', minimum: 1 }, { type: 'null' }] },
  },
  required: ['id', 'title', 'tags', 'images'],
  $defs: {
    image: { type: 'object', properties: { url: { type: 'string' }, size: { type: 'number' } }, required: ['url', 'size'] },
  },
};

// The integer ordinal orders paths exactly as the array rank does.
{
  const paths = [
    '#/type', '#/properties/id/type', '#/properties/title/minLength', '#/properties/title/type',
    '#/properties/tags/items/minLength', '#/properties/tags/items/type', '#/properties/images/items',
    '#/properties/discount/oneOf/0/minimum', '#/properties/discount/oneOf/1/type', '#/properties/discount/oneOf',
    '#/required', '#/$defs/image/properties/url/type', '#/$defs/image/required', '#/$defs/image/properties/size/type',
    '#/properties/nope/type', '#/properties', '#',
  ];
  const cmpRank = (a, b) => {
    const ra = rankFor(schema, a), rb = rankFor(schema, b);
    const n = Math.min(ra.length, rb.length);
    for (let k = 0; k < n; k++) if (ra[k] !== rb[k]) return ra[k] - rb[k];
    return ra.length - rb.length;
  };
  const byRank = paths.slice().sort(cmpRank);
  const byOrdinal = paths.slice().sort((a, b) => ordinalFor(schema, a) - ordinalFor(schema, b));
  assert.deepStrictEqual(byOrdinal, byRank, 'ordinal order equals rank order');
  assert.strictEqual(ordinalFor(schema, 'shared#/type'), null, 'a path into another document has no ordinal');
  assert.strictEqual(ordinalFor(schema, '#'), 0, 'the root is first');
}

// Errors from the generated code carry the ordinal and come out in
// declaration order, as before.
{
  const v = new Validator(schema);
  const r = v.validate({ id: 'x', title: '', tags: ['ok', ''], images: [{ url: 1 }], discount: 0 });
  assert.strictEqual(v.engine(), 'codegen');
  const raw = r._ataRaw();
  assert.ok(raw.length >= 6, 'several errors, got ' + raw.length);
  for (const e of raw) assert.strictEqual(typeof e._o, 'number', 'every generated error carries _o: ' + JSON.stringify(e));
  const keys = raw.map((e) => e.keyword + '@' + e.instancePath);
  // Errors under a $ref target carry the referencing site's path, which
  // resolves no further than the `items` object, so those two keep their
  // emission order (required before properties), exactly as before.
  const expected = ['type@/id', 'minLength@/title', 'minLength@/tags/1', 'required@/images/0', 'type@/images/0/url', 'oneOf@/discount'];
  assert.deepStrictEqual(keys, expected);
  // The public list is unchanged in shape: no ordinal leaks into it.
  assert.strictEqual(r.errors[0]._o, undefined);
  assert.deepStrictEqual(r.errors.map((e) => e.keyword + '@' + e.instancePath), expected);
}

// Standard Schema issues: the same paths on every call, frozen so a cached
// segment list can be shared safely.
{
  const v = new Validator(schema);
  const std = v['~standard'];
  const a = std.validate({ id: 1, title: 'x', tags: ['ok', ''], images: [{ url: 'u', size: 'big' }] }).issues;
  const b = std.validate({ id: 1, title: 'x', tags: ['ok', ''], images: [{ url: 'u', size: 'big' }] }).issues;
  const keys = (issues) => issues.map((i) => i.path.map((seg) => seg.key));
  assert.deepStrictEqual(keys(a), [['tags', 1], ['images', 0, 'size']]);
  assert.deepStrictEqual(keys(b), keys(a));
  assert.strictEqual(a[0].path, b[0].path, 'the same path is one shared, frozen array');
  assert.ok(Object.isFrozen(a[0].path), 'issue paths are frozen');
  assert.strictEqual(std.validate({ id: 1, title: 'x', tags: [], images: [], 'we~ird/key': 1 }).issues, undefined, 'valid data carries no issues');
  // Escapes in a path are undone. (The generated code does not yet escape
  // keys containing `/` or `~` in instancePath; the interpreter does. That is
  // a separate defect and is exercised through the interpreter here.)
  const w = new Validator({ type: 'object', properties: { 'a/b': { type: 'number' }, 'c~d': { type: 'number' } }, unevaluatedProperties: false })['~standard'];
  assert.deepStrictEqual(keys(w.validate({ 'a/b': 'x', 'c~d': 'y' }).issues), [['a/b'], ['c~d']], 'escaped segments are unescaped');
}

console.log('ok: declaration order by compile-time ordinal, issue paths cached');
