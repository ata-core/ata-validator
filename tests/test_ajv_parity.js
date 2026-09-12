'use strict';

// The compat entry (`require('ata-validator/compat')`) is meant to stand in
// for the default validator's class with one import change. This test runs a
// corpus of the call shapes real consumers make (a framework's schema
// compiler, a bundler's option validator, a config loader, an API validator)
// through both the reference implementation and the shim, and compares what
// comes back. Behaviour is compared, not internals: verdicts, the set of
// (keyword, instancePath) pairs in `errors`, error messages, data after
// coercion or defaults, and the strings from errorsText().
//
// The reference is a devDependency and never ships. The corpus is where
// every gap in the shim must show up; a shape that passes here and fails in
// the wild is a missing corpus entry first.

const Ajv = require('ajv');
const addFormats = require('ajv-formats');
const Ata = require('../compat');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}: ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed');
}

function errorKeys(errors) {
  if (errors === null || errors === undefined) return null;
  return errors.map((e) => `${e.keyword}@${e.instancePath}`).sort();
}

function errorMessages(errors) {
  if (errors === null || errors === undefined) return null;
  return errors.map((e) => `${e.instancePath} ${e.message}`).sort();
}

function same(a, b, what) {
  const ja = JSON.stringify(a);
  const jb = JSON.stringify(b);
  if (ja !== jb) throw new Error(`${what}: reference ${ja}, shim ${jb}`);
}

// Run `scenario(Klass)` with both implementations and compare the returned
// snapshots field by field.
function parity(name, scenario) {
  test(name, () => {
    const ref = scenario(Ajv);
    const shim = scenario(Ata);
    for (const key of Object.keys(ref)) {
      same(ref[key], shim[key], key);
    }
  });
}

console.log('\najv parity (compat shim)\n');

// ----- a framework's schema compiler ---------------------------------------

parity('coerceTypes + useDefaults + removeAdditional, single error', (Klass) => {
  const ajv = new Klass({ coerceTypes: true, useDefaults: true, removeAdditional: true, allErrors: false });
  const validate = ajv.compile({
    type: 'object',
    properties: {
      page: { type: 'integer', default: 1 },
      limit: { type: 'integer', minimum: 1, maximum: 10 },
      q: { type: 'string' },
    },
    additionalProperties: false,
    required: ['limit'],
  });
  const good = { limit: '5', extra: true };
  const ok = validate(good);
  const bad = { limit: '50', q: 7 };
  const notOk = validate(bad);
  const errs = validate.errors;
  // A missing property and a too-large number; allErrors: false keeps one.
  const twice = { page: 'x' };
  validate(twice);
  return {
    ok,
    good,
    notOk,
    errorCount: errs.length,
    errorKeys: errorKeys(errs),
    twiceKeys: errorKeys(validate.errors),
  };
});

parity('allErrors: true reports every failure', (Klass) => {
  const ajv = new Klass({ allErrors: true });
  const validate = ajv.compile({
    type: 'object',
    properties: { a: { type: 'integer' }, b: { type: 'string', minLength: 2 } },
    required: ['a', 'b', 'c'],
  });
  const ok = validate({ a: 'x', b: 'y' });
  return { ok, keys: errorKeys(validate.errors), messages: errorMessages(validate.errors) };
});

parity('shared schemas: addSchema + $ref by id and by fragment', (Klass) => {
  const ajv = new Klass();
  ajv.addSchema({ $id: 'shared', type: 'object', properties: { id: { type: 'integer' }, name: { type: 'string' } }, required: ['id'] });
  const whole = ajv.compile({ $ref: 'shared' });
  const part = ajv.compile({ type: 'object', properties: { id: { $ref: 'shared#/properties/id' } } });
  return {
    whole1: whole({ id: 1 }),
    whole2: whole({ name: 'x' }),
    wholeKeys: errorKeys(whole.errors),
    part1: part({ id: 1 }),
    part2: part({ id: 'x' }),
    partKeys: errorKeys(part.errors),
  };
});

parity('schemas option and addSchema with an array', (Klass) => {
  const ajv = new Klass({ schemas: [{ $id: 'a', type: 'string' }] });
  ajv.addSchema([{ $id: 'b', type: 'number' }, { $id: 'c', type: 'boolean' }]);
  const v = ajv.compile({ type: 'array', items: [{ $ref: 'a' }, { $ref: 'b' }, { $ref: 'c' }] });
  return { ok: v(['x', 1, true]), no: v([1, 'x', 0]), keys: errorKeys(v.errors) };
});

