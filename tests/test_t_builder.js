'use strict';

// Behavioural tests for `ata-validator/t`. The builder emits plain JSON
// Schema, so the contract is: (a) the emitted shape matches what JSON
// Schema spells the same way, (b) feeding the output to `new Validator(...)`
// validates as expected, (c) optional keys do not appear in `required`.

const assert = require('node:assert');
const { Validator } = require('..');
const { t, OPTIONAL } = require('../t.js');

let failed = 0;
function ok(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
  } catch (e) {
    failed++;
    console.log(`  FAIL  ${name}`);
    console.log(`        ${e.message}`);
  }
}

ok('t.string with options emits {type, ...opts}', () => {
  const s = t.string({ minLength: 1, format: 'email' });
  assert.deepStrictEqual(s, { type: 'string', minLength: 1, format: 'email' });
});

ok('t.integer with bounds', () => {
  const s = t.integer({ minimum: 0, maximum: 100 });
  assert.deepStrictEqual(s, { type: 'integer', minimum: 0, maximum: 100 });
});

ok('t.boolean / t.null', () => {
  assert.deepStrictEqual(t.boolean(), { type: 'boolean' });
  assert.deepStrictEqual(t.null(), { type: 'null' });
});

ok('t.literal / t.const / t.enum', () => {
  assert.deepStrictEqual(t.literal('admin'), { const: 'admin' });
  assert.deepStrictEqual(t.const(42), { const: 42 });
  assert.deepStrictEqual(t.enum(['a', 'b']), { enum: ['a', 'b'] });
});

ok('t.array with item schema', () => {
  const s = t.array(t.string(), { minItems: 1 });
  assert.deepStrictEqual(s, { type: 'array', items: { type: 'string' }, minItems: 1 });
});

ok('t.tuple emits prefixItems + items:false + minItems', () => {
  const s = t.tuple([t.string(), t.number()]);
  assert.deepStrictEqual(s, {
    type: 'array',
    prefixItems: [{ type: 'string' }, { type: 'number' }],
    items: false,
    minItems: 2,
  });
});

ok('t.record uses additionalProperties', () => {
  const s = t.record(t.integer());
  assert.deepStrictEqual(s, { type: 'object', additionalProperties: { type: 'integer' } });
});

ok('t.object computes required from non-optional keys', () => {
  const s = t.object({
    name: t.string(),
    age: t.optional(t.integer()),
    email: t.optional(t.string({ format: 'email' })),
  });
  assert.strictEqual(s.type, 'object');
  assert.deepStrictEqual(s.required, ['name']);
  assert.deepStrictEqual(s.properties.name, { type: 'string' });
  assert.deepStrictEqual(s.properties.age, { type: 'integer' });
  assert.deepStrictEqual(s.properties.email, { type: 'string', format: 'email' });
});

ok('t.optional carries the symbol marker', () => {
  const s = t.optional(t.string());
  assert.strictEqual(s[OPTIONAL], true);
});

ok('OPTIONAL marker is invisible to Object.keys / JSON.stringify', () => {
  const s = t.optional(t.string({ minLength: 1 }));
  assert.deepStrictEqual(Object.keys(s), ['type', 'minLength']);
  assert.strictEqual(JSON.stringify(s), '{"type":"string","minLength":1}');
});

ok('t.union -> anyOf, t.intersect -> allOf', () => {
  const u = t.union([t.string(), t.number()]);
  assert.deepStrictEqual(u, { anyOf: [{ type: 'string' }, { type: 'number' }] });
  const i = t.intersect([t.object({ a: t.string() }), t.object({ b: t.number() })]);
  assert.strictEqual(i.allOf.length, 2);
});

ok('t.ref emits $ref', () => {
  assert.deepStrictEqual(t.ref('#/$defs/User'), { $ref: '#/$defs/User' });
});

