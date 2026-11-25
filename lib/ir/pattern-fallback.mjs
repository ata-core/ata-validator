// The `patternFallback` option for ata-validator/ir (lib/pattern-fallback.js).
// What the IR writes or builds keeps its patterns as they were compiled, so
// the option is settled before a module is written: 'reject' refuses a schema
// with a pattern that would run on the platform RegExp without the proof that
// it is linear there, naming the pattern and its location, and a function is
// refused, since nothing the IR produces can call it. Unset or 'platform',
// nothing is read.
//
// Which patterns count is the IR's own choice of engine, matcherFor
// (lib/ir/pattern-deps.mjs), which every writer gives a pattern: one it gives
// the RegExp counts unless lib/regex-linear.js shows the RegExp to run it in
// linear time.
import fallback from '../pattern-fallback.js'
import { matcherFor } from './pattern-deps.mjs'

// For the writers of a module (specialize, tableModule, tablePlan,
// closureModule, pickModules): a function throws a TypeError. The closures
// built in memory (compileClosures, lib/ir/run.mjs) refuse the option
// themselves and do not load this file.
export function settle (schema, opts) {
  fallback.forModule(opts.patternFallback, matcherFor, schema, opts.schemas)
}
