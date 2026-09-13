'use strict'

// A validator can enforce more than its schema carries. `withKeywords` from
// @ata-project/keywords wraps an instance's entry points so `instanceof` and
// `typeof` are checked after the schema accepts. The AOT emitters build their
// module from the compiled schema alone, so for a wrapped instance they used
// to emit a module missing those checks and return it as if it were complete.
// Nothing said so: the module was well formed, it just accepted documents the
// validator it came from rejects. That is the silent-acceptance failure this
// codebase treats as the worst one, reached through the documented API.
//
// The guard the emitters had only looked at `_usesKeywords`, which is set by
// the constructor's `keywords` option. `withKeywords` does not go through the
// constructor, so the guard never fired for it.
//
// Core cannot detect a wrapper on its own: it installs its own entry points as
// own properties on the instance, so "something replaced these" is not a
// signal it can read. The wrapper declares itself instead, with
// `_externalChecks`, and this holds the emitters to it. The test does not
// depend on the keywords package, which core does not depend on either; it
// declares the flag the same way a wrapper does.

const assert = require('node:assert')
const { Validator } = require('..')
const { toStandalone, toStandaloneModule } = require('../aot')

const schema = {
  type: 'object',
  properties: { created: { instanceof: 'Date' } },
  required: ['created'],
}

function wrapped () {
  const v = new Validator(JSON.parse(JSON.stringify(schema)))
  Object.defineProperty(v, '_externalChecks', { get: () => true, configurable: true })
  return v
}

// 1. Both emitters refuse a validator that declares external checks.
for (const [name, emit] of [
  ['toStandalone', (v) => toStandalone(v)],
  ['toStandaloneModule', (v) => toStandaloneModule(v, { format: 'esm' })],
]) {
  let threw = null
  try { emit(wrapped()) } catch (e) { threw = e }
  assert(threw, `${name} emitted a module for a validator with external checks`)
  assert(
    /enforces checks that are not in its schema/.test(threw.message),
    `${name} threw, but not about external checks: ${threw.message}`,
  )
}

// 2. The flag is what refuses, not the schema: the same schema without the
// declaration still compiles, since an unknown keyword is ignorable and the
// module then matches what the unwrapped validator does.
const plain = new Validator(JSON.parse(JSON.stringify(schema)))
const mod = toStandaloneModule(plain, { format: 'esm' })
assert(mod, 'an unwrapped validator should still emit')
assert(!plain._externalChecks, 'an unwrapped validator should not declare external checks')

// 3. A wrapper over a schema with nothing extra to enforce must not be blocked.
// `_externalChecks` is false there, and refusing would cost every wrapped
// validator its ability to compile.
const inert = new Validator({ type: 'object', properties: { a: { type: 'number' } } })
Object.defineProperty(inert, '_externalChecks', { get: () => false, configurable: true })
assert(toStandaloneModule(inert, { format: 'esm' }), 'a wrapper enforcing nothing should still emit')

// 4. The declaration is read lazily, so declaring it must not force the schema
// walk before an emitter asks. Reading it is the only thing that may.
let reads = 0
const lazy = new Validator(JSON.parse(JSON.stringify(schema)))
Object.defineProperty(lazy, '_externalChecks', { get: () => { reads++; return true }, configurable: true })
assert.strictEqual(reads, 0, 'declaring external checks should not read them')
try { toStandaloneModule(lazy, { format: 'esm' }) } catch { /* expected */ }
assert(reads > 0, 'the emitter should have read the declaration')

console.log('aot external checks: emitters refuse wrapped validators, 4 checks passed')
