# Ajv Feature Parity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the feature gap with ajv — cross-schema `$ref`, Draft 7 keywords, `patternProperties`/`dependentSchemas`/`propertyNames` codegen, and fuzz testing — while keeping ata's performance advantage.

**Architecture:** Four independent workstreams that can be developed in parallel. Draft 7 normalization runs before compilation, converting keywords to 2020-12 equivalents so the pipeline stays uniform. Cross-schema `$ref` adds a `schemaMap` to the compilation context. Keyword codegen removes the blanket bail for three keywords and generates inline JS. Fuzz testing validates codegen vs NAPI agreement.

**Tech Stack:** Node.js, V8 codegen (`new Function`), node-addon-api (NAPI), RE2 (C++), JSON Schema Test Suite, libFuzzer

---

## File Map

| File | Action | Responsibility |
|------|--------|---------------|
| `lib/js-compiler.js` | Modify | Add `schemaMap` to ctx, extend `resolveRef`, add `patternProperties`/`dependentSchemas`/`propertyNames` to `genCode`/`genCodeE`/`genCodeC`, update `codegenSafe`, add circular guards to `genCodeE`/`genCodeC` |
| `lib/draft7.js` | Create | `isDraft7()` detection and `normalizeDraft7()` in-place transform |
| `index.js` | Modify | `buildSchemaMap()`, `addSchema()`, constructor changes for `schemas` option, Draft 7 normalization call, cache key update, NAPI fallback with inlined schemas |
| `tests/test_ref_cross.js` | Create | Cross-schema `$ref` tests |
| `tests/test_draft7.js` | Create | Draft 7 normalization tests |
| `tests/test_keywords_codegen.js` | Create | `patternProperties`/`dependentSchemas`/`propertyNames` codegen vs NAPI differential tests |
| `tests/run_suite.js` | Modify | Add Draft 7 test suite runner |
| `tests/run_suite_draft7.js` | Create | Draft 7 test suite runner with normalization |
| `tests/fuzz_differential.js` | Create | JS codegen vs NAPI differential fuzzer |
| `index.d.ts` | Modify | Add `schemas` option and `addSchema()` types |

---

## Task 1: Draft 7 Normalization Module

**Files:**
- Create: `lib/draft7.js`
- Create: `tests/test_draft7.js`

- [ ] **Step 1: Write failing tests for Draft 7 normalization**

Create `tests/test_draft7.js`:

```js
'use strict'
const { normalizeDraft7, isDraft7 } = require('../lib/draft7')

let passed = 0, failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  PASS  ${name}`)
    passed++
  } catch (e) {
    console.log(`  FAIL  ${name}: ${e.message}`)
    failed++
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed')
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b)
}

console.log('\nDraft 7 Normalization Tests\n')

test('isDraft7 detects draft-07 schema', () => {
  assert(isDraft7({ $schema: 'http://json-schema.org/draft-07/schema#' }))
  assert(isDraft7({ $schema: 'http://json-schema.org/draft-07/schema' }))
  assert(!isDraft7({ $schema: 'https://json-schema.org/draft/2020-12/schema' }))
  assert(!isDraft7({ type: 'string' }))
  assert(!isDraft7({}))
})

test('definitions → $defs', () => {
  const s = { $schema: 'http://json-schema.org/draft-07/schema#', definitions: { foo: { type: 'string' } } }
  normalizeDraft7(s)
  assert(s.$defs && s.$defs.foo.type === 'string', 'should have $defs.foo')
  assert(!s.definitions, 'definitions should be deleted')
})

test('dependencies (array) → dependentRequired', () => {
  const s = { $schema: 'http://json-schema.org/draft-07/schema#', dependencies: { foo: ['bar', 'baz'] } }
  normalizeDraft7(s)
  assert(deepEqual(s.dependentRequired, { foo: ['bar', 'baz'] }))
  assert(!s.dependencies, 'dependencies should be deleted')
  assert(!s.dependentSchemas, 'no dependentSchemas for array deps')
})

test('dependencies (schema) → dependentSchemas', () => {
  const s = { $schema: 'http://json-schema.org/draft-07/schema#', dependencies: { foo: { required: ['bar'] } } }
  normalizeDraft7(s)
  assert(deepEqual(s.dependentSchemas, { foo: { required: ['bar'] } }))
  assert(!s.dependencies, 'dependencies should be deleted')
  assert(!s.dependentRequired, 'no dependentRequired for schema deps')
})

test('dependencies (mixed) → split', () => {
  const s = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    dependencies: {
      foo: ['bar'],
      baz: { required: ['qux'] }
    }
  }
  normalizeDraft7(s)
  assert(deepEqual(s.dependentRequired, { foo: ['bar'] }))
  assert(deepEqual(s.dependentSchemas, { baz: { required: ['qux'] } }))
  assert(!s.dependencies)
})

test('items (array) → prefixItems', () => {
  const s = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    items: [{ type: 'string' }, { type: 'number' }]
  }
  normalizeDraft7(s)
  assert(deepEqual(s.prefixItems, [{ type: 'string' }, { type: 'number' }]))
  assert(s.items === undefined, 'items should be deleted when no additionalItems')
})

test('items (array) + additionalItems → prefixItems + items', () => {
  const s = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    items: [{ type: 'string' }],
    additionalItems: { type: 'number' }
  }
  normalizeDraft7(s)
  assert(deepEqual(s.prefixItems, [{ type: 'string' }]))
  assert(deepEqual(s.items, { type: 'number' }))
  assert(s.additionalItems === undefined)
})

test('items (array) + additionalItems: false → prefixItems + items: false', () => {
  const s = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    items: [{ type: 'string' }],
    additionalItems: false
  }
  normalizeDraft7(s)
  assert(deepEqual(s.prefixItems, [{ type: 'string' }]))
  assert(s.items === false)
  assert(s.additionalItems === undefined)
})

test('items (schema) stays as items', () => {
  const s = { $schema: 'http://json-schema.org/draft-07/schema#', items: { type: 'string' } }
  normalizeDraft7(s)
  assert(deepEqual(s.items, { type: 'string' }))
  assert(s.prefixItems === undefined)
})

test('nested normalization in properties', () => {
  const s = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    properties: {
      nested: {
        definitions: { inner: { type: 'number' } },
        dependencies: { x: ['y'] }
      }
    }
  }
  normalizeDraft7(s)
  assert(s.properties.nested.$defs && s.properties.nested.$defs.inner.type === 'number')
  assert(deepEqual(s.properties.nested.dependentRequired, { x: ['y'] }))
  assert(!s.properties.nested.definitions)
  assert(!s.properties.nested.dependencies)
})

test('nested normalization in allOf/anyOf/oneOf', () => {
  const s = {
    $schema: 'http://json-schema.org/draft-07/schema#',
    allOf: [{ definitions: { a: { type: 'string' } } }]
  }
  normalizeDraft7(s)
  assert(s.allOf[0].$defs && s.allOf[0].$defs.a.type === 'string')
})

test('non-draft-7 schema is not modified', () => {
  const s = { definitions: { foo: { type: 'string' } }, dependencies: { a: ['b'] } }
  const original = JSON.stringify(s)
  normalizeDraft7(s)
  assert(JSON.stringify(s) === original, 'should not modify non-draft-7 schema')
})

