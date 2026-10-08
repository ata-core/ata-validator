'use strict'

// The one place the package turns generated source into a function. Every
// generator (the verdict, error and one-pass generators, the JSON text
// scanner, the standalone-module probes) calls this instead of `new Function`
// itself, so a reader auditing what the package evaluates has one file to
// read, and a supply-chain scanner reports one site rather than seven files.
// `Function` is looked up at the call, not captured here, so an environment
// that blocks dynamic code (a Content Security Policy, a test that replaces
// the global) blocks this too, and the caller falls back to the interpreted
// engine as before.
function compileFunction (...args) {
  return new Function(...args)
}

module.exports = { compileFunction }
