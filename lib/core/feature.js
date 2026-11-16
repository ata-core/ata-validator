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
//   for, answered by a walk of every key and string (where it cannot stand
//   for the text, by the text). Which walk depends on how the validators
//   before this one were first used. Where the last one's first call was a
//   verdict (isValidObject, or validate with abortEarly), the walk is the
//   core's scan, which the core's first compile then takes, so the schema is
//   walked once. Where it was validate(), answered by the small engine, the
//   walk gathers the answers alone (it is cheaper than the scan), and the
//   core walks the schema itself if it compiles later. A guess that is wrong
//   costs that validator one walk, never an answer.
// - core(schema, args) is the engine. isValid is the core's verdict, compiled
//   at its first call. validate answers with the small engine on its first
//   call; a validator whose first value failed stays with it, and one whose
//   first value passed asks the core first until failures pass a quarter of
//   its calls (see Engine.validate).

const C = require('./verdict')
const { createSmall } = require('../engine-small')

// The core's later parts, required by name so that a bundle of this entry
// carries them; each is loaded the first time a schema needs it.
C._parts(() => require('./verdict-more'), () => require('./verdict-full'))

// The scan of the schema text() was last asked about, for the engine call
// that follows it in _build.
let last = null
// Whether the last validator to be used was first asked for a verdict.
let verdictFirst = true

function core (schema, args) {
  if (args === undefined) return text(schema)
  const st = last !== null && last.root === schema ? last : null
  last = null
  return engine(schema, args, st)
}

function text (schema) {
  let f = null
  if (verdictFirst) f = (last = C.scan(schema, true)).facts
  else last = null
  if (f === null) f = C.facts(schema) || C.textFacts(schema)
  return (f.errorMessage ? '"errorMessage"' : '') + (f.default ? '"default"' : '') + (f.format ? '"format"' : '') +
    (f.metaRef ? '"$ref":"json-schema.org/"' : '') + (f.notFlat ? '"$id"' : '')
}

function engine (schema, args, st) {
  return new Engine(schema, args, st)
}

// One object per validator, its methods shared by all: a validator costs no
// closures, and the Validator's calls into it reach one function each.
class Engine {
  constructor (schema, args, st) {
    this.schema = schema
    this.args = args
    // The scan text() made, until the core compiles or the small engine is
    // built (a validator whose first call is validate() does not keep it).
    this.st = st
    this.small = null
    this.compiled = false
  }

  explain () {
    if (this.small === null) {
      this.st = null
      if (!this.compiled) verdictFirst = false
      const small = createSmall(this.schema, this.args)
      if (small === null) throw new Error('ata2: keywords')
      this.small = small
    }
    return this.small
  }

  // Compiled once, then the validator's own isValid: a schema the core
  // declines goes to the small engine, and an error compiling it is thrown
  // again on every call, not compiled again.
  isValid (d) {
    this.compiled = true
    if (this.small === null) verdictFirst = true
    let v
    try { v = C.createVerdict(this.schema, this.args, this.st) } catch (err) { v = () => { throw err } }
    this.st = null
    if (v === null || v === C.PENDING) v = this.explain().isValid
    this.isValid = v
    return v(d)
  }

  // The first call is the small engine's: its one walk has the verdict and
  // the errors. Its answer decides what validate becomes, as this
  // validator's own property, so later calls pay no frame for the choice:
  // - it failed: the small engine's validate itself, for good;
  // - it passed: the core first, and the small engine for a value the core
  //   fails. Once more than a quarter of at least 8 calls have failed, the
  //   small engine's validate itself, for good (a failing value would
  //   otherwise be checked twice).
  validate (d) {
    const e = this
    const sv = this.explain().validate
    const r = sv(d)
    if (!r.valid) { commit(e, sv); return r }
    let calls = 1, fails = 0
    e.validate = (x) => {
      calls++
      if (e.isValid(x)) return { valid: true, data: x, errors: [] }
      const y = sv(x)
      if (++fails * 4 > calls && calls >= 8) commit(e, sv)
      return y
    }
    return r
  }
}

// validate is the small engine's from now on. The core's tree goes with the
// choice, so a committed validator keeps nothing of the core: isValid is the
// compiling method again, and an isValidObject call after this compiles
// once more.
function commit (e, sv) {
  e.validate = sv
  if (e.compiled) { e.compiled = false; e.isValid = Engine.prototype.isValid }
}

module.exports = core