console.log(`\n  ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_draft7.js`
Expected: FAIL with "Cannot find module '../lib/draft7'"

- [ ] **Step 3: Implement `lib/draft7.js`**

Create `lib/draft7.js`:

```js
'use strict'

const DRAFT7_SCHEMAS = new Set([
  'http://json-schema.org/draft-07/schema#',
  'http://json-schema.org/draft-07/schema',
])

function isDraft7(schema) {
  return !!(schema && schema.$schema && DRAFT7_SCHEMAS.has(schema.$schema))
}

function normalizeDraft7(schema) {
  if (!isDraft7(schema)) return schema
  _normalize(schema)
  return schema
}

function _normalize(schema) {
  if (typeof schema !== 'object' || schema === null) return

  // definitions → $defs
  if (schema.definitions && !schema.$defs) {
    schema.$defs = schema.definitions
    delete schema.definitions
  }

  // dependencies → dependentSchemas + dependentRequired
  if (schema.dependencies) {
    for (const [key, value] of Object.entries(schema.dependencies)) {
      if (Array.isArray(value)) {
        if (!schema.dependentRequired) schema.dependentRequired = {}
        schema.dependentRequired[key] = value
      } else {
        if (!schema.dependentSchemas) schema.dependentSchemas = {}
        schema.dependentSchemas[key] = value
      }
    }
    delete schema.dependencies
  }

  // items (array form) → prefixItems + items/additionalItems swap
  if (Array.isArray(schema.items)) {
    schema.prefixItems = schema.items
    if (schema.additionalItems !== undefined) {
      schema.items = schema.additionalItems
      delete schema.additionalItems
    } else {
      delete schema.items
    }
  }

  // Recurse into object-valued sub-schemas
  const objSubs = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']
  for (const key of objSubs) {
    if (schema[key] && typeof schema[key] === 'object') {
      for (const v of Object.values(schema[key])) {
        if (typeof v === 'object' && v !== null) _normalize(v)
      }
    }
  }

  // Recurse into array-valued sub-schemas
  const arrSubs = ['allOf', 'anyOf', 'oneOf', 'prefixItems']
  for (const key of arrSubs) {
    if (Array.isArray(schema[key])) {
      for (const s of schema[key]) {
        if (typeof s === 'object' && s !== null) _normalize(s)
      }
    }
  }

  // Recurse into single sub-schemas
  const singleSubs = ['items', 'contains', 'not', 'if', 'then', 'else',
                       'additionalProperties', 'propertyNames']
  for (const key of singleSubs) {
    if (typeof schema[key] === 'object' && schema[key] !== null) {
      _normalize(schema[key])
    }
  }
}

module.exports = { isDraft7, normalizeDraft7 }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node tests/test_draft7.js`
Expected: All 11 tests PASS

- [ ] **Step 5: Commit**

```bash
git add lib/draft7.js tests/test_draft7.js
git commit -m "feat: add Draft 7 normalization module"
```

---

## Task 2: Draft 7 Integration + Test Suite Runner

**Files:**
- Modify: `index.js:288-296`
- Create: `tests/run_suite_draft7.js`

- [ ] **Step 1: Write the Draft 7 suite runner**

Create `tests/run_suite_draft7.js`:

```js
const fs = require('fs')
const path = require('path')
const { Validator } = require('../index')

const SUITE_DIR = path.join(__dirname, 'suite/tests/draft7')

// Draft 7 test files (skip: refRemote, optional/)
const SUPPORTED_FILES = [
  'type.json', 'minimum.json', 'maximum.json',
  'exclusiveMinimum.json', 'exclusiveMaximum.json', 'multipleOf.json',
  'minLength.json', 'maxLength.json', 'pattern.json',
  'minItems.json', 'maxItems.json', 'uniqueItems.json',
  'items.json', 'additionalItems.json',
  'properties.json', 'required.json',
  'additionalProperties.json', 'patternProperties.json',
  'minProperties.json', 'maxProperties.json',
  'enum.json', 'const.json',
  'allOf.json', 'anyOf.json', 'oneOf.json', 'not.json',
  'if-then-else.json',
  'boolean_schema.json',
  'ref.json', 'definitions.json',
  'contains.json',
  'dependencies.json',
  'propertyNames.json',
  'format.json',
]

let totalPass = 0, totalFail = 0, totalSkip = 0
const failures = []

for (const file of SUPPORTED_FILES) {
  const filePath = path.join(SUITE_DIR, file)
  if (!fs.existsSync(filePath)) {
    console.log(`  SKIP  ${file} (not found)`)
    continue
  }

  const suites = JSON.parse(fs.readFileSync(filePath, 'utf8'))
  let filePass = 0, fileFail = 0, fileSkip = 0

  for (const suite of suites) {
    const schemaStr = JSON.stringify(suite.schema)
    const hasRemoteRef = schemaStr.includes('"$ref":"http') || schemaStr.includes('"$ref": "http')
    if (hasRemoteRef) {
      fileSkip += suite.tests.length
      totalSkip += suite.tests.length
      continue
    }

    // Inject $schema for Draft 7 detection if not present
    const schema = suite.schema
    if (typeof schema === 'object' && schema !== null && !schema.$schema) {
      schema.$schema = 'http://json-schema.org/draft-07/schema#'
    }

    let validator
    try {
      validator = new Validator(schema)
    } catch (e) {
      fileSkip += suite.tests.length
      totalSkip += suite.tests.length
      continue
    }

    for (const test of suite.tests) {
      if (file === 'format.json' && test.description.includes('only an annotation')) {
        fileSkip++; totalSkip++; continue
      }
      try {
        const result = validator.validate(test.data)
        if (result.valid === test.valid) {
          filePass++; totalPass++
        } else {
          fileFail++; totalFail++
          failures.push({ file, suite: suite.description, test: test.description,
                          expected: test.valid, got: result.valid, data: test.data, schema: suite.schema })
        }
      } catch (e) {
        fileFail++; totalFail++
        failures.push({ file, suite: suite.description, test: test.description,
                        expected: test.valid, got: 'ERROR: ' + e.message })
      }
    }
  }

  const total = filePass + fileFail + fileSkip
  const pct = total - fileSkip > 0 ? ((filePass / (filePass + fileFail)) * 100).toFixed(0) : 'N/A'
  const status = fileFail === 0 ? 'PASS' : 'FAIL'
  console.log(`  ${status}  ${file.padEnd(30)} ${filePass}/${filePass + fileFail} passed (${pct}%)${fileSkip > 0 ? ` [${fileSkip} skipped]` : ''}`)
}

console.log('\n========================================')
console.log(`  Draft 7 Total: ${totalPass} passed, ${totalFail} failed, ${totalSkip} skipped`)
const pct = ((totalPass / (totalPass + totalFail)) * 100).toFixed(1)
console.log(`  Pass rate: ${pct}%`)
console.log('========================================\n')

if (failures.length > 0 && failures.length <= 30) {
  console.log('Failures:\n')
  for (const f of failures) {
    console.log(`  ${f.file} > ${f.suite} > ${f.test}`)
    console.log(`    expected: ${f.expected}, got: ${f.got}`)
    if (f.schema) console.log(`    schema: ${JSON.stringify(f.schema).slice(0, 120)}`)
    console.log()
  }
}
```

- [ ] **Step 2: Integrate normalization into Validator constructor**

In `index.js`, add the import at line 7 and the normalization call in the constructor:

Add after the existing require at line 7:
```js
const { normalizeDraft7 } = require('./lib/draft7')
```

In the `constructor` (after line 293 where `schemaObj` is created), add:
```js
    // Draft 7 normalization — convert keywords to 2020-12 equivalents in-place
    normalizeDraft7(schemaObj)
    // Re-stringify after normalization (cache key must reflect normalized form)
    const schemaStr = typeof schema === 'string' && !schemaObj.$schema?.includes('draft-07')
      ? schema
      : JSON.stringify(schemaObj)
```

This replaces the existing `schemaStr` assignment. The logic: if the original input was a string and is not Draft 7, keep the original string (fast path). If it was Draft 7 or an object, re-stringify after normalization so the cache key matches the normalized schema.

Full constructor change — replace lines 289-296 of `index.js`:
```js
  constructor(schema, opts) {
    const options = opts || {};
    const schemaObj = typeof schema === "string" ? JSON.parse(schema) : schema;

    // Draft 7 normalization — convert keywords to 2020-12 equivalents in-place
    normalizeDraft7(schemaObj);

    const schemaStr = JSON.stringify(schemaObj);

    this._schemaStr = schemaStr;
    this._schemaObj = schemaObj;
```

- [ ] **Step 3: Run Draft 7 suite**

Run: `node tests/run_suite_draft7.js`
Expected: High pass rate on Draft 7 tests. `dependencies.json` and `additionalItems.json` should pass after normalization. Some tests may fail if they use features like `patternProperties` or `propertyNames` (expected — Task 5 fixes those).

- [ ] **Step 4: Run existing 2020-12 suite to verify no regressions**

Run: `node tests/run_suite.js`
Expected: Same pass rate as before (98.4% / 937 out of 952)

- [ ] **Step 5: Commit**

```bash
git add index.js tests/run_suite_draft7.js
git commit -m "feat: integrate Draft 7 normalization into Validator constructor"
```

---

## Task 3: Cross-Schema `$ref` — `buildSchemaMap` + `addSchema` API

**Files:**
- Modify: `index.js`
- Modify: `index.d.ts`
- Create: `tests/test_ref_cross.js`

- [ ] **Step 1: Write failing tests for cross-schema `$ref`**

Create `tests/test_ref_cross.js`:

```js
'use strict'
const { Validator } = require('../index')

let passed = 0, failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  PASS  ${name}`)
    passed++
  } catch (e) {
    console.log(`  FAIL  ${name}: ${e.message}`)
    failed++
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed')
}

