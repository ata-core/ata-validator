'use strict'

// Which engine a pattern takes in a compiled validator, one definition for
// the code generator (lib/js-compiler.js) and for ata-validator/ir's writers
// (lib/ir). The interpreted engine keeps its own choice (compilePattern in
// lib/interpreter-core.js), the one the removeAdditional pass uses.

// The linear regex engine (safe-regex.js) is read on the first pattern a
// schema brings, not with this module: most schemas have none, and loading
// it cost every process part of its cold start. The two names keep their
// identity (compileSafe is handed to generated code as a closure value).
let _safeRe = null
const safeRe = () => _safeRe || (_safeRe = require('./safe-regex'))
function compileSafe (src) { return safeRe().compileSafe(src) }
function patternIsSafe (src) { return safeRe().patternIsSafe(src) }
// Whether a pattern goes to the linear-time engine. A pattern the platform
// RegExp also runs in linear time (nativeIsLinear) takes the RegExp: it answers
// the same, runs faster, and a compiled module that needs no other pattern
// does not carry the engine. Patterns the engine cannot represent keep the
// RegExp, as before.
// Loaded on the first pattern, so a schema without one does not pay for it.
let _nativeIsLinear = null
// The linearity check only parses; it runs first so a pattern bound for the
// RegExp is never compiled for the engine just to be told it could have been.
// A pattern is an ECMA-262 regular expression in unicode mode (JSON Schema
// Validation 6.3.3): `.` and a class match one code point, so "🐲" is one
// character, and `\p{L}` is a property escape rather than the letters p, {,
// L, }. The flag goes on every pattern that is valid with it, as the
// interpreter does (Interpreter#pattern); one that is valid only without it,
// such as `[\w-.]`, keeps working as before. It used to go only on patterns
// with a property escape, so `^.$` refused "🐲" and `^.{2}$` accepted it.
const PROP_ESCAPE = /\\[pP]\{/
function reFlags (src) {
  try { new RegExp(src, 'u'); return 'u' } catch { return '' }
}
// The flag argument for generated `new RegExp(<json literal>)` source.
function reFlagArg (jsonLit) {
  let raw
  try { raw = JSON.parse(jsonLit) } catch { return '' }
  return typeof raw === 'string' && reFlags(raw) ? ",'u'" : ''
}
const useSafeEngine = (src) => {
  if (PROP_ESCAPE.test(src)) return false
  if (_nativeIsLinear === null) _nativeIsLinear = require('./regex-linear').nativeIsLinear
  if (_nativeIsLinear(src)) return false
  return patternIsSafe(src)
}
// Whether the generators may carry a pattern at all. A pattern with a
// Unicode property escape cannot take the linear engine, so it is written
// for the platform RegExp only when that is shown to run it in linear time
// (nativeIsLinear reads the escape as one class); otherwise the schema is
// declined to the interpreted engine. `^(\p{L}+)+$` went to the RegExp
// unchecked and took a second on 28 letters and a '!'.
function patternEngineOk (src) {
  if (typeof src !== 'string' || !PROP_ESCAPE.test(src)) return true
  if (_nativeIsLinear === null) _nativeIsLinear = require('./regex-linear').nativeIsLinear
  return _nativeIsLinear(src)
}

// The matcher for a pattern: the linear engine where useSafeEngine says so,
// the platform RegExp otherwise (safeReClosure in lib/js-compiler.js, and the
// pattern keyword's closure value).
const matcherFor = (src) => useSafeEngine(src) ? compileSafe(src) : new RegExp(src, reFlags(src))

module.exports = { compileSafe, patternIsSafe, PROP_ESCAPE, reFlags, reFlagArg, useSafeEngine, patternEngineOk, matcherFor }
