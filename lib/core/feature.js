'use strict'

// The verdict core as the engine of the 2.0 Validator (lib/validator-small.js),
// for an entry whose class carries it as `core` (index.v2.edge.mjs). A
// Validator without it answers with the small engine alone, as on a page.
// With it:
//
// - Both engines are built from the one schema object _build hands over, and
//   compile parts of it later. The schema is read-only once a Validator is
//   built from it, as for the 1.x Validator (docs/API.md): a change made to
//   it afterwards is unsupported input.
// - core(schema) is what _build asks its questions of in place of the
//   schema's JSON text: a text holding only the words those questions look
//   for, answered by one walk of every key and string (where it cannot stand
//   for the text, by the text). The core walks the schema for what it needs
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
// carries them; each is loaded the first time a schema needs it.
C._parts(() => require('./verdict-more'), () => require('./verdict-full'))

function core (schema, args) {
  return args === undefined ? text(schema) : engine(schema, args)
}

function text (schema) {
  const f = C.facts(schema) || C.textFacts(schema)
  return (f.errorMessage ? '"errorMessage"' : '') + (f.default ? '"default"' : '') + (f.format ? '"format"' : '') +
    (f.metaRef ? '"$ref":"json-schema.org/"' : '') + (f.notFlat ? '"$id"' : '')
}

function engine (schema, args) {
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
      try { v = C.createVerdict(schema, args) } catch (err) { v = () => { throw err } }
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

module.exports = core
