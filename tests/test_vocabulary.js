'use strict'

// `$vocabulary` decides which keywords a dialect has, and a keyword whose
// vocabulary is absent is an unknown keyword, so it does not apply.
//
// The failure mode worth pinning is the quiet one. A schema written against a
// meta-schema with no validation vocabulary still looks like it constrains
// things, and if the constraint is applied anyway nothing errors, the document
// is simply rejected for a reason the dialect never gave. So most of these
// assert that something is accepted.

const assert = require('assert')
const { Validator } = require('../index.js')
const { enabledKeywords } = require('../lib/vocabularies')

let passed = 0
function check(name, fn) {
  fn()
  console.log(`  PASS  ${name}`)
  passed++
}

const NO_VALIDATION = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'http://example.com/meta/no-validation',
  $vocabulary: {
    'https://json-schema.org/draft/2020-12/vocab/applicator': true,
    'https://json-schema.org/draft/2020-12/vocab/core': true,
  },
  $dynamicAnchor: 'meta',
}

const OPTIONAL_UNKNOWN = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'http://example.com/meta/optional-unknown',
  $vocabulary: {
    'https://json-schema.org/draft/2020-12/vocab/validation': true,
    'https://json-schema.org/draft/2020-12/vocab/core': true,
    'http://example.com/vocab/nobody-knows': false,
  },
  $dynamicAnchor: 'meta',
}

const REQUIRED_UNKNOWN = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'http://example.com/meta/required-unknown',
  $vocabulary: {
    'https://json-schema.org/draft/2020-12/vocab/core': true,
    'http://example.com/vocab/nobody-knows': true,
  },
  $dynamicAnchor: 'meta',
}

const against = (metaschema, schema) =>
  new Validator(
    { $schema: metaschema.$id, ...schema },
    { schemas: [metaschema] },
  )

check('a validation keyword does not apply without its vocabulary', () => {
  const v = against(NO_VALIDATION, { minimum: 10 })
  assert.strictEqual(v.validate(1).valid, true, '1 is under the minimum, but there is no minimum')
  assert.strictEqual(v.validate(50).valid, true)
})

check('an applicator still applies alongside it', () => {
  const v = against(NO_VALIDATION, {
    properties: { bad: false, n: { minimum: 10 } },
  })
  assert.strictEqual(v.validate({ bad: 1 }).valid, false, 'properties is applicator, and false rejects')
  assert.strictEqual(v.validate({ n: 1 }).valid, true, 'minimum inside it is still gone')
  assert.strictEqual(v.validate({}).valid, true)
})

check('a validation keyword nested in an applicator goes too', () => {
  const v = against(NO_VALIDATION, {
    allOf: [{ type: 'string' }, { properties: { a: { maxLength: 1 } } }],
  })
  assert.strictEqual(v.validate({ a: 'long' }).valid, true)
  assert.strictEqual(v.validate(37).valid, true, 'type is validation, so it does not apply')
})

check('an unrecognized optional vocabulary is ignored', () => {
  const v = against(OPTIONAL_UNKNOWN, { type: 'number' })
  assert.strictEqual(v.validate(20).valid, true)
  assert.strictEqual(v.validate('foobar').valid, false, 'validation is present, so type applies')
})

check('a required vocabulary ata does not know changes nothing', () => {
  // Not the specification's answer, which is to refuse the schema. Stated
  // rather than silently split the difference: ata evaluates it as it always
  // has, with every keyword applied.
  const v = against(REQUIRED_UNKNOWN, { type: 'number', minimum: 10 })
  assert.strictEqual(v.validate(20).valid, true)
  assert.strictEqual(v.validate(1).valid, false, 'minimum still applied')
  assert.strictEqual(v.validate('x').valid, false, 'type still applied')
})

check('a meta-schema with no $vocabulary changes nothing', () => {
  const plain = {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $id: 'http://example.com/meta/plain',
  }
  const v = against(plain, { minimum: 10 })
  assert.strictEqual(v.validate(1).valid, false)
})

check('the standard dialect is untouched', () => {
  const v = new Validator({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    type: 'integer',
    minimum: 10,
  })
  assert.strictEqual(v.validate(20).valid, true)
  assert.strictEqual(v.validate(1).valid, false)
  assert.strictEqual(v.validate('x').valid, false)
})

check('an unresolvable $schema changes nothing', () => {
  const v = new Validator({
    $schema: 'http://example.com/meta/never-registered',
    minimum: 10,
  })
  assert.strictEqual(v.validate(1).valid, false, 'no meta-schema, no answer, no change')
})

check('a subschema naming its own $schema keeps its own dialect', () => {
  const v = against(NO_VALIDATION, {
    $defs: {
      other: {
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        minimum: 10,
      },
    },
    properties: { n: { $ref: '#/$defs/other' } },
  })
  assert.strictEqual(v.validate({ n: 1 }).valid, false, 'that resource is standard 2020-12')
  assert.strictEqual(v.validate({ n: 20 }).valid, true)
})

check('a meta-schema registered by addSchema() counts too', () => {
  // addSchema() is legal right up until compilation, so the answer cannot be
  // worked out in the constructor.
  const v = new Validator({ $schema: NO_VALIDATION.$id, minimum: 10 })
  v.addSchema(NO_VALIDATION)
  assert.strictEqual(v.validate(1).valid, true)
})

check('the caller\'s schema object is not mutated', () => {
  const schema = { $schema: NO_VALIDATION.$id, minimum: 10, properties: { a: { maximum: 3 } } }
  const before = JSON.stringify(schema)
  new Validator(schema, { schemas: [NO_VALIDATION] }).validate(1)
  assert.strictEqual(JSON.stringify(schema), before)
})

check('the keyword lists come from the vendored meta-schemas', () => {
  // If these drift, every case above is asserting against a fiction.
  const enabled = enabledKeywords(NO_VALIDATION)
  assert.ok(enabled.has('properties'), 'applicator')
  assert.ok(enabled.has('$ref'), 'core is always there')
  assert.ok(!enabled.has('minimum'), 'validation is not')
  assert.ok(!enabled.has('type'), 'type is validation, not core')
  assert.strictEqual(enabledKeywords(OPTIONAL_UNKNOWN).has('minimum'), true)
  assert.strictEqual(enabledKeywords(REQUIRED_UNKNOWN), null)
})

console.log(`\n${passed} passed`)