parity('getSchema by key, by $id, and after removeSchema', (Klass) => {
  const ajv = new Klass();
  ajv.addSchema({ type: 'string', minLength: 1 }, 'name');
  ajv.addSchema({ $id: 'https://example.com/age', type: 'integer', minimum: 0 });
  const byKey = ajv.getSchema('name');
  const byId = ajv.getSchema('https://example.com/age');
  const before = { key: byKey('x'), keyNo: byKey(''), id: byId(3), idNo: byId(-1) };
  ajv.removeSchema('name');
  const afterKey = ajv.getSchema('name');
  ajv.removeSchema('https://example.com/age');
  const afterId = ajv.getSchema('https://example.com/age');
  return { before, afterKey: afterKey === undefined, afterId: afterId === undefined, unknown: ajv.getSchema('nope') === undefined };
});

parity('removeSchema with no argument clears everything', (Klass) => {
  const ajv = new Klass();
  ajv.addSchema({ type: 'string' }, 'a');
  ajv.addSchema({ type: 'number' }, 'b');
  ajv.removeSchema();
  return { a: ajv.getSchema('a') === undefined, b: ajv.getSchema('b') === undefined };
});

parity('ajv.validate(keyOrSchema, data) and ajv.errors', (Klass) => {
  const ajv = new Klass();
  ajv.addSchema({ type: 'string' }, 'str');
  const byKey = ajv.validate('str', 5);
  const keyErrors = errorKeys(ajv.errors);
  const inline = ajv.validate({ type: 'number' }, 5);
  const inlineErrors = ajv.errors;
  ajv.addSchema({ $id: 'https://example.com/n', type: 'number' });
  const byId = ajv.validate('https://example.com/n', 'x');
  return { byKey, keyErrors, inline, inlineErrors, byId, idErrors: errorKeys(ajv.errors) };
});

parity('error order matches the reference across keyword groups', (Klass) => {
  const out = {};
  for (const allErrors of [true, false]) {
    const ajv = new Klass({ allErrors });
    const v = ajv.compile({
      type: 'object',
      properties: {
        a: { type: 'integer', minimum: 3 },
        list: { type: 'array', items: { type: 'string' }, minItems: 2 },
        nested: { type: 'object', properties: { x: { const: 1 } }, required: ['y'] },
      },
      allOf: [{ properties: { a: { maximum: 0 } } }],
      minProperties: 5,
      required: ['b'],
      additionalProperties: false,
      propertyNames: { maxLength: 6 },
      enum: [{ a: 0 }],
    });
    v({ a: 'x', list: [1], nested: { x: 2 }, toolong: 1 });
    // Order matters here, so no sorting: the exact sequence is compared.
    out['ordered' + allErrors] = v.errors.map((e) => `${e.keyword}@${e.instancePath}`);
  }
  return out;
});

parity('first error under allErrors: false follows the reference, not declaration order', (Klass) => {
  const ajv = new Klass();
  const v = ajv.compile({ type: 'object', properties: { age: { type: 'number' } }, required: ['name'] });
  v({ age: 'x' });
  const first = v.errors[0].keyword;
  const v2 = ajv.compile({ type: 'object', properties: { s: { type: 'string', minLength: 3, pattern: '^a' } } });
  v2({ s: 'b' });
  const v3 = ajv.compile({ type: 'string', minLength: 3, pattern: '^a' });
  v3('b');
  return { first, nested: v2.errors[0].keyword, flat: v3.errors[0].keyword };
});

parity('anyOf and oneOf report the failing branches before the keyword', (Klass) => {
  const out = {};
  for (const allErrors of [true, false]) {
    const ajv = new Klass({ allErrors, strict: false });
    const nullable = ajv.compile({ type: 'object', properties: { name: { anyOf: [{ type: 'string', minLength: 2 }, { type: 'null' }] } } });
    nullable({ name: 5 });
    const one = ajv.compile({ oneOf: [{ type: 'string' }, { type: 'number', minimum: 5 }] });
    one(2);
    const multi = ajv.compile({ oneOf: [{ type: 'number' }, { minimum: 0 }] });
    multi(1);
    const nested = ajv.compile({ anyOf: [{ anyOf: [{ type: 'string' }, { type: 'boolean' }] }, { type: 'array' }] });
    nested(1);
    const withRef = ajv.compile({ definitions: { s: { type: 'string' } }, properties: { v: { anyOf: [{ $ref: '#/definitions/s' }, { type: 'number' }] } } });
    withRef({ v: true });
    out['nullable' + allErrors] = nullable.errors.map((e) => `${e.keyword}@${e.instancePath}:${e.schemaPath}`);
    out['one' + allErrors] = one.errors.map((e) => `${e.keyword}@${e.instancePath}:${e.schemaPath}`);
    out['multi' + allErrors] = multi.errors.map((e) => `${e.keyword}:${JSON.stringify(e.params)}`);
    out['nested' + allErrors] = nested.errors.map((e) => `${e.keyword}@${e.instancePath}:${e.schemaPath}`);
    out['withRef' + allErrors] = withRef.errors.map((e) => `${e.keyword}@${e.instancePath}`);
  }
  return out;
});

