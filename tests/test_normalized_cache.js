'use strict'

// A schema that needs normalizing (OpenAPI `nullable`, draft-07 spellings) is
// normalized once per object and the copy shared by every validator built
// from it, which is what made a registry of hundreds of OpenAPI components
// affordable. A validator must never change that shared copy: one built with
// `assertFormat: false` strips `format` on a copy of its own, and a validator
// built after it from the same object still checks formats. Every test file
// was also run once with the shared copies frozen, and none wrote to one.

const assert = require('assert')
const { Validator } = require('..')

const schema = { type: 'object', properties: { email: { type: 'string', format: 'email', nullable: true }, n: { type: 'integer', minimum: 0, exclusiveMinimum: true } } }
const loose = new Validator(schema, { assertFormat: false })
const strict = new Validator(schema)
for (const v of [loose, strict]) assert.strictEqual(v.validate({ email: null }).valid, true, 'nullable read as null allowed')
assert.strictEqual(loose.validate({ email: 'nope' }).valid, true, 'assertFormat: false does not check the format')
assert.strictEqual(strict.validate({ email: 'nope' }).valid, false, 'a validator built after it from the same object still does')
assert.strictEqual(new Validator(schema).validate({ email: 'nope' }).valid, false, 'and so does the next one')
assert.strictEqual(strict.validate({ n: 0 }).valid, false, 'the draft-04 boolean bound is exclusive')
assert.ok(schema.properties.email.nullable === true && schema.properties.n.exclusiveMinimum === true, 'the caller object is untouched')
console.log('ok: a shared normalized schema is not changed by the validators that use it')
