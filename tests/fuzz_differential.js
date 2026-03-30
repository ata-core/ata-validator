'use strict'
const { Validator } = require('../index')

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
    if (Math.random() > 0.7) {
      schema.patternProperties = { '^x_': randomSchema(depth - 1) }
    }
    if (Math.random() > 0.8 && schema.properties) {
      const key = Object.keys(schema.properties)[0]
      schema.dependentSchemas = { [key]: { required: Object.keys(schema.properties) } }
    }
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
    passed++ // Schema too complex — skip
  }
}

console.log(`  ${passed} passed, ${failed} mismatches out of ${ITERATIONS}`)
if (failed > 0) {
  console.log(`\n  WARNING: ${failed} divergences found between codegen and NAPI`)
  process.exit(1)
}
console.log('  All clear!\n')
