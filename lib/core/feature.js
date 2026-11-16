'use strict'

// The verdict core as the engine of the 2.0 Validator (lib/validator-small.js),
// for an entry whose class carries it as `core` (index.v2.edge.mjs). A
// Validator without it answers with the small engine alone, as on a page.
// With it:
//
// - What the Validator reads of the schema at its first call is copied once
//   (snapshot below), and the questions, the core and the small engine are
//   all answered from that copy: both compile lazily, so a change the caller
//   makes to the schema object later changes neither, and the two cannot
//   disagree.
// - core(schema) is what _build asks its questions of in place of the
//   schema's JSON text: a text holding only the words those questions look
//   for, answered by the walk that copies the schema (where it cannot stand
//   for the text, by the text). The core walks the copy for what it needs
//   when it first compiles, so a validate() first call, answered by the
//   small engine, does not pay for that walk.
// - core(schema, args) is the engine. isValid is the core's verdict, compiled
//   at its first call. validate answers with the small engine on its first
//   call and while values fail (its one walk has the verdict and the errors),
//   and otherwise with the core, building the small engine only for a value
//   that fails.

const C = require('./verdict')
const { createSmall } = require('../engine-small')

// The core's later parts, required by name so that a bundle of this entry
// carries them; each is still loaded the first time a schema needs it.
C._parts(() => require('./verdict-more'), () => require('./verdict-full'))

// The schema last asked about and its copy, which the engine call that
// follows in _build takes.
let lastSchema = null
let lastCopy = null

function core (schema, args) {
  if (args === undefined) return text(schema)
  const copy = lastSchema === schema ? lastCopy : snapshot(schema)
  lastSchema = lastCopy = null
  return engine(copy, args, null)
}

function text (schema) {
  F = FA.make()
  const copy = snapshot(schema)
  let f = F
  F = null
  lastSchema = schema
  lastCopy = copy
  if (f === null) f = C.textFacts(copy)
  return (f.errorMessage ? '"errorMessage"' : '') + (f.default ? '"default"' : '') + (f.format ? '"format"' : '') +
    (f.metaRef ? '"$ref":"json-schema.org/"' : '') + (f.notFlat ? '"$id"' : '')
}

function engine (schema, args, st) {
  let small = null
  let failing = true
  const explain = () => {
    if (small === null) {
      small = createSmall(schema, args)
      if (small === null) throw new Error('ata2: keywords')
    }
    return small
  }
  const e = {
    isValid: (d) => {
      // Compiled once: a schema the core declines goes to the small engine,
      // and an error compiling it is thrown again on every call, not
      // compiled again.
      let v
      try { v = C.createVerdict(schema, args, st) } catch (err) { v = () => { throw err } }
      st = null
      if (v === null || v === C.PENDING) v = explain().isValid
      e.isValid = v
      return v(d)
    },
    validate: (d) => {
      if (!failing && e.isValid(d)) return { valid: true, data: d, errors: [] }
      const r = explain().validate(d)
      failing = !r.valid
      return r
    }
  }
  return e
}

// A copy of the plain objects and arrays of a schema, own enumerable names
// (an array's holes kept); any other value is the caller's own. A schema
// that shares or contains its own nodes runs past the depth of the first
// copy, and is copied again with a record of the nodes met.
//
// While F holds a facts record, the copy answers the questions as
// JSON.stringify's text would (lib/core/verdict.js, factWalk): each own key
// and string asked; F is dropped where the walk cannot stand for the text
// (a toJSON, an object not plain, a bigint, deep nesting).
const DEEP = 256
const OP = Object.prototype
const AGAIN = {}
const FA = C._facts
let F = null
function snapshot (schema) {
  const c = copy(schema, 0, null)
  if (c !== AGAIN) return c
  F = null
  return copy(schema, 0, new Map())
}
function copy (x, depth, seen) {
  if (typeof x !== 'object' || x === null) {
    if (F !== null) { if (typeof x === 'string') FA.str(F, x); else if (typeof x === 'bigint') F = null }
    return x
  }
  const arr = Array.isArray(x)
  if (!arr) { const p = Object.getPrototypeOf(x); if (p !== OP && p !== null) { F = null; return x } }
  if (F !== null && (depth > 200 || typeof x.toJSON === 'function')) F = null
  if (seen !== null) { const m = seen.get(x); if (m !== undefined) return m } else if (depth > DEEP) return AGAIN
  let out
  if (arr) {
    out = new Array(x.length)
    if (seen !== null) seen.set(x, out)
    for (let i = 0; i < x.length; i++) if (i in x) { const v = copy(x[i], depth + 1, seen); if (v === AGAIN) return AGAIN; out[i] = v }
  } else {
    out = Object.getPrototypeOf(x) === null ? Object.create(null) : {}
    if (seen !== null) seen.set(x, out)
    const ks = Object.keys(x)
    for (let i = 0; i < ks.length; i++) {
      const k = ks[i], xv = x[k]
      if (F !== null) FA.key(F, k, xv)
      const v = copy(xv, depth + 1, seen)
      if (v === AGAIN) return AGAIN
      if (k === '__proto__') Object.defineProperty(out, k, { value: v, writable: true, enumerable: true, configurable: true })
      else out[k] = v
    }
  }
  return out
}

module.exports = core
