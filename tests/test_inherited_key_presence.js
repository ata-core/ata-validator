'use strict';

// Whether a property is present is an own-property question in JSON Schema:
// `required: ['toString']` is not satisfied by `{}`, whose `toString` comes
// from Object.prototype. The interpreted engine asks it with Object.hasOwn.
// The code generators asked it three other ways, `'k' in d`, `d.k !== undefined`
// and, in one place, not at all, and for a name on the prototype chain each
// of those answers yes. `{ type: 'object', required: ['toString'] }` accepted
// `{}` through isValidObject, and `dependentRequired` did through every entry
// point.
//
// The tier-0 validator, which answers the first calls of isValidObject, had a
// wider version of the same fault: a required name missing from `properties`
// was not checked at all, whatever the name, so `{ type: 'object', required:
// ['id'] }` accepted `{}`. The name `plain` below covers that.
//
// This checks every name on Object.prototype, plus `__proto__`, across the
// keywords that ask about presence, through every public entry point, against
// the interpreted engine. It also checks data whose prototype is not
// Object.prototype, where an inherited name can be anything.

const assert = require('assert');
const { Validator } = require('..');

const NAMES = [...Object.getOwnPropertyNames(Object.prototype), '__proto__', 'plain'];

const shapes = (k) => [
  [{ type: 'object', required: [k] }, [{}, { [k]: 1 }]],
  [{ required: [k] }, [{}]],
  [{ type: 'object', properties: { a: { type: 'string' } }, required: ['a', k] }, [{ a: 'x' }]],
  [{ type: 'object', properties: { [k]: { type: 'string' } }, required: [k] }, [{}]],
  [{ type: 'object', properties: { [k]: { type: 'string' } } }, [{}, { a: 1 }]],
  [{ type: 'object', properties: { [k]: { type: 'string', minLength: 2 } } }, [{}]],
  [{ dependentRequired: { a: [k] } }, [{ a: 1 }]],
  [{ type: 'object', dependentRequired: { [k]: ['z'] } }, [{}]],
  [{ type: 'object', dependentSchemas: { [k]: { required: ['z'] } } }, [{}]],
  [{ type: 'object', properties: { o: { type: 'object', required: [k] } } }, [{ o: {} }]],
  [{ type: 'array', items: { type: 'object', required: [k] } }, [[{}], [{ [k]: 1 }]]],
  [{ type: 'object', properties: { a: { type: 'number' } }, required: [k], additionalProperties: false }, [{}, { a: 1 }]],
];

// Keys a JSON literal can carry as own properties; __proto__ in a literal
// sets the prototype instead, so it is built with defineProperty.
function own(obj) {
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(own);
  const out = {};
  for (const k of Object.keys(obj)) Object.defineProperty(out, k, { value: own(obj[k]), enumerable: true, writable: true, configurable: true });
  return out;
}
function schemaCopy(s) {
  return own(JSON.parse(JSON.stringify(s, (k, v) => v), (k, v) => v));
}

let compared = 0, bad = 0;
const report = (m) => { bad++; if (process.env.ALLDIFF || bad <= 12) console.error(m); };
function entryPoints(schema, data) {
  const s = () => own(schema);
  const out = {};
  const run = (k, f) => { try { out[k] = f(); } catch (e) { out[k] = 'threw ' + e.message; } };
  run('interp', () => new Validator(s(), { engine: 'interpreter' }).validate(own(data)).valid);
  // The first calls take the tier-0 validator, later ones generated code;
  // both are compared.
  run('isValidObject, first call', () => new Validator(s()).isValidObject(own(data)));
  run('isValidObject', () => { const v = new Validator(s()); v.isValidObject(own(data)); v.isValidObject(own(data)); return v.isValidObject(own(data)); });
  run('validate', () => new Validator(s()).validate(own(data)).valid);
  run('validate, after a rejection', () => { const v = new Validator(s()); v.validate(7); v.validate(own(data)).errors; return v.validate(own(data)).valid; });
  run('validate().errors', () => { const r = new Validator(s()).validate(own(data)); r.errors; return r.valid; });
  return out;
}

for (const k of NAMES) {
  for (const [schema, datas] of shapes(k)) {
    for (const data of datas) {
      const out = entryPoints(schema, data);
      for (const [name, got] of Object.entries(out)) {
        if (name === 'interp') continue;
        compared++;
        if (got !== out.interp) report(`${name} says ${got}, interpreter ${out.interp}: ${JSON.stringify(schema)} on ${JSON.stringify(data)} (key ${k})`);
      }
    }
  }
}

// Data with a prototype of its own: an inherited `a` is not a present `a`.
{
  const proto = { a: 'inherited' };
  const cases = [
    [{ type: 'object', required: ['a'] }],
    [{ type: 'object', properties: { a: { type: 'number' } } }],
    [{ dependentRequired: { b: ['a'] } }],
  ];
  for (const [schema] of cases) {
    const make = () => { const d = Object.create(proto); d.b = 1; return d; };
    const want = new Validator(own(schema), { engine: 'interpreter' }).validate(make()).valid;
    const v = new Validator(own(schema));
    for (let i = 0; i < 3; i++) {
      compared++;
      const got = v.isValidObject(make());
      if (got !== want) report(`isValidObject says ${got}, interpreter ${want} on an object inheriting 'a': ${JSON.stringify(schema)}`);
    }
    compared++;
    if (new Validator(own(schema)).validate(make()).valid !== want) report(`validate disagrees on an object inheriting 'a': ${JSON.stringify(schema)}`);
  }
}

// The shape of the fix, not only its answers. Every node that asks about
// presence reads its object's prototype once into a local, and every key test
// in it reads that local. A key test that falls back to the shared helper,
// which reads the prototype itself, cost the error path a microsecond on a
// product document: the helper sees every object shape and is megamorphic.
{
  const jc = require('../lib/js-compiler');
  const VALID = Object.freeze({ valid: true, errors: Object.freeze([]) });
  const item = { type: 'object', properties: { id: { type: 'number' }, t: { type: 'string', minLength: 1 }, u: { type: 'string' } }, required: ['id', 't'] };
  const schema = { type: 'object', properties: { id: { type: 'number' }, name: { type: 'string' }, note: { type: 'string' }, items: { type: 'array', items: item } }, required: ['id', 'name'], dependentRequired: { note: ['name'] } };
  const sources = {
    verdict: jc.compileToJSCodegen(schema, null, undefined)._source,
    errors: jc.compileToJSCodegenWithErrors(schema, null, undefined)._errSource,
  };
  for (const [name, src] of Object.entries(sources)) {
    assert.ok(src && /_pk\d+/.test(src), `${name}: no per-object prototype flag was emitted`);
    compared++;
    if (/_ok\(/.test(src.replace(/function _ok\([^)]*\)\{[^}]*\}/g, ''))) report(`${name}: a key test reads the prototype through _ok instead of the node's flag`);
  }
}

assert.strictEqual(bad, 0, `${bad} disagreements on inherited property names`);
console.log(`ok: presence is an own-property question on every entry point, ${compared} comparisons`);
