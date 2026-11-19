'use strict';

// The small Validator (lib/validator-small.js) loads the official meta-schemas
// when a reference names one. It skips asking for such a reference when the
// text's only `json-schema.org/` is the root's `$schema`. These hold that the
// skip changes no answer: a reference to a meta-schema is still found with a
// `$schema` beside it, and without one, and a `$schema` alone asks for nothing.

const assert = require('assert');
const { Validator } = require('../lib/validator-small.js');

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

console.log('ok: a reference to a meta-schema is found with or without a root $schema, and a $schema alone needs none');