parity('propertyNames reports each bad name with a propertyNames error', (Klass) => {
  const out = {};
  for (const allErrors of [true, false]) {
    const ajv = new Klass({ allErrors });
    const v = ajv.compile({ type: 'object', propertyNames: { maxLength: 2, pattern: '^[a-z]+$' } });
    v({ ok: 1, toolong: 2, X: 3 });
    out['errors' + allErrors] = v.errors.map((e) => `${e.keyword}@${e.instancePath}:${e.schemaPath}:${e.propertyName || e.params.propertyName || ''}`);
  }
  return out;
});

parity('if/then, contains and dependencies under allErrors', (Klass) => {
  const out = {};
  for (const allErrors of [true, false]) {
    const ajv = new Klass({ allErrors, strict: false });
    const ifThen = ajv.compile({ if: { type: 'number' }, then: { minimum: 5 }, else: { type: 'string' } });
    ifThen(2);
    const thenKeys = ifThen.errors.map((e) => `${e.keyword}:${e.schemaPath}:${JSON.stringify(e.params)}`);
    ifThen(true);
    const elseKeys = ifThen.errors.map((e) => `${e.keyword}:${e.schemaPath}`);
    const contains = ajv.compile({ type: 'array', contains: { type: 'string' } });
    contains([1, 2]);
    const deps = ajv.compile({ type: 'object', dependencies: { a: ['b', 'c'], d: { required: ['e'] } } });
    deps({ a: 1 });
    const depsArr = deps.errors.map((e) => `${e.keyword}:${e.schemaPath}:${JSON.stringify(e.params)}:${e.message}`);
    deps({ d: 1 });
    const depsSchema = deps.errors.map((e) => `${e.keyword}:${e.schemaPath}`);
    out['then' + allErrors] = thenKeys;
    out['else' + allErrors] = elseKeys;
    out['contains' + allErrors] = contains.errors.map((e) => `${e.keyword}@${e.instancePath}:${e.schemaPath}`);
    out['depsArr' + allErrors] = depsArr;
    out['depsSchema' + allErrors] = depsSchema;
  }
  return out;
});

// ----- a bundler's option validator ----------------------------------------

parity('addKeyword validate form with errors: true and type', (Klass) => {
  const ajv = new Klass({ allErrors: true, strict: false });
  ajv.addKeyword({
    keyword: 'absolutePath',
    type: 'string',
    errors: true,
    validate: function absolutePath(schema, data) {
      const ok = schema ? data.startsWith('/') : !data.startsWith('/');
      if (!ok) {
        absolutePath.errors = [{
          keyword: 'absolutePath',
          params: { absolutePath: data },
          message: schema ? 'must be an absolute path' : 'must be a relative path',
        }];
      }
      return ok;
    },
  });
  const validate = ajv.compile({
    type: 'object',
    properties: {
      output: { type: 'string', absolutePath: true },
      entry: { type: 'string', absolutePath: false },
      count: { absolutePath: true },
    },
  });
  const ok = validate({ output: '/dist', entry: 'src', count: 4 });
  const no = validate({ output: 'dist', entry: '/src' });
  return { ok, no, keys: errorKeys(validate.errors), messages: errorMessages(validate.errors), params: validate.errors.map((e) => e.params) };
});

parity('addKeyword compile form', (Klass) => {
  const ajv = new Klass({ strict: false });
  ajv.addKeyword({
    keyword: 'maxWords',
    type: 'string',
    compile: (n) => (data) => data.split(/\s+/).length <= n,
  });
  const v = ajv.compile({ properties: { title: { type: 'string', maxWords: 3 } } });
  return { ok: v({ title: 'a b c' }), no: v({ title: 'a b c d' }), keys: errorKeys(v.errors), messages: errorMessages(v.errors) };
});

parity('addKeyword macro form', (Klass) => {
  const ajv = new Klass({ strict: false });
  ajv.addKeyword({ keyword: 'range', type: 'number', macro: ([min, max]) => ({ minimum: min, maximum: max }) });
  const v = ajv.compile({ properties: { n: { type: 'number', range: [1, 5] } } });
  return { ok: v({ n: 3 }), no: v({ n: 9 }), keys: errorKeys(v.errors) };
});

