'use strict';
// The patternFallback option, for the 2.0 Validator:
// Validator.use(patternFallback). What a pattern ata cannot show to run in
// linear time gets (lib/pattern-fallback.js): 'reject' refuses the schema
// where the validator is constructed, naming the pattern and its location,
// and a function (source, flags) => ({ test }) answers for each such pattern.
// A validator given the option without the feature registered is refused,
// naming it.
//
// The Validator calls attach() from its constructor with the module its
// engine compiles patterns with (and, on the plugin's core, the linear engine
// registered).
// Every document is scanned then: the schema, the `schemas` option, and each
// document addSchema() is given, before it is registered. What the scan
// leaves on the validator is `_pf`, which the Validator hands to the small
// engine and to the removeAdditional and defaults passes in place of their
// pattern compile.
//
// A validator that holds a matcher answers on the small engine alone: the
// verdict core (lib/core/verdict.js) keeps its compiled patterns in a table
// the whole process shares, and the generated code a hot validator moves to
// (the codegen feature) is the 1.x Validator's, which writes the RegExp. So
// such a validator's `core` is set to null, which the Validator reads as no
// core, and it never tiers up. One that holds none (every pattern linear, or
// 'reject' with nothing to refuse) keeps the engines it would have had.
const { make } = require('../pattern-fallback');

const never = () => Promise.resolve(false);
const nothing = () => {};
function route (v, hook) {
  if (hook.matchers.size === 0) return;
  v.core = null;
  v._tierUp = never;
  v._count = nothing;
}

function attach (v, engine, safe) {
  const hook = v._pf = make(v._options.patternFallback, (src) => engine.compilePattern(src, safe));
  hook.scan(v._rawSchema);
  hook.scanAll(v._options.schemas);
  route(v, hook);
  const add = v.addSchema;
  v.addSchema = (schema) => {
    hook.scan(schema, schema && typeof schema === 'object' && typeof schema.$id === 'string' ? schema.$id : '');
    add.call(v, schema);
    route(v, hook);
  };
}

module.exports = { patternFallback: Object.freeze({ name: 'patternFallback', attach }) };