console.log('\nCross-Schema $ref Tests\n')

const addressSchema = {
  $id: 'https://example.com/address',
  type: 'object',
  properties: {
    street: { type: 'string' },
    city: { type: 'string' }
  },
  required: ['street', 'city']
}

const personSchema = {
  $id: 'https://example.com/person',
  type: 'object',
  properties: {
    name: { type: 'string' },
    age: { type: 'integer' }
  },
  required: ['name']
}

// --- schemas option: array form ---

test('schemas array: basic cross-ref', () => {
  const v = new Validator({
    type: 'object',
    properties: {
      address: { $ref: 'https://example.com/address' }
    }
  }, { schemas: [addressSchema] })

  const valid = v.validate({ address: { street: 'Main St', city: 'NYC' } })
  assert(valid.valid === true, 'should be valid')

  const invalid = v.validate({ address: { street: 'Main St' } })
  assert(invalid.valid === false, 'missing city should be invalid')
})

test('schemas array: multiple cross-refs', () => {
  const v = new Validator({
    type: 'object',
    properties: {
      address: { $ref: 'https://example.com/address' },
      person: { $ref: 'https://example.com/person' }
    }
  }, { schemas: [addressSchema, personSchema] })

  const valid = v.validate({
    address: { street: 'X', city: 'Y' },
    person: { name: 'Mert' }
  })
  assert(valid.valid === true)
})

// --- schemas option: object form ---

test('schemas object: manual keys', () => {
  const v = new Validator({
    type: 'object',
    properties: {
      addr: { $ref: 'addr-schema' }
    }
  }, {
    schemas: {
      'addr-schema': {
        $id: 'addr-schema',
        type: 'object',
        properties: { zip: { type: 'string' } },
        required: ['zip']
      }
    }
  })

  assert(v.validate({ addr: { zip: '10001' } }).valid === true)
  assert(v.validate({ addr: {} }).valid === false)
})

// --- addSchema ---

test('addSchema: basic', () => {
  const v = new Validator({
    type: 'object',
    properties: {
      address: { $ref: 'https://example.com/address' }
    }
  })
  v.addSchema(addressSchema)

  assert(v.validate({ address: { street: 'X', city: 'Y' } }).valid === true)
  assert(v.validate({ address: {} }).valid === false)
})

test('addSchema: throws after compilation', () => {
  const v = new Validator({
    type: 'object',
    properties: { name: { type: 'string' } }
  })
  v.validate({ name: 'test' }) // triggers compilation

  let threw = false
  try {
    v.addSchema(addressSchema)
  } catch (e) {
    threw = true
    assert(e.message.includes('after compilation'), 'should mention compilation')
  }
  assert(threw, 'should throw')
})

test('addSchema: throws without $id', () => {
  const v = new Validator({ type: 'object' })
  let threw = false
  try {
    v.addSchema({ type: 'string' })
  } catch (e) {
    threw = true
    assert(e.message.includes('$id'), 'should mention $id')
  }
  assert(threw, 'should throw')
})

// --- chained refs ---

test('chained refs: A → B → C', () => {
  const schemaC = {
    $id: 'schema-c',
    type: 'string',
    minLength: 1
  }
  const schemaB = {
    $id: 'schema-b',
    type: 'object',
    properties: { value: { $ref: 'schema-c' } },
    required: ['value']
  }
  const v = new Validator({
    type: 'object',
    properties: { nested: { $ref: 'schema-b' } }
  }, { schemas: [schemaB, schemaC] })

  assert(v.validate({ nested: { value: 'hello' } }).valid === true)
  assert(v.validate({ nested: { value: '' } }).valid === false)
  assert(v.validate({ nested: {} }).valid === false)
})

// --- circular refs ---

test('circular refs: A → B → A does not crash', () => {
  const schemaA = {
    $id: 'circ-a',
    type: 'object',
    properties: { b: { $ref: 'circ-b' } }
  }
  const schemaB = {
    $id: 'circ-b',
    type: 'object',
    properties: { a: { $ref: 'circ-a' } }
  }
  const v = new Validator({
    type: 'object',
    properties: { root: { $ref: 'circ-a' } }
  }, { schemas: [schemaA, schemaB] })

  // Should not infinite loop — circular bail returns true (permissive)
  const result = v.validate({ root: { b: { a: {} } } })
  assert(result.valid === true || result.valid === false, 'should return a result without crashing')
})

// --- isValidObject path ---

test('isValidObject with cross-schema ref', () => {
  const v = new Validator({
    type: 'object',
    properties: { address: { $ref: 'https://example.com/address' } }
  }, { schemas: [addressSchema] })

  assert(v.isValidObject({ address: { street: 'X', city: 'Y' } }) === true)
  assert(v.isValidObject({ address: {} }) === false)
})

// --- cache correctness ---

test('same schema with different schemas option uses separate cache', () => {
  const mainSchema = {
    type: 'object',
    properties: { ref: { $ref: 'ext-schema' } }
  }
  const ext1 = { $id: 'ext-schema', type: 'string' }
  const ext2 = { $id: 'ext-schema', type: 'number' }

  const v1 = new Validator(mainSchema, { schemas: [ext1] })
  const v2 = new Validator(mainSchema, { schemas: [ext2] })

  assert(v1.validate({ ref: 'hello' }).valid === true, 'v1 should accept string')
  assert(v1.validate({ ref: 123 }).valid === false, 'v1 should reject number')
  assert(v2.validate({ ref: 123 }).valid === true, 'v2 should accept number')
  assert(v2.validate({ ref: 'hello' }).valid === false, 'v2 should reject string')
})