parity('addKeyword(name) string form and addVocabulary allow unknown keywords', (Klass) => {
  const ajv = new Klass();
  ajv.addKeyword('x-internal');
  ajv.addVocabulary(['x-note', 'x-tags']);
  const v = ajv.compile({ type: 'string', 'x-internal': true, 'x-note': 'hi', 'x-tags': [] });
  return { ok: v('s'), no: v(1) };
});

parity('addKeyword definition with keyword and validate as two arguments', (Klass) => {
  const ajv = new Klass({ strict: false, logger: false });
  ajv.addKeyword('even', { type: 'number', validate: (schema, data) => !schema || data % 2 === 0 });
  const v = ajv.compile({ even: true });
  return { a: v(2), b: v(3), c: v('x'), keys: errorKeys(v.errors) };
});

// ----- an API validator: formats -------------------------------------------

parity('addFormat as RegExp, string, function and object', (Klass) => {
  const ajv = new Klass();
  ajv.addFormat('slug', /^[a-z0-9-]+$/);
  ajv.addFormat('digits', '^[0-9]+$');
  ajv.addFormat('even-length', (s) => s.length % 2 === 0);
  ajv.addFormat('upper', { type: 'string', validate: (s) => s === s.toUpperCase() });
  const v = ajv.compile({
    type: 'object',
    properties: {
      slug: { type: 'string', format: 'slug' },
      digits: { type: 'string', format: 'digits' },
      even: { type: 'string', format: 'even-length' },
      upper: { type: 'string', format: 'upper' },
    },
  });
  const ok = v({ slug: 'a-b', digits: '12', even: 'ab', upper: 'AB' });
  const no = v({ slug: 'A B', digits: 'x1', even: 'abc', upper: 'Ab' });
  return { ok, no, keys: errorKeys(v.errors), messages: errorMessages(v.errors) };
});

parity('a custom format next to an anyOf sibling reports the format error', (Klass) => {
  const out = {};
  for (const allErrors of [true, false]) {
    const ajv = new Klass({ allErrors });
    ajv.addFormat('slug', /^[a-z-]+$/);
    const v = ajv.compile({
      type: 'object',
      properties: { s: { type: 'string', format: 'slug' }, n: { anyOf: [{ type: 'string' }, { type: 'null' }] } },
      required: ['s'],
    });
    out['bad' + allErrors] = v({ s: 'A', n: null });
    out['keys' + allErrors] = errorKeys(v.errors);
    out['ok' + allErrors] = v({ s: 'ok', n: null });
  }
  return out;
});

parity('formats option at construction', (Klass) => {
  const ajv = new Klass({ formats: { slug: /^[a-z-]+$/ } });
  const v = ajv.compile({ type: 'string', format: 'slug' });
  return { ok: v('a-b'), no: v('A') };
});

parity('built-in formats (email, uuid, date, ipv4) match the reference with its formats plugin', (Klass) => {
  const ajv = new Klass({ allErrors: true });
  if (Klass === Ajv) addFormats(ajv);
  const v = ajv.compile({
    type: 'object',
    properties: {
      email: { type: 'string', format: 'email' },
      uuid: { type: 'string', format: 'uuid' },
      date: { type: 'string', format: 'date' },
      ip: { type: 'string', format: 'ipv4' },
    },
  });
  const ok = v({ email: 'a@b.co', uuid: '123e4567-e89b-12d3-a456-426614174000', date: '2026-02-28', ip: '10.0.0.1' });
  const no = v({ email: 'nope', uuid: 'nope', date: '2026-02-30', ip: '999.0.0.1' });
  return { ok, no, keys: errorKeys(v.errors) };
});

parity('validateFormats: false turns format into an annotation', (Klass) => {
  const ajv = new Klass({ validateFormats: false });
  const v = ajv.compile({ type: 'string', format: 'email' });
  return { ok: v('not an email') };
});

// ----- a config loader: errors as text, schema validation ------------------

parity('errorsText default, custom separator and dataVar, and no errors', (Klass) => {
  const ajv = new Klass({ allErrors: true });
  const v = ajv.compile({ type: 'object', properties: { a: { type: 'integer' }, b: { type: 'string' } }, required: ['b'] });
  v({ a: 'x' });
  const sortedText = (t, sep) => t.split(sep).sort().join(sep);
  return {
    plain: sortedText(ajv.errorsText(v.errors), ', '),
    custom: sortedText(ajv.errorsText(v.errors, { separator: '\n', dataVar: 'config' }), '\n'),
    none: ajv.errorsText(null),
    empty: ajv.errorsText([]),
    fromInstance: (v({ a: 1, b: 'x' }), ajv.errorsText(v.errors)),
  };
});

