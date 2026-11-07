'use strict';
// A schema node without any rare keyword is a LeafPlan, whose fields for
// those keywords are held on its prototype (lib/interpreter-core.js). A node
// that has one must be a full Plan, or its keyword would be read as absent
// and the document accepted. For every rare keyword: a schema whose only
// reason to reject the document is that keyword, nested under a property so
// the node is not the root, checked on the interpreted engine against the
// generated code, and the node's class checked directly.
const assert = require('assert');
const { Validator } = require('..');
const { createInterpreter } = require('../lib/interpreter.js');

const cases = {
  $ref: [{ $defs: { s: { type: 'string' } }, $ref: '#/$defs/s' }, 1],
  prefixItems: [{ prefixItems: [{ type: 'string' }] }, [1]],
  contains: [{ contains: { type: 'string' } }, [1]],
  minContains: [{ contains: { type: 'string' }, minContains: 2 }, ['a', 1]],
  maxContains: [{ contains: { type: 'string' }, maxContains: 1 }, ['a', 'b']],
  minProperties: [{ minProperties: 2 }, { a: 1 }],
  maxProperties: [{ maxProperties: 1 }, { a: 1, b: 2 }],
  dependentRequired: [{ dependentRequired: { a: ['b'] } }, { a: 1 }],
  propertyNames: [{ propertyNames: { maxLength: 1 } }, { ab: 1 }],
  patternProperties: [{ patternProperties: { '^x': { type: 'string' } } }, { x1: 1 }],
  dependentSchemas: [{ dependentSchemas: { a: { required: ['b'] } } }, { a: 1 }],
  propertyDependencies: [{ $schema: 'https://json-schema.org/v1', propertyDependencies: { k: { v: { required: ['b'] } } } }, { k: 'v' }],
  allOf: [{ allOf: [{ type: 'string' }] }, 1],
  anyOf: [{ anyOf: [{ type: 'string' }, { type: 'boolean' }] }, 1],
  oneOf: [{ oneOf: [{ type: 'string' }, { type: 'boolean' }] }, 1],
  not: [{ not: { type: 'integer' } }, 1],
  if: [{ if: { type: 'integer' }, then: { minimum: 5 } }, 1],
  else: [{ if: { type: 'string' }, else: { type: 'string' } }, 1],
  unevaluatedProperties: [{ properties: { a: true }, unevaluatedProperties: false }, { a: 1, b: 2 }],
  unevaluatedItems: [{ prefixItems: [true], unevaluatedItems: false }, [1, 2]],
};

let n = 0;
for (const [kw, [sub, bad]] of Object.entries(cases)) {
  const dialect = sub.$schema;
  const inner = { ...sub }; delete inner.$schema;
  const schema = { ...(dialect ? { $schema: dialect } : {}), type: 'object', properties: { p: inner } };
  const doc = { p: bad };
  const gen = new Validator(schema);
  const interp = new Validator(schema, { engine: 'interpreter' });
  assert.strictEqual(gen.validate(doc).valid, false, `${kw}: the generated code rejects`);
  for (let i = 0; i < 30; i++) assert.strictEqual(interp.isValidObject(doc), false, `${kw}: interpreter call ${i} rejects`);
  assert.strictEqual(interp.validate(doc).valid, false, `${kw}: interpreter validate() rejects`);
  const it = createInterpreter(inner, {});
  const plan = it.plans.get(inner);
  assert.ok(plan && plan.full === true, `${kw}: the node is a full Plan`);
  n++;
}
// A plain node is a LeafPlan and reads every rare field as absent.
const it = createInterpreter({ type: 'string', minLength: 1 }, {});
const leaf = [...it.plans.values()][0];
assert.strictEqual(leaf.full, false, 'a plain node is a LeafPlan');
assert.strictEqual(leaf.anyOf, null);
assert.strictEqual(leaf.contains, undefined);
assert.strictEqual(leaf.tracked, false);
assert.ok(!Object.hasOwn(leaf, 'anyOf'), 'the default lives on the prototype');
console.log(`ok: ${n} rare keywords each make a full Plan and are enforced; a plain node is a LeafPlan`);