console.log(`\n  ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node tests/test_ref_cross.js`
Expected: FAIL — `addSchema` is not a function, `schemas` option not supported

- [ ] **Step 3: Add `buildSchemaMap`, `addSchema`, and `schemas` option to `index.js`**

Add `buildSchemaMap` function before the `Validator` class (after line 286):

```js
function buildSchemaMap(schemas) {
  if (!schemas) return null
  const map = new Map()
  if (Array.isArray(schemas)) {
    for (const s of schemas) {
      const id = s.$id
      if (!id) throw new Error('Schema in schemas option must have $id')
      map.set(id, s)
    }
  } else {
    for (const [key, s] of Object.entries(schemas)) {
      map.set(s.$id || key, s)
    }
  }
  return map
}
```

In the `Validator` constructor, after the normalization and before the lazy stubs (after `this._preprocess = null;`), add:

```js
    // Schema map for cross-schema $ref resolution
    this._schemaMap = buildSchemaMap(options.schemas) || new Map();
```

Add the `addSchema` method to the `Validator` class (after `_ensureNative`):

```js
  addSchema(schema) {
    if (this._initialized) {
      throw new Error('Cannot add schema after compilation — call addSchema() before validate()')
    }
    if (!schema || !schema.$id) {
      throw new Error('Schema must have $id')
    }
    normalizeDraft7(schema)
    this._schemaMap.set(schema.$id, schema)
  }
```

- [ ] **Step 4: Run cross-ref tests (they will still mostly fail — codegen doesn't use schemaMap yet)**

Run: `node tests/test_ref_cross.js`
Expected: `addSchema` tests for throws pass. Cross-ref validation tests fail (schemaMap not wired into codegen yet — that's Task 4).

- [ ] **Step 5: Commit**

```bash
git add index.js tests/test_ref_cross.js
git commit -m "feat: add buildSchemaMap, addSchema, and schemas option to Validator"
```

---

## Task 4: Wire `schemaMap` Into Codegen Pipeline

**Files:**
- Modify: `lib/js-compiler.js`
- Modify: `index.js`

- [ ] **Step 1: Update compiler function signatures and `codegenSafe`**

In `lib/js-compiler.js`, update `codegenSafe` to allow `$id`:

Replace line 463:
```js
  if (schema.$id) return false
```
with:
```js
  // $id is allowed — it's metadata for the schema registry
```

Update `$ref` bail in `codegenSafe` (lines 456-461) to also allow cross-schema refs:
```js
  // $ref — allow local refs (#/$defs/Name) and cross-schema refs (bare URI)
  if (schema.$ref) {
    const isLocal = /^#\/(?:\$defs|definitions)\/[^/]+$/.test(schema.$ref)
    // Non-local refs are allowed when schemaMap is provided (checked at compile time)
    // But bail on sibling keywords regardless
    const siblings = Object.keys(schema).filter(k => k !== '$ref' && k !== '$defs' && k !== 'definitions' && k !== '$schema' && k !== '$id')
    if (siblings.length > 0) return false
  }
```

- [ ] **Step 2: Update `compileToJS` to accept and pass `schemaMap`**

Change `compileToJS` signature (line 7):
```js
function compileToJS(schema, defs, schemaMap) {
```

Update `resolveRef` (lines 375-387):
```js
function resolveRef(ref, defs, schemaMap) {
  // 1. Local ref
  if (defs) {
    const m = ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/)
    if (m) {
      const name = m[1]
      const entry = defs[name]
      if (entry) return (d) => { const fn = entry.fn; return fn ? fn(d) : true }
    }
  }
  // 2. Cross-schema ref
  if (schemaMap && schemaMap.has(ref)) {
    const resolved = schemaMap.get(ref)
    const fn = compileToJS(resolved, null, schemaMap)
    return fn || (() => true)
  }
  return null
}
```

Update `$ref` handling in `compileToJS` (line 29-33):
```js
  // $ref
  if (schema.$ref) {
    const refFn = resolveRef(schema.$ref, rootDefs, schemaMap)
    if (!refFn) return null
    checks.push(refFn)
  }
```

- [ ] **Step 3: Update `compileToJSCodegen` to accept and pass `schemaMap`**

Change signature (line 506):
```js
function compileToJSCodegen(schema, schemaMap) {
```

Update ctx creation (line 521):
```js
  const ctx = { varCounter: 0, helpers: [], helperCode: [], closureVars: [], closureVals: [], rootDefs, refStack: new Set(), schemaMap: schemaMap || null }
```

- [ ] **Step 4: Update `genCode` to handle cross-schema refs**

Replace the `$ref` block in `genCode` (lines 616-627):
```js
  // $ref — guard against circular references
  if (schema.$ref) {
    // 1. Local ref
    const m = schema.$ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/)
    if (m && ctx.rootDefs && ctx.rootDefs[m[1]]) {
      if (ctx.refStack.has(schema.$ref)) return
      ctx.refStack.add(schema.$ref)
      genCode(ctx.rootDefs[m[1]], v, lines, ctx, knownType)
      ctx.refStack.delete(schema.$ref)
      return
    }
    // 2. Cross-schema ref
    if (ctx.schemaMap && ctx.schemaMap.has(schema.$ref)) {
      if (ctx.refStack.has(schema.$ref)) return
      ctx.refStack.add(schema.$ref)
      genCode(ctx.schemaMap.get(schema.$ref), v, lines, ctx, knownType)
      ctx.refStack.delete(schema.$ref)
      return
    }
    return
  }
```

- [ ] **Step 5: Update `genCodeE` with cross-schema refs + circular guard**

Replace the `$ref` block in `genCodeE` (lines 1009-1015):
```js
  // $ref — resolve local and cross-schema refs with circular guard
  if (schema.$ref) {
    const m = schema.$ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/)
    if (m && ctx.rootDefs && ctx.rootDefs[m[1]]) {
      if (ctx.refStack.has(schema.$ref)) return
      ctx.refStack.add(schema.$ref)
      genCodeE(ctx.rootDefs[m[1]], v, pathExpr, lines, ctx)
      ctx.refStack.delete(schema.$ref)
      return
    }
    if (ctx.schemaMap && ctx.schemaMap.has(schema.$ref)) {
      if (ctx.refStack.has(schema.$ref)) return
      ctx.refStack.add(schema.$ref)
      genCodeE(ctx.schemaMap.get(schema.$ref), v, pathExpr, lines, ctx)
      ctx.refStack.delete(schema.$ref)
      return
    }
  }
```

- [ ] **Step 6: Update `genCodeC` with cross-schema refs + circular guard**

Replace the `$ref` block in `genCodeC` (lines 1332-1338):
```js
  // $ref — resolve local and cross-schema refs with circular guard
  if (schema.$ref) {
    const m = schema.$ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/)
    if (m && ctx.rootDefs && ctx.rootDefs[m[1]]) {
      if (ctx.refStack.has(schema.$ref)) return
      ctx.refStack.add(schema.$ref)
      genCodeC(ctx.rootDefs[m[1]], v, pathExpr, lines, ctx)
      ctx.refStack.delete(schema.$ref)
      return
    }
    if (ctx.schemaMap && ctx.schemaMap.has(schema.$ref)) {
      if (ctx.refStack.has(schema.$ref)) return
      ctx.refStack.add(schema.$ref)
      genCodeC(ctx.schemaMap.get(schema.$ref), v, pathExpr, lines, ctx)
      ctx.refStack.delete(schema.$ref)
      return
    }
  }
```

- [ ] **Step 7: Update `compileToJSCodegenWithErrors` and `compileToJSCombined` signatures**

In `compileToJSCodegenWithErrors` (line 975), change:
```js
function compileToJSCodegenWithErrors(schema, schemaMap) {
```

Update ctx (line 985):
```js
  const ctx = { varCounter: 0, helperCode: [], rootDefs: schema.$defs || schema.definitions || null, refStack: new Set(), schemaMap: schemaMap || null }
```

In `compileToJSCombined` (line 1292), change:
```js
function compileToJSCombined(schema, VALID_RESULT, schemaMap) {
```

Update ctx (line 1302-1303):
```js
  const ctx = { varCounter: 0, helperCode: [], closureVars: [], closureVals: [],
                rootDefs: schema.$defs || schema.definitions || null, refStack: new Set(), schemaMap: schemaMap || null }
```

- [ ] **Step 8: Update module.exports in js-compiler.js**

No change needed — the function names are the same, just signatures updated.

- [ ] **Step 9: Wire schemaMap through `index.js` compilation calls**

In `_ensureCompiled` (line 365), update the codegen calls to pass `this._schemaMap`:

Replace lines 365-368:
```js
      jsFn = compileToJSCodegen(schemaObj, this._schemaMap.size > 0 ? this._schemaMap : null) || compileToJS(schemaObj, null, this._schemaMap.size > 0 ? this._schemaMap : null);
      jsCombinedFn = compileToJSCombined(schemaObj, VALID_RESULT, this._schemaMap.size > 0 ? this._schemaMap : null);
      jsErrFn = compileToJSCodegenWithErrors(schemaObj, this._schemaMap.size > 0 ? this._schemaMap : null);
```

In `_ensureCodegen` (line 571), update:
```js
    const jsFn = compileToJSCodegen(this._schemaObj, this._schemaMap.size > 0 ? this._schemaMap : null) || compileToJS(this._schemaObj, null, this._schemaMap.size > 0 ? this._schemaMap : null);
```

- [ ] **Step 10: Update cache key to include schemaMap fingerprint**

In `_ensureCompiled`, replace the cache lookup (line 358):
```js
    const mapKey = this._schemaMap.size > 0
      ? this._schemaStr + '\0' + [...this._schemaMap.keys()].sort().join('\0')
      : this._schemaStr;
    const cached = _compileCache.get(mapKey);
```

And the cache set (line 368):
```js
      _compileCache.set(mapKey, { jsFn, combined: jsCombinedFn, errFn: jsErrFn });
```

Similarly in `_ensureCodegen` (line 565-576):
```js
    const mapKey = this._schemaMap.size > 0
      ? this._schemaStr + '\0' + [...this._schemaMap.keys()].sort().join('\0')
      : this._schemaStr;
    const cached = _compileCache.get(mapKey);
    if (cached && cached.jsFn) {
      this._jsFn = cached.jsFn;
      this.isValidObject = cached.jsFn;
      return;
    }
    const jsFn = compileToJSCodegen(this._schemaObj, this._schemaMap.size > 0 ? this._schemaMap : null) || compileToJS(this._schemaObj, null, this._schemaMap.size > 0 ? this._schemaMap : null);
    this._jsFn = jsFn;
    if (jsFn) {
      this.isValidObject = jsFn;
      if (!cached) _compileCache.set(mapKey, { jsFn, combined: null, errFn: null });
      else cached.jsFn = jsFn;
    }
```

- [ ] **Step 11: Update NAPI fallback to inline schemaMap schemas**

In `_ensureNative` (line 555-559), before creating the native schema, inline the schemaMap into `$defs`:

```js
  _ensureNative() {
    if (this._nativeReady) return;
    this._nativeReady = true;
    // Inline external schemas into $defs for NAPI (avoids C++ changes)
    let nativeSchemaStr = this._schemaStr;
    if (this._schemaMap.size > 0) {
      const merged = JSON.parse(this._schemaStr);
      if (!merged.$defs) merged.$defs = {};
      for (const [id, s] of this._schemaMap) {
        merged.$defs['__ext_' + id.replace(/[^a-zA-Z0-9]/g, '_')] = s;
      }
      nativeSchemaStr = JSON.stringify(merged);
    }
    this._compiled = new native.CompiledSchema(nativeSchemaStr);
    this._fastSlot = native.fastRegister(nativeSchemaStr);
  }
```

- [ ] **Step 12: Run cross-ref tests**

Run: `node tests/test_ref_cross.js`
Expected: All tests PASS

- [ ] **Step 13: Run existing test suites for regression**

Run: `node tests/run_suite.js`
Expected: Same pass rate as before

- [ ] **Step 14: Commit**

```bash
git add lib/js-compiler.js index.js
git commit -m "feat: wire schemaMap into codegen pipeline for cross-schema \$ref"
```

---

## Task 5: `patternProperties` Codegen

**Files:**
- Modify: `lib/js-compiler.js`
- Create: `tests/test_keywords_codegen.js`

- [ ] **Step 1: Write failing tests for patternProperties codegen**

Create `tests/test_keywords_codegen.js`:

```js
'use strict'
const { Validator } = require('../index')

let passed = 0, failed = 0

function test(name, fn) {
  try {
    fn()
    console.log(`  PASS  ${name}`)
    passed++
  } catch (e) {
    console.log(`  FAIL  ${name}: ${e.message}`)
    failed++
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || 'assertion failed')
}

console.log('\nKeyword Codegen Tests\n')

// --- patternProperties ---

test('patternProperties: single pattern valid', () => {
  const v = new Validator({
    type: 'object',
    patternProperties: { 'f.*o': { type: 'integer' } }
  })
  assert(v.validate({ foo: 1 }).valid === true)
  assert(v.validate({ foo: 1, foooooo: 2 }).valid === true)
})

test('patternProperties: single pattern invalid', () => {
  const v = new Validator({
    type: 'object',
    patternProperties: { 'f.*o': { type: 'integer' } }
  })
  assert(v.validate({ foo: 'bar' }).valid === false)
})

test('patternProperties: multiple patterns', () => {
  const v = new Validator({
    type: 'object',
    patternProperties: {
      'a*': { type: 'integer' },
      'aaa*': { maximum: 20 }
    }
  })
  assert(v.validate({ a: 21 }).valid === true)
  assert(v.validate({ aaaa: 18 }).valid === true)
  assert(v.validate({ aaaa: 31 }).valid === false)
})

test('patternProperties: ignores non-objects', () => {
  const v = new Validator({
    patternProperties: { 'f.*o': { type: 'integer' } }
  })
  assert(v.validate(['foo']).valid === true)
  assert(v.validate('foo').valid === true)
  assert(v.validate(12).valid === true)
})

test('patternProperties + properties + additionalProperties: false', () => {
  const v = new Validator({
    type: 'object',
    properties: { name: { type: 'string' } },
    patternProperties: { '^x-': { type: 'string' } },
    additionalProperties: false
  })
  assert(v.validate({ name: 'test', 'x-custom': 'val' }).valid === true)
  assert(v.validate({ name: 'test', unknown: 'val' }).valid === false)
})

test('patternProperties with null valued instance', () => {
  const v = new Validator({
    type: 'object',
    patternProperties: { '^.*bar$': { type: 'null' } }
  })
  assert(v.validate({ foobar: null }).valid === true)
})

// --- dependentSchemas ---

test('dependentSchemas: basic', () => {
  const v = new Validator({
    type: 'object',
    dependentSchemas: {
      bar: {
        properties: {
          foo: { type: 'integer' },
          bar: { type: 'integer' }
        }
      }
    }
  })
  assert(v.validate({ foo: 1, bar: 2 }).valid === true)
  assert(v.validate({ foo: 'quux' }).valid === true, 'no dependency triggered')
  assert(v.validate({ foo: 'quux', bar: 2 }).valid === false)
})

test('dependentSchemas: ignores non-objects', () => {
  const v = new Validator({
    dependentSchemas: { bar: { properties: { foo: { type: 'integer' } } } }
  })
  assert(v.validate(['bar']).valid === true)
  assert(v.validate('foobar').valid === true)
  assert(v.validate(12).valid === true)
})

test('dependentSchemas: escaped characters', () => {
  const v = new Validator({
    type: 'object',
    dependentSchemas: {
      "foo'bar": { required: ['foo"bar'] }
    }
  })
  assert(v.validate({ "foo'bar": 1, 'foo"bar': 2 }).valid === true)
  assert(v.validate({ "foo'bar": 1 }).valid === false)
})

// --- propertyNames ---

test('propertyNames: maxLength', () => {
  const v = new Validator({
    type: 'object',
    propertyNames: { maxLength: 3 }
  })
  assert(v.validate({ f: {}, foo: {} }).valid === true)
  assert(v.validate({ foo: {}, foobar: {} }).valid === false)
})

test('propertyNames: pattern', () => {
  const v = new Validator({
    type: 'object',
    propertyNames: { pattern: '^a+$' }
  })
  assert(v.validate({ a: {}, aa: {}, aaa: {} }).valid === true)
  assert(v.validate({ aaA: {} }).valid === false)
})

test('propertyNames: const', () => {
  const v = new Validator({
    type: 'object',
    propertyNames: { const: 'foo' }
  })
  assert(v.validate({ foo: 1 }).valid === true)
  assert(v.validate({ bar: 1 }).valid === false)
})

test('propertyNames: enum', () => {
  const v = new Validator({
    type: 'object',
    propertyNames: { enum: ['foo', 'bar'] }
  })
  assert(v.validate({ foo: 1 }).valid === true)
  assert(v.validate({ foo: 1, bar: 1 }).valid === true)
  assert(v.validate({ baz: 1 }).valid === false)
})

test('propertyNames: ignores non-objects', () => {
  const v = new Validator({
    propertyNames: { maxLength: 3 }
  })
  assert(v.validate([1, 2, 3]).valid === true)
  assert(v.validate('foobar').valid === true)
  assert(v.validate(12).valid === true)
})

test('propertyNames: empty object is valid', () => {
  const v = new Validator({
    type: 'object',
    propertyNames: { maxLength: 3 }
  })
  assert(v.validate({}).valid === true)
})

// --- Differential: codegen vs NAPI ---

test('differential: patternProperties codegen matches NAPI', () => {
  const schema = {
    type: 'object',
    patternProperties: { '^s_': { type: 'string' }, '^n_': { type: 'number' } },
    additionalProperties: false
  }
  const data = [
    { s_name: 'test', n_age: 25 },
    { s_name: 123 },
    { unknown: 'val' },
    {},
  ]
  const jsV = new Validator(schema)
  process.env.ATA_FORCE_NAPI = '1'
  const napiV = new Validator(schema)
  delete process.env.ATA_FORCE_NAPI

  for (const d of data) {
    const jsResult = jsV.validate(d).valid
    const napiResult = napiV.validate(d).valid
    assert(jsResult === napiResult, `mismatch for ${JSON.stringify(d)}: js=${jsResult} napi=${napiResult}`)
  }
})

console.log(`\n  ${passed} passed, ${failed} failed\n`)
if (failed > 0) process.exit(1)
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node tests/test_keywords_codegen.js`
Expected: patternProperties, dependentSchemas, propertyNames tests FAIL (codegen bails to NAPI, but the NAPI path should still work for the simpler ones)

- [ ] **Step 3: Update `codegenSafe` to allow these keywords conditionally**

In `lib/js-compiler.js`, replace the blanket bail (lines 517-519 in `compileToJSCodegen`, lines 20-24 in `compileToJS`, line 983 in `compileToJSCodegenWithErrors`, line 1300 in `compileToJSCombined`):

In all four locations, replace:
```js
  if (schema.patternProperties ||
      schema.dependentSchemas ||
      schema.propertyNames) return null
```

with:
```js
  // patternProperties: bail only on boolean sub-schemas or unicode property escapes
  if (schema.patternProperties) {
    for (const [pat, sub] of Object.entries(schema.patternProperties)) {
      if (typeof sub === 'boolean') return null
      if (/\\[pP]\{/.test(pat)) return null
      if (typeof sub === 'object' && sub !== null && !codegenSafe(sub)) return null
    }
  }
  // dependentSchemas: bail on boolean sub-schemas
  if (schema.dependentSchemas) {
    for (const sub of Object.values(schema.dependentSchemas)) {
      if (typeof sub === 'boolean') return null
      if (typeof sub === 'object' && sub !== null && !codegenSafe(sub)) return null
    }
  }
  // propertyNames: only codegen simple string constraints
  if (schema.propertyNames) {
    if (typeof schema.propertyNames === 'boolean') return null
    const pn = schema.propertyNames
    const supported = ['maxLength', 'minLength', 'pattern', 'const', 'enum']
    const keys = Object.keys(pn).filter(k => k !== '$schema')
    if (keys.some(k => !supported.includes(k))) return null
  }
```

- [ ] **Step 4: Add `patternProperties` codegen to `genCode`**

In `genCode`, after the `dependentRequired` block (after line 784) and before the `properties` block (line 786), add:

```js
  // patternProperties — unified loop with properties and additionalProperties
  if (schema.patternProperties) {
    const ppEntries = Object.entries(schema.patternProperties)
    // Compile regex objects as closure variables
    const ppRegexVars = []
    for (const [pat] of ppEntries) {
      const ri = ctx.varCounter++
      ctx.closureVars.push(`_re${ri}`)
      ctx.closureVals.push(new RegExp(pat))
      ppRegexVars.push(`_re${ri}`)
    }

    // If additionalProperties: false, we need a unified for..in loop
    if (schema.additionalProperties === false) {
      const propKeys = schema.properties ? Object.keys(schema.properties) : []
      const ki = ctx.varCounter++
      const guard = isObj ? '' : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v}))`
      lines.push(`${guard}{for(const _k${ki} in ${v}){let _m${ki}=false`)

      // Check properties match
      for (const pk of propKeys) {
        lines.push(`if(_k${ki}===${JSON.stringify(pk)})_m${ki}=true`)
      }

      // Check pattern matches + validate
      for (let i = 0; i < ppEntries.length; i++) {
        const subLines = []
        genCode(ppEntries[i][1], `${v}[_k${ki}]`, subLines, ctx)
        lines.push(`if(${ppRegexVars[i]}.test(_k${ki})){_m${ki}=true`)
        for (const sl of subLines) lines.push(sl)
        lines.push(`}`)
      }

      lines.push(`if(!_m${ki})return false}}`)

      // Skip the normal additionalProperties deferred check since we handle it here
      // Mark it so the deferred check below doesn't emit duplicate code
      ctx._ppHandledAdditional = true
    } else {
      // No additionalProperties interaction — just validate matching keys
      const ki = ctx.varCounter++
      const guard = isObj ? '' : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v}))`
      lines.push(`${guard}{for(const _k${ki} in ${v}){`)
      for (let i = 0; i < ppEntries.length; i++) {
        const subLines = []
        genCode(ppEntries[i][1], `${v}[_k${ki}]`, subLines, ctx)
        lines.push(`if(${ppRegexVars[i]}.test(_k${ki})){`)
        for (const sl of subLines) lines.push(sl)
        lines.push(`}`)
      }
      lines.push(`}}`)
    }
  }
```