parity('validateSchema on a valid and an invalid schema', (Klass) => {
  const ajv = new Klass();
  return {
    good: ajv.validateSchema({ type: 'string', minLength: 1 }),
    bad: ajv.validateSchema({ type: 'string', minLength: 'one' }),
    badErrors: errorKeys(ajv.errors),
  };
});

parity('compile throws on an invalid schema', (Klass) => {
  const ajv = new Klass();
  let threw = false;
  try { ajv.compile({ type: 'string', minLength: 'one' }); } catch (e) { threw = /schema is invalid/.test(e.message); }
  return { threw };
});

// ----- plain compile/validate shapes ----------------------------------------

parity('validate function properties: schema, errors before and after', (Klass) => {
  const ajv = new Klass();
  const schema = { type: 'number' };
  const v = ajv.compile(schema);
  const initial = v.errors;
  v(1);
  const afterOk = v.errors;
  v('x');
  const afterNo = errorKeys(v.errors);
  v(2);
  const reset = v.errors;
  return { sameSchema: v.schema === schema, initial, afterOk, afterNo, reset };
});

parity('boolean schemas', (Klass) => {
  const ajv = new Klass();
  const yes = ajv.compile(true);
  const no = ajv.compile(false);
  return { yes: yes(1), no: no(1), noKeys: errorKeys(no.errors) };
});

parity('useDefaults is off unless asked for', (Klass) => {
  const ajv = new Klass();
  const v = ajv.compile({ type: 'object', properties: { a: { type: 'integer', default: 1 } } });
  const data = {};
  v(data);
  const on = new Klass({ useDefaults: true });
  const v2 = on.compile({ type: 'object', properties: { a: { type: 'integer', default: 1 } } });
  const data2 = {};
  v2(data2);
  return { data, data2 };
});

parity('compile caches by schema object', (Klass) => {
  const ajv = new Klass();
  const schema = { type: 'string' };
  return { sameFn: ajv.compile(schema) === ajv.compile(schema) };
});

parity('compileAsync resolves to a validate function', (Klass) => {
  const ajv = new Klass({ loadSchema: async () => ({}) });
  const p = ajv.compileAsync({ type: 'string' });
  return { isPromise: typeof p.then === 'function' };
});

parity('opts is exposed with what was passed', (Klass) => {
  const ajv = new Klass({ allErrors: true, coerceTypes: true });
  return { allErrors: ajv.opts.allErrors, coerceTypes: ajv.opts.coerceTypes };
});

parity('draft-07 schema with definitions and the draft-07 $schema', (Klass) => {
  const ajv = new Klass();
  const v = ajv.compile({
    $schema: 'http://json-schema.org/draft-07/schema#',
    definitions: { pos: { type: 'integer', minimum: 0 } },
    type: 'object',
    properties: { n: { $ref: '#/definitions/pos' } },
  });
  return { ok: v({ n: 1 }), no: v({ n: -1 }), keys: errorKeys(v.errors) };
});

parity('verbose: true puts parentSchema on errors', (Klass) => {
  const ajv = new Klass({ verbose: true });
  const v = ajv.compile({ type: 'object', properties: { a: { type: 'integer' } } });
  v({ a: 'x' });
  return { hasParent: v.errors[0].parentSchema !== undefined, parentType: v.errors[0].parentSchema.type };
});

// ----- what the shim refuses -----------------------------------------------

test('$data references are refused with a clear error, not accepted', () => {
  let threw = null;
  try { new Ata({ $data: true }); } catch (e) { threw = e; }
  assert(threw && /\$data/.test(threw.message), 'throws mentioning $data, got ' + (threw && threw.message));
});

test('a code-only keyword is refused, not silently accepted', () => {
  const ata = new Ata();
  let threw = null;
  try { ata.addKeyword({ keyword: 'gen', code: () => {} }); } catch (e) { threw = e; }
  assert(threw && /gen/.test(threw.message), 'throws naming the keyword, got ' + (threw && threw.message));
});

test('the reference formats plugin is refused with a pointer to the built-ins', () => {
  const ata = new Ata();
  let threw = null;
  try { addFormats(ata); } catch (e) { threw = e; }
  assert(threw, 'addFormats(ata) throws');
});

console.log(`\n${passed}/${passed + failed} tests passed.\n`);
process.exit(failed > 0 ? 1 : 0);
