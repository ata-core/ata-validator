'use strict'

// engine: 'interpreter' is a per-validator promise: the schema never becomes
// source. The default turns most schemas into generated JavaScript, which is
// the right trade for a schema the application wrote; a schema that arrives
// at runtime from a plugin or a tenant is input. This test holds the verdicts
// equal across engines, then guards `Function` the way test_no_eval.js does
// and proves the interpreter validator never builds a function from source
// (the validator, the isValidObject fast path, and the mutator pass that
// embeds `default` values) while the default one does. The verdicts hold
// with and without the native addon.

const assert = require('assert')
const { Validator } = require('..')

const schema = {
  type: 'object',
  properties: {
    id: { type: 'integer', minimum: 1 },
    name: { type: 'string', minLength: 1 },
    tags: { type: 'array', items: { type: 'string' } },
  },
  required: ['id', 'name'],
  additionalProperties: false,
}
const valid = { id: 7, name: 'ok', tags: ['a'] }
const invalid = { id: 0, name: '', extra: true }

// 1. The default compiles; the option does not, even for a schema already in
//    the shared compile cache, and it reports itself.
const auto = new Validator(schema)
assert.strictEqual(auto.engine(), 'codegen', 'default engine')
const interp = new Validator(schema, { engine: 'interpreter' })
assert.strictEqual(interp.engine(), 'interpreter', 'engine option')
assert.strictEqual(new Validator(schema, { engine: 'auto' }).engine(), 'codegen', "engine: 'auto' is the default")

// 2. Same verdicts, same failing paths, on every entry point.
for (const v of [auto, interp]) {
  const label = v.engine()
  assert.strictEqual(v.validate(valid).valid, true, label + ' validate valid')
  assert.strictEqual(v.isValidObject(valid), true, label + ' isValidObject valid')
  assert.strictEqual(v.isValidObject(invalid), false, label + ' isValidObject invalid')
  const r = v.validate(invalid)
  assert.strictEqual(r.valid, false, label + ' validate invalid')
  const paths = new Set(r.errors.map((e) => e.path))
  assert.ok(paths.has('/id') && paths.has('/name'), label + ' names the failing fields: ' + [...paths].join(','))
  assert.strictEqual(v.validateJSON(JSON.stringify(valid)).valid, true, label + ' validateJSON valid')
  assert.strictEqual(v.validateJSON(JSON.stringify(invalid)).valid, false, label + ' validateJSON invalid')
  assert.strictEqual(v.validateJSON('{').valid, false, label + ' validateJSON syntax error')
}

// 3. Options compose: the mutator pass still runs on the closure path.
{
  const withDefaults = new Validator(
    { type: 'object', properties: { role: { type: 'string', default: 'user' }, n: { type: 'integer' } } },
    { engine: 'interpreter', coerceTypes: true },
  )
  const data = { n: '3' }
  assert.strictEqual(withDefaults.validate(data).valid, true, 'defaults + coercion on the interpreter')
  assert.strictEqual(data.role, 'user', 'default applied')
  assert.strictEqual(data.n, 3, 'coerced')
}

// 4. A misspelling must not fall through to the generator.
assert.throws(() => new Validator(schema, { engine: 'interpretor' }), /engine must be 'auto' or 'interpreter'/)
assert.throws(() => new Validator(schema, { engine: 'native' }), TypeError)
assert.throws(() => new Validator(schema, { engine: null }), TypeError)

// 5. Guard Function from here on: every attempt to build a function from
//    source counts and throws. Schemas below are fresh strings, so nothing is
//    served from the compile cache filled above.
const RealFunction = Function
let blockedCalls = 0
const GuardedFunction = new Proxy(RealFunction, {
  construct() {
    blockedCalls++
    throw new EvalError('new Function is blocked')
  },
  apply(target, thisArg, args) {
    if (args.length > 0) {
      blockedCalls++
      throw new EvalError('Function(source) is blocked')
    }
    return Reflect.apply(target, thisArg, args)
  },
})
Object.defineProperty(globalThis, 'Function', { value: GuardedFunction, writable: true, configurable: true })
try {
  const fresh = {
    type: 'object',
    properties: {
      role: { type: 'string', enum: ['user', 'admin'], default: 'user' },
      code: { type: 'string', pattern: '^[a-z]+$' },
      nested: { type: 'object', properties: { flag: { type: 'boolean' } }, required: ['flag'] },
    },
    required: ['code'],
  }
  const untrusted = new Validator(fresh, { engine: 'interpreter' })
  assert.strictEqual(untrusted.engine(), 'interpreter')
  const doc = { code: 'abc', nested: { flag: true } }
  assert.strictEqual(untrusted.validate(doc).valid, true, 'interpreter validate under the guard')
  assert.strictEqual(doc.role, 'user', 'default applied under the guard')
  assert.strictEqual(untrusted.isValidObject({ code: 'ABC', nested: { flag: true } }), false, 'pattern on the interpreter')
  assert.strictEqual(untrusted.validateJSON('{"code":"x","nested":{}}').valid, false, 'validateJSON on the interpreter')
  assert.strictEqual(blockedCalls, 0, 'the interpreter validator built no function from source')

  // The default validator does reach for the generator: the guard is live.
  const trusted = new Validator({ ...fresh, title: 'trusted copy' })
  try { trusted.validate(doc) } catch (e) { assert.ok(e instanceof EvalError, 'only the guard throws') }
  assert.ok(blockedCalls > 0, 'the default validator tried to build a function from source')
} finally {
  Object.defineProperty(globalThis, 'Function', { value: RealFunction, writable: true, configurable: true })
}

console.log('engine option: ok')

// 6. First in the process. The codegen probe is a `new Function` too, and it
//    runs once, lazily, on the first compile: a fresh process guards Function
//    before requiring, builds only an interpreter validator, and must count
//    no attempt at all.
{
  const { execFileSync } = require('child_process')
  const script = `
    let n = 0
    const Real = Function
    global.Function = new Proxy(Real, {
      construct() { n++; throw new EvalError('blocked') },
      apply() { n++; throw new EvalError('blocked') },
    })
    const { Validator } = require(${JSON.stringify(require.resolve('..'))})
    const v = new Validator(${JSON.stringify(schema)}, { engine: 'interpreter' })
    if (!v.validate(${JSON.stringify(valid)}).valid) throw new Error('valid data refused')
    if (v.isValidObject(${JSON.stringify(invalid)})) throw new Error('invalid data accepted')
    process.stdout.write(String(n))
  `
  const count = execFileSync(process.execPath, ['-e', script], { encoding: 'utf8' })
  assert.strictEqual(count, '0', 'first in the process, the interpreter validator ran no probe')
}