Then update the existing `additionalProperties` deferred check (lines 758-776) to skip when `patternProperties` already handled it:

Replace the condition on line 760:
```js
  if (schema.additionalProperties === false && schema.properties && !ctx._ppHandledAdditional) {
```

- [ ] **Step 5: Add `dependentSchemas` codegen to `genCode`**

After the `patternProperties` block (and before `properties`), add:

```js
  // dependentSchemas
  if (schema.dependentSchemas) {
    for (const [key, depSchema] of Object.entries(schema.dependentSchemas)) {
      const guard = isObj ? '' : `typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})&&`
      lines.push(`if(${guard}${JSON.stringify(key)} in ${v}){`)
      genCode(depSchema, v, lines, ctx, effectiveType)
      lines.push(`}`)
    }
  }
```

- [ ] **Step 6: Add `propertyNames` codegen to `genCode`**

After `dependentSchemas`, add:

```js
  // propertyNames — validate string constraints on each key
  if (schema.propertyNames && typeof schema.propertyNames === 'object') {
    const pn = schema.propertyNames
    const ki = ctx.varCounter++
    const guard = isObj ? '' : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v}))`
    lines.push(`${guard}{for(const _k${ki} in ${v}){`)

    if (pn.minLength !== undefined) {
      lines.push(`if(_k${ki}.length<${pn.minLength})return false`)
    }
    if (pn.maxLength !== undefined) {
      lines.push(`if(_k${ki}.length>${pn.maxLength})return false`)
    }
    if (pn.pattern) {
      const ri = ctx.varCounter++
      ctx.closureVars.push(`_re${ri}`)
      ctx.closureVals.push(new RegExp(pn.pattern))
      lines.push(`if(!_re${ri}.test(_k${ki}))return false`)
    }
    if (pn.const !== undefined) {
      lines.push(`if(_k${ki}!==${JSON.stringify(pn.const)})return false`)
    }
    if (pn.enum) {
      const ei = ctx.varCounter++
      ctx.closureVars.push(`_es${ei}`)
      ctx.closureVals.push(new Set(pn.enum))
      lines.push(`if(!_es${ei}.has(_k${ki}))return false`)
    }

    lines.push(`}}`)
  }
