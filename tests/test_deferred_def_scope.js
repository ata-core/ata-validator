'use strict'

// A `$defs` entry that is both self-recursive and carries `additionalProperties:
// false` had its key check written into the wrong function.
//
// `additionalProperties` is deferred to the end of the emitted function, because
// V8 optimizes the body better when the key walk is last. The deferral list hung
// off the compile context, and the context is shared with the named helper that a
// def on a `$ref` cycle is emitted as. So the def's check was flushed into
// whichever function was being compiled when the def was reached, carrying the
// def's own list of allowed keys:
//
//   $defs.f = { properties: { not: {$ref: '#/$defs/f'} }, additionalProperties: false }
//   root    = { properties: { id: { anyOf: [{type:'integer'}, {$ref:'#/$defs/f'}] } } }
//
//   function _body(d){
//     ...
//     for(var _k in d)if(_k!=="not")return false    // the root, with f's keys
//     return true
//   }
//
// So `{id: 1}` was rejected: `id` is not `not`. The two engines disagreed and the
// interpreted one was right. On the combined generator the same list was never
// flushed at all, which drops the constraint instead of misplacing it, and that
// is the silent accept.
//
// Present in 1.27.1, 1.29.0 and 1.30.0. Both directions are checked here: valid
// documents are accepted, and the def's own constraint still rejects.

const assert = require('node:assert')
const { Validator } = require('..')
const { compileToJSCodegen, compileToJSCodegenWithErrors, compileToJSCombined } = require('../lib/js-compiler.js')

const VALID_RESULT = { valid: true }

// A recursive def whose key set differs from the root's, which is what made the
// misplacement visible rather than harmless.
const schema = {
  $defs: {
    f: {
      type: 'object',
      properties: { not: { $ref: '#/$defs/f' } },
      additionalProperties: false,
    },
  },
  type: 'object',
  properties: { id: { anyOf: [{ type: 'integer' }, { $ref: '#/$defs/f' }] } },
  additionalProperties: false,
}

const cases = [
  [{ id: 1 }, true, 'an integer id'],
  [{}, true, 'an empty document'],
  [{ id: {} }, true, 'the def with no keys'],
  [{ id: { not: { not: {} } } }, true, 'the def nested through itself'],
  [{ id: { nope: 1 } }, false, "a key the def does not allow"],
  [{ id: { not: { nope: 1 } } }, false, 'the same, one level down'],
  [{ id: 'x' }, false, 'a string id matches neither branch'],
  [{ other: 1 }, false, "a key the root does not allow"],
]

// --- the engines agree, and both are right ----------------------------------
{
  const cg = new Validator(schema)
  const interp = new Validator(schema, { engine: 'interpreter' })
  assert.strictEqual(cg.engine(), 'codegen', 'this shape must reach the code generator')
  assert.strictEqual(interp.engine(), 'interpreter')

  for (const [data, want, why] of cases) {
    const got = cg.validate(data).valid
    assert.strictEqual(got, want, `codegen: ${why}: ${JSON.stringify(data)} should be ${want}, got ${got}`)
    const gotI = interp.validate(data).valid
    assert.strictEqual(gotI, want, `interpreter: ${why}: ${JSON.stringify(data)} should be ${want}, got ${gotI}`)
  }
  console.log('ok: both engines agree on a recursive def with additionalProperties')
}

// --- each generator on its own ----------------------------------------------
// The three entry points build their own contexts, so a fix in one says nothing
// about the others. A generator that declines is not a failure; one that answers
// wrongly is.
{
  const verdict = compileToJSCodegen(schema, null, null)
  const errors = compileToJSCodegenWithErrors(schema, null, null)
  const combined = compileToJSCombined(schema, VALID_RESULT, null, null)

  assert.ok(verdict, 'the verdict generator must take this shape')

  for (const [data, want, why] of cases) {
    assert.strictEqual(verdict(data), want, `verdict generator: ${why}: ${JSON.stringify(data)}`)

    if (errors) {
      const r = errors(data)
      assert.strictEqual(r.valid, want, `error generator: ${why}: ${JSON.stringify(data)}`)
    }
    if (combined) {
      const r = combined(data)
      const ok = r === VALID_RESULT ? true : r.valid
      assert.strictEqual(ok, want, `combined generator: ${why}: ${JSON.stringify(data)}`)
    }
  }
  console.log('ok: every generator that takes the shape answers the same')
}

// --- the check does not land in the root's function --------------------------
// The verdicts above are what matters, but they only diverge when the two key
// sets differ. Reading the emitted root pins the cause. The def's own function
// lives in the closure the root is built in, so it is not in this source; what
// is checkable here, and what was wrong, is the root body.
{
  // The root allows one key, the def allows another. The root's walk must name
  // the root's key, and must not name the def's.
  const rootBody = compileToJSCodegen(schema, null, null).toString()
  assert.ok(/for\s*\(var _k in d\)if\(_k!=="id"\)/.test(rootBody), `the root's key walk should be its own, got:\n${rootBody}`)
  assert.ok(!/_k!=="not"/.test(rootBody), `the def's key set leaked into the root, got:\n${rootBody}`)

  // And with no `additionalProperties` on the root at all, the root body must
  // carry no key walk. This is the shape as it was reported.
  const rootFree = { ...schema }
  delete rootFree.additionalProperties
  const freeBody = compileToJSCodegen(rootFree, null, null).toString()
  assert.ok(!/for\s*\(var _k in d\)/.test(freeBody), `a root with no additionalProperties should have no key walk, got:\n${freeBody}`)
  console.log("ok: the def's key walk is not emitted into the root's function")
}

// --- a def on a cycle reached from a sub-schema variable ----------------------
// The root case above is the one that was reported. This is the same fault seen
// from `anyOf`, where the enclosing generator compiles into a sub-function and
// the deferral list would otherwise outlive it.
{
  const nested = {
    $defs: {
      node: {
        type: 'object',
        properties: { child: { $ref: '#/$defs/node' }, tag: { type: 'string' } },
        additionalProperties: false,
      },
    },
    type: 'object',
    properties: {
      value: { anyOf: [{ type: 'null' }, { $ref: '#/$defs/node' }] },
      count: { type: 'integer' },
    },
  }

  const cg = new Validator(nested)
  const interp = new Validator(nested, { engine: 'interpreter' })
  const nestedCases = [
    [{ count: 3 }, true],
    [{ value: null, count: 3 }, true],
    [{ value: { tag: 'a', child: { tag: 'b' } } }, true],
    [{ value: { tag: 'a', bad: 1 } }, false],
    [{ value: { child: { bad: 1 } } }, false],
    [{ value: { tag: 7 } }, false],
  ]
  for (const [data, want] of nestedCases) {
    assert.strictEqual(cg.validate(data).valid, want, `codegen: ${JSON.stringify(data)} should be ${want}`)
    assert.strictEqual(interp.validate(data).valid, want, `interpreter: ${JSON.stringify(data)} should be ${want}`)
  }
  console.log('ok: a cyclic def reached through anyOf keeps its own key set')
}

console.log('\nall deferred-def-scope checks passed')