ok('Validator accepts builder output and validates', () => {
  const User = t.object({
    name: t.string({ minLength: 1 }),
    age: t.integer({ minimum: 0 }),
    email: t.optional(t.string({ format: 'email' })),
  });
  const v = new Validator(User);

  const r1 = v.validate({ name: 'Mert', age: 30 });
  assert.strictEqual(r1.valid, true, 'required-only input should validate');

  const r2 = v.validate({ name: 'Mert', age: 30, email: 'mert@example.com' });
  assert.strictEqual(r2.valid, true, 'with optional email should validate');

  const r3 = v.validate({ age: 30 });
  assert.strictEqual(r3.valid, false, 'missing required name should fail');

  const r4 = v.validate({ name: '', age: 30 });
  assert.strictEqual(r4.valid, false, 'minLength:1 should reject empty name');
});

ok('nested objects and arrays compose', () => {
  const Post = t.object({
    id: t.integer(),
    author: t.object({
      name: t.string(),
      handle: t.optional(t.string()),
    }),
    tags: t.array(t.string()),
    status: t.union([t.literal('draft'), t.literal('published')]),
  });
  const v = new Validator(Post);

  assert.strictEqual(
    v.validate({ id: 1, author: { name: 'a' }, tags: ['x'], status: 'draft' }).valid,
    true,
  );
  assert.strictEqual(
    v.validate({ id: 1, author: { name: 'a' }, tags: ['x'], status: 'archived' }).valid,
    false,
  );
});

ok('t.tuple closes the tail', () => {
  const Pair = t.tuple([t.string(), t.number()]);
  const v = new Validator(Pair);
  assert.strictEqual(v.validate(['a', 1]).valid, true);
  assert.strictEqual(v.validate(['a', 1, 'extra']).valid, false, 'extra element rejected');
  assert.strictEqual(v.validate(['a']).valid, false, 'missing element rejected');
});

// --- pick / omit ---
ok('t.pick selects properties and required subset', () => {
  const User = t.object({
    id: t.integer(),
    name: t.string({ minLength: 1 }),
    email: t.optional(t.string({ format: 'email' })),
  }, { additionalProperties: false, title: 'User' });

  const IdName = t.pick(User, ['id', 'name']);
  assert.deepStrictEqual(Object.keys(IdName.properties), ['id', 'name']);
  assert.deepStrictEqual(IdName.required, ['id', 'name']);
  assert.strictEqual(IdName.additionalProperties, false, 'pick preserves other keywords');
  assert.strictEqual(IdName.title, 'User');

  const NoId = t.omit(User, ['id']);
  assert.deepStrictEqual(Object.keys(NoId.properties), ['name', 'email']);
  assert.deepStrictEqual(NoId.required, ['name'], 'omit drops picked-away required entries');

  // required disappears when the subset has no required keys
  const OnlyEmail = t.pick(User, ['email']);
  assert.ok(!('required' in OnlyEmail), 'no empty required array');

  // unknown keys are ignored at runtime
  const Loose = t.pick(User, ['id', 'nope']);
  assert.deepStrictEqual(Object.keys(Loose.properties), ['id']);

  // inputs are not mutated
  assert.deepStrictEqual(Object.keys(User.properties), ['id', 'name', 'email']);
  assert.deepStrictEqual(User.required, ['id', 'name']);

  // non-object schemas throw
  assert.throws(() => t.pick(t.string(), ['x']), /t\.pick: expected an object schema/);
  assert.throws(() => t.omit(t.union([t.string()]), ['x']), /t\.omit: expected an object schema/);

  // the output validates like plain JSON Schema
  const v = new Validator(IdName);
  assert.strictEqual(v.validate({ id: 1, name: 'a' }).valid, true);
  assert.strictEqual(v.validate({ id: 1 }).valid, false, 'name still required after pick');
});

console.log(`\n${failed === 0 ? 'ok' : 'FAILED'}: t builder behaviour`);
process.exit(failed > 0 ? 1 : 0);