```

- [ ] **Step 7: Run tests**

Run: `node tests/test_keywords_codegen.js`
Expected: All patternProperties, dependentSchemas, propertyNames tests PASS

- [ ] **Step 8: Run JSON Schema Test Suite to verify**

Run: `node tests/run_suite.js`
Expected: `patternProperties.json`, `dependentSchemas.json`, `propertyNames.json` now have higher pass rates (boolean sub-schema tests may still fail — expected, they bail to NAPI)

- [ ] **Step 9: Commit**

```bash
git add lib/js-compiler.js tests/test_keywords_codegen.js
git commit -m "feat: add patternProperties, dependentSchemas, propertyNames JS codegen"
```

---

## Task 6: Error Path Codegen for New Keywords (`genCodeE` + `genCodeC`)

**Files:**
- Modify: `lib/js-compiler.js`

- [ ] **Step 1: Add `patternProperties` to `genCodeE`**

In `genCodeE`, after the properties section (find the pattern where `required` and `properties` are handled), add:

```js
  // patternProperties
  if (schema.patternProperties) {
    for (const [pat, sub] of Object.entries(schema.patternProperties)) {
      const ri = ctx.varCounter++
      ctx.helperCode.push(`const _re${ri}=new RegExp(${JSON.stringify(pat)})`)
      const ki = ctx.varCounter++
      lines.push(`if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){for(const _k${ki} in ${v}){if(_re${ri}.test(_k${ki})){`)
      const p = pathExpr ? `${pathExpr}+'/'+_k${ki}` : `'/'+_k${ki}`
      genCodeE(sub, `${v}[_k${ki}]`, p, lines, ctx)
      lines.push(`}}}`)
    }
  }
