'use strict';

// The small Validator (lib/validator-small.js) loads the official meta-schemas
// when a reference names one. It skips asking for such a reference when the
// text's only `json-schema.org/` is the root's `$schema`. These hold that the
// skip changes no answer: a reference to a meta-schema is still found with a
// `$schema` beside it, and without one, and a `$schema` alone asks for nothing.

const assert = require('assert');
const { Validator } = require('../lib/validator-small.js');
// Every schema-decided group (lib/groups.js), as the full 2.0 entries register them.
require('../lib/validator-small.js').Validator.use(...require('../lib/features/groups.js').all)

const S2020 = 'https://json-schema.org/draft/2020-12/schema';
const S07 = 'http://json-schema.org/draft-07/schema#';

// Before the meta-schemas are registered, a schema that needs them says so,
// and one that does not builds.
const needs = (schema) => assert.throws(() => new Validator(schema).isValidObject({}), /metaschemas/, JSON.stringify(schema));
needs({ $schema: S2020, $ref: S2020 });
needs({ $ref: S2020 });
needs({ $schema: S07, properties: { a: { $ref: S07 } } });
needs({ $schema: S2020, $defs: { m: { $ref: 'https://json-schema.org/draft/2020-12/meta/core' } }, properties: { a: { $ref: '#/$defs/m' } } });
// `$schema` alone, and a `$schema` whose text names the host twice.
assert.strictEqual(new Validator({ $schema: S2020, type: 'string' }).isValidObject('x'), true);
assert.strictEqual(new Validator({ $schema: S2020, type: 'string' }).isValidObject(1), false);
assert.strictEqual(new Validator({ $schema: S07, type: 'integer' }).isValidObject(2), true);
assert.strictEqual(new Validator({ $schema: S2020, description: 'see json-schema.org/ for more', type: 'string' }).isValidObject('x'), true);

Validator.use(require('../lib/features/metaschemas.js').metaschemas);
for (const schema of [{ $schema: S2020, $ref: S2020 }, { $ref: S2020 }]) {
  const v = new Validator(schema);
  assert.strictEqual(v.isValidObject({ type: 'string' }), true, JSON.stringify(schema));
  assert.strictEqual(v.isValidObject({ type: 12 }), false, JSON.stringify(schema));
}
const v7 = new Validator({ $schema: S07, properties: { a: { $ref: S07 } } });
assert.strictEqual(v7.isValidObject({ a: { minimum: 1 } }), true);
assert.strictEqual(v7.isValidObject({ a: { minimum: 'x' } }), false);

// The same with the verdict core supplying the text, as an entry's class
// carries it (index.v2.edge.mjs). Its text names a reference to a meta-schema
// with a single `json-schema.org/`, so the skip must not read that text; the
// 2019-09 case is the suite's "validate definition against metaschema".
class Edge extends Validator {}
Edge.prototype.core = require('../lib/core/feature.js');
const S2019 = 'https://json-schema.org/draft/2019-09/schema';
const e19 = new Edge({ $schema: S2019, $ref: S2019 });
assert.strictEqual(e19.isValidObject({ $defs: { foo: { type: 'integer' } } }), true);
assert.strictEqual(e19.isValidObject({ $defs: { foo: { type: 1 } } }), false);
assert.strictEqual(e19.validate({ $defs: { foo: { type: 1 } } }).errors[0].keyword, 'anyOf');
for (const schema of [{ $schema: S2020, $ref: S2020 }, { $ref: S2020 }]) {
  const v = new Edge(schema);
  assert.strictEqual(v.isValidObject({ type: 'string' }), true, 'core: ' + JSON.stringify(schema));
  assert.strictEqual(v.isValidObject({ type: 12 }), false, 'core: ' + JSON.stringify(schema));
}
const e7 = new Edge({ $schema: S07, properties: { a: { $ref: S07 } } });
assert.strictEqual(e7.isValidObject({ a: { minimum: 'x' } }), false);
assert.strictEqual(new Edge({ $schema: S2020, type: 'string' }).isValidObject(1), false);

console.log('ok: a reference to a meta-schema is found with or without a root $schema, and a $schema alone needs none, with the JSON text and with the core\'s');
