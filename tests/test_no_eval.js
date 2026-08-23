'use strict'

// ata must validate correctly where code generation is unavailable.
//
// Cloudflare Workers, Deno Deploy, browser pages under a strict
// Content-Security-Policy and several embedded runtimes refuse `eval` and
// `new Function`. A validator that compiles schemas by generating source, which
// is what the JS fast path and most other libraries do, cannot run there at all.
// ata falls back to the interpreted engine instead.
//
// This test blocks both before ata is loaded and runs the whole official suite
// through it, so the guarantee is checked rather than assumed. It is not enough
// for a handful of schemas to pass: the interpreted engine has to be correct
// across the same corpus the compiled path is measured on.

const fs = require('fs')
const path = require('path')
const assert = require('assert')

// No native addon exists on the runtimes this simulates.
process.env.ATA_NO_NATIVE = '1'

const RealFunction = Function
let blockedCalls = 0

globalThis.eval = () => {
  blockedCalls++
  throw new EvalError('eval is blocked in this environment')
}

// Allow `Function` as a value (instanceof checks, prototype access) but refuse
// every attempt to build a function from source, which is what codegen needs.
const GuardedFunction = new Proxy(RealFunction, {
  construct() {
    blockedCalls++
    throw new EvalError('new Function is blocked in this environment')
  },
  apply(target, thisArg, args) {
    if (args.length > 0) {
      blockedCalls++
      throw new EvalError('Function(source) is blocked in this environment')
    }
    return Reflect.apply(target, thisArg, args)
  },
})
Object.defineProperty(globalThis, 'Function', {
  value: GuardedFunction,
  writable: true,
  configurable: true,
})

// Loaded only after the block is in place.
const { Validator } = require('../index')

const DIALECTS = {
  'draft2020-12': 'https://json-schema.org/draft/2020-12/schema',
  draft7: 'http://json-schema.org/draft-07/schema#',
  v1: 'https://json-schema.org/v1',
}

const REMOTES_DIR = path.join(__dirname, 'suite/remotes')
const registry = {}
;(function collect(dir, prefix) {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) collect(full, prefix + entry.name + '/')
    else if (entry.name.endsWith('.json')) {
      try {
        registry['http://localhost:1234/' + prefix + entry.name] = JSON.parse(
          fs.readFileSync(full, 'utf8'),
        )
      } catch {}
    }
  }
})(REMOTES_DIR, '')

// The compiled path is measured by tests/run_suite.js. This test asserts the
// interpreted path is not meaningfully worse, so a drop in either engine fails
// rather than being absorbed silently.
const FLOOR = {
  'draft2020-12': { total: 1299, minPass: 1298 },
  draft7: { total: 927, minPass: 927 },
  v1: { total: 1133, minPass: 1133 },
}

console.log('\nata with eval and new Function blocked\n')

let exitCode = 0

for (const [dialect, dialectUri] of Object.entries(DIALECTS)) {
  const dir = path.join(__dirname, 'suite/tests', dialect)
  const options = { schemas: registry, assertFormat: false, useDefaults: false }
  let pass = 0
  let fail = 0
  let errored = 0

  for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.json'))) {
    for (const group of JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))) {
      const schema =
        typeof group.schema === 'object' && group.schema !== null && !Array.isArray(group.schema)
          ? '$schema' in group.schema
            ? group.schema
            : { ...group.schema, $schema: dialectUri }
          : group.schema

      let validator
      try {
        validator = new Validator(schema, options)
      } catch {
        errored += group.tests.length
        continue
      }
      for (const test of group.tests) {
        try {
          if (validator.validate(test.data).valid === test.valid) pass++
          else {
            fail++
            if (process.env.ATA_LIST_FAILURES) console.log(`    FAIL  ${file} :: ${group.description} :: ${test.description}`)
          }
        } catch {
          errored++
        }
      }
    }
  }

  const floor = FLOOR[dialect]
  const total = pass + fail + errored
  const ok = pass >= floor.minPass && errored === 0
  if (!ok) exitCode = 1

  console.log(
    `  ${ok ? 'PASS' : 'FAIL'}  ${dialect.padEnd(14)} ${pass}/${total} passed, ` +
      `${fail} failed, ${errored} errored  (floor ${floor.minPass})`,
  )
  assert.strictEqual(total, floor.total, `${dialect}: expected ${floor.total} cases, saw ${total}`)
}

// A run that never tripped the guard would mean codegen was skipped for some
// other reason and the block was never actually exercised.
assert.ok(blockedCalls > 0, 'expected at least one blocked codegen attempt')

// The Standard Schema surface rides on validate(), so it must work here too:
// this is what a Hono or tRPC app on a Worker calls.
{
  const std = new Validator({ type: 'object', required: ['id'], properties: { id: { type: 'integer' } } })['~standard']
  assert.strictEqual(std.version, 1)
  assert.deepStrictEqual(std.validate({ id: 1 }), { value: { id: 1 } })
  const bad = std.validate({ id: 'x' })
  assert.ok(Array.isArray(bad.issues) && bad.issues.length === 1)
  assert.deepStrictEqual(bad.issues[0].path, [{ key: 'id' }])
  console.log('  PASS  ~standard answers with code generation blocked')
}

console.log(`\n  ${blockedCalls} code generation attempts blocked and recovered from\n`)

if (exitCode !== 0) {
  console.error('  interpreted engine fell below the floor\n')
  process.exit(exitCode)
}
