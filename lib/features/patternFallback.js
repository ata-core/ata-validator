'use strict';
// The patternFallback option, for the 2.0 Validator:
// Validator.use(patternFallback). What a pattern ata cannot show to run in
// linear time gets (lib/pattern-fallback.js): 'reject' refuses the schema
// where the validator is constructed, naming the pattern and its location,
// and a function (source, flags) => ({ test }) answers for each such pattern.
// A validator given the option without the feature registered is refused,
// naming it.
//
// The Validator asks for the feature as it asks for the others an option
// names, where the option is set: its constructor calls attach() for any
// value that is not falsy, with the small engine it builds with. All the
// option does is here.
//
// - 'platform' is the default, and attach() leaves the validator as it is.
//   Any other value that is not 'reject' or a function throws.
// - Which patterns count is the engine's own choice. The small engine hands
//   what compiles its patterns to the function it is given as `pf`
//   (lib/engine-small.js), so a one-pattern engine built here yields the
//   compile the validator's engine will use, with the linear engine
//   registered on the plugin's core.
// - Every document is scanned then: the schema, the `schemas` option, and
//   each document addSchema() is given, before it is registered.
// - The matcher for patterns the scan leaves reaches the engine through the
//   validator's `core`, the function the Validator builds its engine with
//   where one is set (lib/validator-small.js). A validator that holds a
//   matcher is given one that builds the small engine alone: the verdict core
//   (lib/core/verdict.js) keeps its compiled patterns in a table the whole
//   process shares, and the generated code a hot validator moves to (the
//   codegen feature) is the 1.x Validator's, which writes the RegExp, so
//   such a validator also never tiers up. One that holds none (every pattern
//   linear, or 'reject' with nothing to refuse) keeps the engines it would
//   have had, with the matcher handed to its small engine.
// - The removeAdditional pass takes the matcher as its engine, and the
//   defaults pass is built from lib/defaults-match.js with it: the full
//   entries' own pass (lib/defaults.js, which 1.x shares) takes no matcher.
const { make } = require('../pattern-fallback');

const never = () => Promise.resolve(false);
const nothing = () => {};
const text = (schema) => JSON.stringify(schema) || '';

function attach (v, createSmall) {
  const mode = v._options.patternFallback;
  if (mode === 'platform') return;
  // The engine's pattern compile, and the linear engine it is given.
  let compile; let safe;
  createSmall({ pattern: '' }, { flat: true, pf: (src, s, c) => { safe = s; compile = c; return c(src, s); } }).isValid('');
  const hook = v._pf = make(mode, (src) => compile(src, safe));
  hook.buildDefaultsApplier = (schema) => require('../defaults-match').buildDefaultsApplier(schema, hook);
  // The entry's own `core` (the edge entry's verdict core), if it has one.
  const own = Object.getPrototypeOf(v).core;
  const small = (schema, args) => args === undefined ? text(schema) : createSmall(schema, { ...args, pf: hook });
  const route = () => {
    if (hook.matchers.size > 0) {
      v.core = small;
      v._tierUp = never;
      v._count = nothing;
    } else v.core = own ? (schema, args) => own(schema, args && { ...args, pf: hook }) : small;
  };
  hook.scan(v._rawSchema);
  hook.scanAll(v._options.schemas);
  route();
  const add = v.addSchema;
  v.addSchema = (schema) => {
    hook.scan(schema, schema && typeof schema === 'object' && typeof schema.$id === 'string' ? schema.$id : '');
    add.call(v, schema);
    route();
  };
}

module.exports = { patternFallback: Object.freeze({ name: 'patternFallback', attach }) };