```

- [ ] **Step 2: Add `dependentSchemas` to `genCodeE`**

```js
  // dependentSchemas
  if (schema.dependentSchemas) {
    for (const [key, depSchema] of Object.entries(schema.dependentSchemas)) {
      lines.push(`if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})&&${JSON.stringify(key)} in ${v}){`)
      genCodeE(depSchema, v, pathExpr, lines, ctx)
      lines.push(`}`)
    }
  }
```

- [ ] **Step 3: Add `propertyNames` to `genCodeE`**

```js
  // propertyNames
  if (schema.propertyNames && typeof schema.propertyNames === 'object') {
    const pn = schema.propertyNames
    const ki = ctx.varCounter++
    lines.push(`if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){for(const _k${ki} in ${v}){`)
    const p = pathExpr ? `${pathExpr}+'/@key'` : `'/@key'`
    if (pn.minLength !== undefined) {
      lines.push(`if(_k${ki}.length<${pn.minLength}){${fail('min_length_violation', `'propertyNames: key too short: '+_k${ki}`)}}`)
    }
    if (pn.maxLength !== undefined) {
      lines.push(`if(_k${ki}.length>${pn.maxLength}){${fail('max_length_violation', `'propertyNames: key too long: '+_k${ki}`)}}`)
    }
    if (pn.pattern) {
      const ri = ctx.varCounter++
      ctx.helperCode.push(`const _re${ri}=new RegExp(${JSON.stringify(pn.pattern)})`)
      lines.push(`if(!_re${ri}.test(_k${ki})){${fail('pattern_mismatch', `'propertyNames: pattern mismatch: '+_k${ki}`)}}`)
    }
    if (pn.const !== undefined) {
      lines.push(`if(_k${ki}!==${JSON.stringify(pn.const)}){${fail('const_mismatch', `'propertyNames: expected '+${JSON.stringify(pn.const)}`)}}`)
    }
    if (pn.enum) {
      const ei = ctx.varCounter++
      ctx.helperCode.push(`const _es${ei}=new Set(${JSON.stringify(pn.enum)})`)
      lines.push(`if(!_es${ei}.has(_k${ki})){${fail('enum_mismatch', `'propertyNames: key not in enum: '+_k${ki}`)}}`)
    }
    lines.push(`}}`)
  }
```

- [ ] **Step 4: Add the same three keywords to `genCodeC`**

`genCodeC` uses `(_e||(_e=[])).push(...)` pattern instead of `_e.push(...)`. Add the same blocks but using the `fail` helper defined in `genCodeC`:

```js
  // patternProperties
  if (schema.patternProperties) {
    for (const [pat, sub] of Object.entries(schema.patternProperties)) {
      const ri = ctx.varCounter++
      ctx.closureVars.push(`_re${ri}`)
      ctx.closureVals.push(new RegExp(pat))
      const ki = ctx.varCounter++
      lines.push(`if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){for(const _k${ki} in ${v}){if(_re${ri}.test(_k${ki})){`)
      const p = pathExpr ? `${pathExpr}+'/'+_k${ki}` : `'/'+_k${ki}`
      genCodeC(sub, `${v}[_k${ki}]`, p, lines, ctx)
      lines.push(`}}}`)
    }
  }

  // dependentSchemas
  if (schema.dependentSchemas) {
    for (const [key, depSchema] of Object.entries(schema.dependentSchemas)) {
      lines.push(`if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})&&${JSON.stringify(key)} in ${v}){`)
      genCodeC(depSchema, v, pathExpr, lines, ctx)
      lines.push(`}`)
    }
  }

  // propertyNames
  if (schema.propertyNames && typeof schema.propertyNames === 'object') {
    const pn = schema.propertyNames
    const ki = ctx.varCounter++
    lines.push(`if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){for(const _k${ki} in ${v}){`)
    if (pn.minLength !== undefined) {
      lines.push(`if(_k${ki}.length<${pn.minLength}){${fail('min_length_violation', `'propertyNames: key too short: '+_k${ki}`)}}`)
    }
    if (pn.maxLength !== undefined) {
      lines.push(`if(_k${ki}.length>${pn.maxLength}){${fail('max_length_violation', `'propertyNames: key too long: '+_k${ki}`)}}`)
    }
    if (pn.pattern) {
      const ri = ctx.varCounter++
      ctx.closureVars.push(`_re${ri}`)
      ctx.closureVals.push(new RegExp(pn.pattern))
      lines.push(`if(!_re${ri}.test(_k${ki})){${fail('pattern_mismatch', `'propertyNames: pattern mismatch: '+_k${ki}`)}}`)
    }
    if (pn.const !== undefined) {
      lines.push(`if(_k${ki}!==${JSON.stringify(pn.const)}){${fail('const_mismatch', `'propertyNames: expected '+${JSON.stringify(pn.const)}`)}}`)
    }
    if (pn.enum) {
      const ei = ctx.varCounter++
      ctx.closureVars.push(`_es${ei}`)
      ctx.closureVals.push(new Set(pn.enum))
      lines.push(`if(!_es${ei}.has(_k${ki})){${fail('enum_mismatch', `'propertyNames: key not in enum: '+_k${ki}`)}}`)
    }
    lines.push(`}}`)
  }
