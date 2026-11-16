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
//   for. The schema is walked once for them and for what the core needs
//   before it compiles. A word the walk finds absent is absent; one it finds,
//   or a schema the walk cannot stand for, is asked again by an exact walk of
//   every key and string.
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

// The schema last asked about, its copy and the scan of the copy, which the
// engine call that follows in _build takes.
let last = null

function core (schema, args) {
  if (args === undefined) return text(schema)
  const l = last !== null && last.schema === schema ? last : null
  last = null
  return l === null ? engine(snapshot(schema), args, null) : engine(l.copy, args, l.st)
}

function text (schema) {
  const copy = snapshot(schema)
  const st = C.scan(copy, true)
  last = { schema, copy, st }
  let f = st.facts
  if (f === null || f.errorMessage || f.default || f.format || f.metaRef || f.notFlat) f = C.facts(copy) || C.textFacts(copy)
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
const DEEP = 256
const OP = Object.prototype
const AGAIN = {}
function snapshot (schema) {
  const c = copy(schema, 0, null)
  return c === AGAIN ? copy(schema, 0, new Map()) : c
}
function copy (x, depth, seen) {
  if (typeof x !== 'object' || x === null) return x
  const arr = Array.isArray(x)
  if (!arr) { const p = Object.getPrototypeOf(x); if (p !== OP && p !== null) return x }
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
      const k = ks[i], v = copy(x[k], depth + 1, seen)
      if (v === AGAIN) return AGAIN
      if (k === '__proto__') Object.defineProperty(out, k, { value: v, writable: true, enumerable: true, configurable: true })
      else out[k] = v
    }
  }
  return out
}

module.exports = core
