'use strict'

// Bookkeeping about the schema node being emitted must not live on the compile
// context, because the context outlives the node.
//
// The generators coordinate within one node with a few flags: "this node's
// patternProperties already emitted the propertyNames check", "this node already
// emitted its key count early". Those flags were set on `ctx`, which is shared by
// the whole compile and never reset, so a node that set one made the NEXT node
// skip work it had to do:
//
//   properties: {
//     a: { patternProperties: {'^x': ...}, propertyNames: {pattern: '^x'} },
//     b: { propertyNames: {pattern: '^y'} },
//   }
//
//   validate({ b: { zzz: 1 } })   // true, and the interpreted engine says false
//
// `a` is compiled first and sets the flag; `b` then reads it and emits no
// propertyNames check at all. That is a silent accept, which is the failure mode
// this project treats as the worst one, and it was reachable on the verdict and
// combined generators.
//
// This is the same class as the deferred-additionalProperties bug fixed in
// 1.30.1: per-node state on a per-compile object. The flags are locals now, so
// the class is gone by construction rather than by a reset that a later edit
// could forget. These cases hold the behaviour.

const assert = require('node:assert')
const { Validator } = require('..')
const {
  compileToJSCodegen,
  compileToJSCodegenWithErrors,
  compileToJSCombined,
} = require('../lib/js-compiler.js')

const VALID_RESULT = { valid: true }

// Every generator that takes a shape must agree with the interpreted engine.
function bothEngines (schema, cases, label) {
  const cg = new Validator(schema)
  const interp = new Validator(schema, { engine: 'interpreter' })
  assert.strictEqual(cg.engine(), 'codegen', `${label}: must reach the code generator`)

  for (const [data, want, why] of cases) {
    assert.strictEqual(cg.validate(data).valid, want, `${label} codegen: ${why}: ${JSON.stringify(data)} should be ${want}`)
    assert.strictEqual(interp.validate(data).valid, want, `${label} interpreter: ${why}: ${JSON.stringify(data)} should be ${want}`)
  }

  const verdict = compileToJSCodegen(schema, null, null)
  const errors = compileToJSCodegenWithErrors(schema, null, null)
  const combined = compileToJSCombined(schema, VALID_RESULT, null, null)
  assert.ok(verdict, `${label}: the verdict generator must take this shape`)

  for (const [data, want, why] of cases) {
    assert.strictEqual(verdict(data), want, `${label} verdict generator: ${why}`)
    if (errors) assert.strictEqual(errors(data).valid, want, `${label} error generator: ${why}`)
    if (combined) {
      const r = combined(data)
      assert.strictEqual(r === VALID_RESULT ? true : r.valid, want, `${label} combined generator: ${why}`)
    }
  }
}

// --- propertyNames must not be skipped because a sibling handled its own ------
{
  const schema = {
    type: 'object',
    properties: {
      // compiled first, and it is the one that used to set the flag
      a: {
        type: 'object',
        patternProperties: { '^x': { type: 'number' } },
        propertyNames: { pattern: '^x' },
      },
      // compiled second, and its propertyNames check used to vanish
      b: { type: 'object', propertyNames: { pattern: '^y' } },
    },
  }

  bothEngines(schema, [
    [{ b: { yes: 1 } }, true, 'a key that matches'],
    [{ b: { zzz: 1 } }, false, 'a key that does not match'],
    [{ a: { x1: 1 } }, true, 'the sibling, clean'],
    [{ a: { q: 1 } }, false, 'the sibling, with a key that does not match'],
    [{ a: { x1: 1 }, b: { zzz: 1 } }, false, 'the sibling first, then the bad one'],
    [{}, true, 'neither present'],
  ], 'sibling propertyNames')
  console.log('ok: a sibling handling propertyNames does not disable the next one')
}

// --- and not because a child handled its own ---------------------------------
// The flag was also clobbered downward: a node's children are compiled between
// the point the flag is set and the point it is read.
{
  const schema = {
    type: 'object',
    propertyNames: { pattern: '^k' },
    properties: {
      kid: {
        type: 'object',
        patternProperties: { '^x': { type: 'number' } },
        propertyNames: { pattern: '^x' },
      },
    },
  }

  bothEngines(schema, [
    [{ kid: { x1: 1 } }, true, 'both levels match'],
    [{ kid: { q: 1 } }, false, 'the child key does not match'],
    [{ nope: 1 }, false, 'the parent key does not match'],
  ], 'nested propertyNames')
  console.log('ok: a child handling propertyNames does not disable its parent')
}

// --- the key-count shortcut is per node too ----------------------------------
// No witness was found for this one, which is why it is here: the flag is a local
// now, so a shape that would have reproduced it cannot.
{
  const schema = {
    type: 'object',
    properties: {
      a: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'], additionalProperties: false },
      b: { type: 'object', properties: { y: { type: 'number' } }, required: ['y'], additionalProperties: false },
      c: { type: 'object', properties: { z: { type: 'number' } }, required: ['z'], additionalProperties: false },
    },
  }

  bothEngines(schema, [
    [{ a: { x: 1 }, b: { y: 1 }, c: { z: 1 } }, true, 'all clean'],
    [{ b: { y: 1, extra: 2 } }, false, 'an extra key on the second'],
    [{ c: { z: 1, extra: 2 } }, false, 'an extra key on the third'],
    [{ a: { x: 1 }, c: { z: 1, extra: 2 } }, false, 'a clean one first, then an extra key'],
    [{ b: {} }, false, 'a missing required key'],
    [{ b: { extra: 2 } }, false, 'an extra key standing in for the required one'],
  ], 'sibling key counts')
  console.log('ok: one node emitting its key count early does not disable the next')
}

// --- no per-node bookkeeping is left on the context --------------------------
// The mechanical guard: a compile must not leave node-scoped flags behind, since
// that is what made both of these reachable. Anything genuinely per-compile is
// listed as allowed.
{
  const ALLOWED = new Set([
    'anchors', 'closureVals', 'closureVars', 'condDepth', 'cyclicDefs', 'defFns',
    'deferredChecks', 'helperCode', 'helpers', 'preamble', 'refStack', 'regExpMap',
    'rootDefs', 'rootSchema', 'schemaMap', 'shared', 'sourceMap', 'userFormats',
    'usesBranchCollapse', 'usesRecursion', 'usesSafeRe', 'varCounter', '_constPool',
    '_apLoopId',
    // A depth counter like refStack, not a flag: nestedGenCode raises it and
    // lowers it in a finally, so it is zero again whenever a node finishes.
    'nestedBoolean',
  ])

  const src = require('node:fs').readFileSync(require.resolve('../lib/js-compiler.js'), 'utf8')
  const seen = new Set()
  for (const m of src.matchAll(/\bctx\.([A-Za-z_][A-Za-z0-9_]*)/g)) seen.add(m[1])

  const unexpected = [...seen].filter((name) => !ALLOWED.has(name)).sort()
  assert.deepStrictEqual(
    unexpected,
    [],
    'new compile-context state: is it per-compile, or per-node? per-node state belongs in a local. ' +
      `If it is genuinely per-compile, add it to the allow list here. Found: ${unexpected.join(', ')}`,
  )
  console.log(`ok: ${seen.size} compile-context fields, none of them per-node bookkeeping`)
}

console.log('\nall node-scoped-flag checks passed')
