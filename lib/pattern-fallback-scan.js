'use strict'

// The `patternFallback` option of the 2.0 Validator (the patternFallback
// feature, lib/features/patternFallback.js) and of ata-validator/ir: what
// happens to a pattern ata cannot show to run in linear time, which otherwise
// runs on the platform RegExp and can backtrack. The 1.x Validator's option
// is lib/pattern-fallback.js, which hooks the interpreter's compilePattern;
// this file loads no engine, so a 2.0 bundle with the feature carries none.
//
// Which patterns count is decided by the caller's own pattern compile, handed
// in as `compile`: the engine's compilePattern (lib/engine-shared.js, or
// lib/engine-shared-core.js on the plugin's core) for a Validator, matcherFor
// (lib/ir/pattern-deps.mjs) for the IR. A pattern counts when that compile
// gives it the platform RegExp and lib/regex-linear.js, the proof the code
// generator uses, does not show the RegExp to run it in linear time. So
// `^\p{L}+$` runs on the RegExp as before, and `^(\p{L}+)+$` counts. The
// answer cannot drift from the engine, because it is the engine's own choice
// and the generator's own proof.
//
// A schema is scanned when its validator is built. Every object in every
// document is read, not only the places a keyword is known to hold a
// subschema: a `$ref` can point anywhere in a document, `#/default` included,
// and a scan that skipped a place a reference reaches would let that pattern
// through to the RegExp. A `pattern` string inside a `default`, `const` or
// `enum` value therefore counts too. The engines read a keyword by name, so
// one that is not enumerable, or sits on a schema object's prototype, is read
// here as well.

// The proof is read on the first pattern asked about, not with this module.
let linear = null
const nativeIsLinear = (src) => (linear || (linear = require('./regex-linear').nativeIsLinear))(src)

const esc = (k) => k.replace(/~/g, '~0').replace(/\//g, '~1')
const OP = Object.prototype

// The names an engine can read of a schema object: its enumerable keys in
// their order, then any it holds that are not enumerable, then those of its
// prototypes short of Object.prototype.
function namesOf (node) {
  const keys = Object.keys(node)
  if (Array.isArray(node)) return keys
  let p = node
  do {
    const own = Object.getOwnPropertyNames(p)
    if (p !== node || own.length !== keys.length) for (const k of own) if (!keys.includes(k)) keys.push(k)
    p = Object.getPrototypeOf(p)
  } while (p !== null && p !== OP)
  return keys
}

// `mode` is 'reject' or the caller's function. The hook returned answers what
// runs a pattern: the caller's matcher, or what `compile` gives.
function make (mode, compile) {
  if (mode !== 'reject' && typeof mode !== 'function') throw new TypeError("patternFallback must be 'platform', 'reject' or a function")
  const matchers = new Map()
  const outside = (src) => {
    try { return compile(src) instanceof RegExp && !nativeIsLinear(src) } catch { return false }
  }
  const get = (src, at) => {
    let m = matchers.get(src)
    if (m) return m
    const what = `the pattern ${JSON.stringify(src)} at ${at}`
    if (mode === 'reject') throw new Error(`patternFallback: ${what} is outside the linear-time engine and would run on a RegExp that can backtrack`)
    let flags = 'u'
    try { new RegExp(src, flags) } catch { flags = '' }
    const r = mode(src, flags)
    if (!r || typeof r.test !== 'function') throw new TypeError(`patternFallback returned no test() for ${what}`)
    matchers.set(src, m = {
      test (s) {
        const v = r.test(s)
        if (v === true || v === false) return v
        throw new TypeError(`patternFallback: test() returned ${typeof v}, not a boolean, for ${what}`)
      },
    })
    return m
  }
  const walk = (node, at, seen) => {
    if (node === null || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)
    for (const k of namesOf(node)) {
      const v = node[k]; const here = at + '/' + esc(k)
      if (k === 'pattern' && typeof v === 'string' && outside(v)) get(v, here)
      if (k === 'patternProperties' && v !== null && typeof v === 'object') for (const p of namesOf(v)) if (outside(p)) get(p, here + '/' + esc(p))
      walk(v, here, seen)
    }
  }
  // What an engine or a pass asks when it compiles a pattern. One the scan
  // found is answered from the map; any other is compiled as the engine
  // compiles it. Where that is the RegExp without the proof, the scan did not
  // see the pattern (the schema was changed after it), and it is refused in
  // either mode, never handed to the RegExp: a function is asked only by the
  // scan, so that which engines a validator answers on is settled by then.
  const hook = (src) => {
    const m = matchers.get(src)
    if (m) return m
    const re = compile(src)
    if (re instanceof RegExp && !nativeIsLinear(src)) throw new Error(`patternFallback: the pattern ${JSON.stringify(src)} was not in the schema when it was scanned, is outside the linear-time engine and would run on a RegExp that can backtrack`)
    return re
  }
  // The removeAdditional feature asks its engine for compilePattern.
  hook.compilePattern = hook
  hook.matchers = matchers
  hook.scan = (doc, id) => walk(doc, (id || '') + '#', new Set())
  // Every document of a `schemas` option: a list of documents with an `$id`,
  // or a map of them by URI.
  hook.scanAll = (schemas) => {
    if (schemas === null || typeof schemas !== 'object') return
    if (Array.isArray(schemas)) for (const d of schemas) hook.scan(d, d && typeof d === 'object' && typeof d.$id === 'string' ? d.$id : '')
    else for (const k of Object.keys(schemas)) hook.scan(schemas[k], k)
  }
  return hook
}

// For what writes a module, whose patterns stay as they were compiled: a
// function cannot reach them, and 'reject' refuses the schema given and the
// documents in `schemas`. Unset or 'platform', nothing is read.
function forModule (mode, compile, schema, schemas) {
  if (mode === undefined || mode === 'platform') return
  if (typeof mode === 'function') throw new TypeError("patternFallback: a function cannot be carried into a compiled module, which imports nothing; 'reject' refuses such patterns at build time")
  const hook = make(mode, compile)
  hook.scan(schema)
  hook.scanAll(schemas)
}

module.exports = { make, forModule }