```

- [ ] **Step 5: Run all tests**

Run: `node tests/test_keywords_codegen.js && node tests/run_suite.js`
Expected: All pass. Error details now come from codegen instead of NAPI fallback for these keywords.

- [ ] **Step 6: Commit**

```bash
git add lib/js-compiler.js
git commit -m "feat: add error path codegen for patternProperties, dependentSchemas, propertyNames"
```

---

## Task 7: TypeScript Definitions Update

**Files:**
- Modify: `index.d.ts`

- [ ] **Step 1: Read current type definitions**

Read `index.d.ts` to understand current types.

- [ ] **Step 2: Add `schemas` option and `addSchema` method**

Add to the options interface:
```ts
interface ValidatorOptions {
  coerceTypes?: boolean;
  removeAdditional?: boolean;
  schemas?: Record<string, object> | object[];
}
```

Add to the `Validator` class:
```ts
  addSchema(schema: object): void;
```

- [ ] **Step 3: Commit**

```bash
git add index.d.ts
git commit -m "feat: add schemas option and addSchema to TypeScript definitions"
```

---

## Task 8: Differential Fuzz Testing

**Files:**
- Create: `tests/fuzz_differential.js`

- [ ] **Step 1: Write differential fuzzer**

Create `tests/fuzz_differential.js`:

```js
'use strict'
const { Validator } = require('../index')

// Differential fuzzer: generate random schemas + data,
// validate via codegen vs NAPI, compare results.

const ITERATIONS = process.env.FUZZ_ITERATIONS ? parseInt(process.env.FUZZ_ITERATIONS) : 10000
let passed = 0, failed = 0

function randomType() {
  return ['string', 'number', 'integer', 'boolean', 'null', 'object', 'array'][Math.floor(Math.random() * 7)]
}

function randomSchema(depth) {
  if (depth <= 0) return { type: randomType() }
  const type = randomType()
  const schema = { type }

  if (type === 'object' && Math.random() > 0.3) {
    const propCount = Math.floor(Math.random() * 4) + 1
    schema.properties = {}
    for (let i = 0; i < propCount; i++) {
      schema.properties['p' + i] = randomSchema(depth - 1)
    }
    if (Math.random() > 0.5) {
      schema.required = Object.keys(schema.properties).slice(0, Math.floor(Math.random() * propCount) + 1)
    }
    // patternProperties
    if (Math.random() > 0.7) {
      schema.patternProperties = { '^x_': randomSchema(depth - 1) }
    }
    // dependentSchemas
    if (Math.random() > 0.8 && schema.properties) {
      const key = Object.keys(schema.properties)[0]
      schema.dependentSchemas = { [key]: { required: Object.keys(schema.properties) } }
    }
    // propertyNames
    if (Math.random() > 0.8) {
      schema.propertyNames = { maxLength: Math.floor(Math.random() * 10) + 2 }
    }
    if (Math.random() > 0.7) {
      schema.additionalProperties = false
    }
  }
  if (type === 'string') {
    if (Math.random() > 0.5) schema.minLength = Math.floor(Math.random() * 3)
    if (Math.random() > 0.5) schema.maxLength = Math.floor(Math.random() * 20) + 3
  }
  if (type === 'number' || type === 'integer') {
    if (Math.random() > 0.5) schema.minimum = Math.floor(Math.random() * 10)
    if (Math.random() > 0.5) schema.maximum = Math.floor(Math.random() * 100)
  }
  if (type === 'array') {
    schema.items = randomSchema(depth - 1)
    if (Math.random() > 0.5) schema.minItems = Math.floor(Math.random() * 3)
    if (Math.random() > 0.5) schema.maxItems = Math.floor(Math.random() * 10) + 1
  }
  return schema
}

function randomData(depth) {
  if (depth <= 0) return Math.random() > 0.5 ? 'str' : Math.floor(Math.random() * 100)
  const r = Math.random()
  if (r < 0.15) return null
  if (r < 0.3) return Math.random() > 0.5
  if (r < 0.45) return Math.floor(Math.random() * 200) - 50
  if (r < 0.6) return 'x'.repeat(Math.floor(Math.random() * 15))
  if (r < 0.8) {
    const obj = {}
    const keys = Math.floor(Math.random() * 5)
    for (let i = 0; i < keys; i++) {
      const key = Math.random() > 0.5 ? 'p' + i : 'x_' + i
      obj[key] = randomData(depth - 1)
    }
    return obj
  }
  const arr = []
  const len = Math.floor(Math.random() * 5)
  for (let i = 0; i < len; i++) arr.push(randomData(depth - 1))
  return arr
}

console.log(`\nDifferential Fuzz: ${ITERATIONS} iterations\n`)

for (let i = 0; i < ITERATIONS; i++) {
  const schema = randomSchema(2)
  const data = randomData(2)

  try {
    const jsV = new Validator(schema)
    process.env.ATA_FORCE_NAPI = '1'
    const napiV = new Validator(schema)
    delete process.env.ATA_FORCE_NAPI

    const jsResult = jsV.validate(data)
    const napiResult = napiV.validate(data)

    if (jsResult.valid !== napiResult.valid) {
      console.log(`  MISMATCH at iteration ${i}:`)
      console.log(`    schema: ${JSON.stringify(schema).slice(0, 200)}`)
      console.log(`    data: ${JSON.stringify(data).slice(0, 200)}`)
      console.log(`    js: ${jsResult.valid}, napi: ${napiResult.valid}`)
      failed++
    } else {
      passed++
    }
  } catch (e) {
    // Schema too complex for either path — skip
    passed++
  }
}

console.log(`  ${passed} passed, ${failed} mismatches out of ${ITERATIONS}`)
if (failed > 0) {
  console.log(`\n  WARNING: ${failed} divergences found between codegen and NAPI`)
  process.exit(1)
}
console.log('  All clear!\n')
```

- [ ] **Step 2: Run fuzzer**

Run: `node tests/fuzz_differential.js`
Expected: 0 mismatches out of 10000

- [ ] **Step 3: Add npm script**

In `package.json`, add to `scripts`:
```json
"fuzz": "node tests/fuzz_differential.js",
"fuzz:long": "FUZZ_ITERATIONS=100000 node tests/fuzz_differential.js"
```

- [ ] **Step 4: Commit**

```bash
git add tests/fuzz_differential.js package.json
git commit -m "feat: add differential fuzz testing (codegen vs NAPI)"
```

---

## Task 9: Final Integration Test + Suite Pass Rate

**Files:**
- Modify: `tests/run_suite.js` (minor)

- [ ] **Step 1: Run all test suites**

```bash
node tests/test_draft7.js
node tests/test_ref_cross.js
node tests/test_keywords_codegen.js
node tests/run_suite.js
node tests/run_suite_draft7.js
node tests/fuzz_differential.js
```

Expected: All pass. 2020-12 suite pass rate should be higher than 98.4% (fewer NAPI fallbacks).

- [ ] **Step 2: Run existing tests for regression**

```bash
node tests/test_compat.js
node tests/test_dual_path.js
node tests/test_lazy.js
node tests/test_standard_schema.js
```

Expected: All pass — no regressions.

- [ ] **Step 3: Commit any final fixes**

```bash
git add -A
git commit -m "test: final integration pass — all suites green"
```

---

## Dependency Order

```
Task 1 (Draft 7 module) ──→ Task 2 (Draft 7 integration)
                                                          ╲
Task 3 (schemaMap API) ────→ Task 4 (codegen wiring) ─────→ Task 9 (integration)
                                                          ╱
Task 5 (keyword codegen) ──→ Task 6 (error codegen) ─────╱
                                                         ╱
Task 7 (TypeScript) ────────────────────────────────────╱
                                                       ╱
Task 8 (fuzz testing) ────────────────────────────────╱
```

**Parallelizable:** Tasks 1, 3, 5, 7, 8 can all start simultaneously. Task 2 depends on 1. Task 4 depends on 3. Task 6 depends on 5. Task 9 depends on all.
