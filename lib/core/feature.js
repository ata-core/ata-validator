'use strict'

// The verdict core as the engine of the 2.0 Validator (lib/validator-small.js),
// for an entry that sets it as Validator.core (index.v2.edge.mjs). A Validator
// without it answers with the small engine alone, as on a page. With it:
//
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

// The scan of the schema last asked about, which the engine call that follows
// it in _build takes.
let last = null

function core (schema, args) {
  if (args === undefined) return text(schema)
  const st = last !== null && last.root === schema ? last : null
  last = null
  return engine(schema, args, st)
}

function text (schema) {
  const st = last = C.scan(schema, true)
  let f = st.facts
  if (f === null || f.errorMessage || f.default || f.format || f.metaRef || f.notFlat) f = C.facts(schema) || C.textFacts(schema)
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
      let v = C.createVerdict(schema, args, st)
      st = null
      if (v === null || v === C.PENDING) v = explain().isValid
      e.isValid = v
      return v(d)
    },
    validate: (d) => {
      // The core compiles at a later call here, and walks the schema as it
      // is then, as the small engine did at this one.
      st = null
      if (!failing && e.isValid(d)) return { valid: true, data: d, errors: [] }
      const r = explain().validate(d)
      failing = !r.valid
      return r
    }
  }
  return e
}

module.exports = core
