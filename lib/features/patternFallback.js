'use strict';
// The patternFallback option, for the 2.0 Validator:
// Validator.use(patternFallback). What a pattern ata cannot show to run in
// linear time gets (lib/pattern-fallback.js): 'reject' refuses the schema,
// naming the pattern and its location, and a function
// (source, flags) => ({ test }) answers for each such pattern.
//
// The Validator knows nothing of the option. Until the feature is registered
// its constructor refuses it as any unknown option ("ata2: option
// patternFallback"). Registration is what makes it known: Validator.use()
// calls install() with the class, its set of known options, the small engine
// it builds with and its table of features, and everything the option does
// is put on the class here.
//
// - A validator given the option answers for it at its first use, as a 2.0
//   validator answers for everything about its schema: the schema and the
//   `schemas` option are scanned when it is first built or first given a
//   document, and addSchema() scans the document it is given before it is
//   registered. So 'reject' throws from the first validate(),
//   isValidObject() or addSchema(), not from the constructor, and a function
//   is asked about each pattern once, then. Unset or 'platform', the
//   validator is built as it would be without the feature; any other value
//   that is not 'reject' or a function throws a TypeError there.
// - Which patterns count is the engine's own choice. The Validator hands the
//   removeAdditional feature the module its engine compiles patterns with,
//   and on the plugin's core the linear engine registered; a validator built
//   here with a stand-in for that feature yields both (engineOf).
// - The matcher reaches the engine through the validator's `core`, the
//   function the Validator builds its engine with where one is set
//   (lib/validator-small.js). A validator that holds a matcher is given one
//   that builds the small engine alone: the verdict core
//   (lib/core/verdict.js) keeps its compiled patterns in a table the whole
//   process shares, and the generated code a hot validator moves to (the
//   codegen feature) is the 1.x Validator's, which writes the RegExp, so
//   such a validator also never tiers up. One that holds none (every pattern
//   linear, or 'reject' with nothing to refuse) keeps the engines it would
//   have had, with the matcher handed to its small engine, which compiles
//   a pattern with the function it is given as `pf` (lib/engine-small.js).
// - The passes of a validator that holds a matcher are built with it. While
//   such a validator is built, the removeAdditional feature in the class's
//   table is one that hands the pass the matcher as its engine, and that is
//   asked for whether or not the option is set, since it is handed the
//   schema the passes read. The Validator's own defaults pass is left out
//   (lib/defaults.js on the full entries, which 1.x shares and which takes
//   no matcher) and one built from lib/defaults-match.js with the matcher
//   runs after the others, where defaults run.
const { make } = require('../pattern-fallback');

const never = () => Promise.resolve(false);
const nothing = () => {};
const text = (schema) => JSON.stringify(schema) || '';
const set = (mode) => mode !== undefined && mode !== 'platform';
const idOf = (schema) => schema && typeof schema === 'object' && typeof schema.$id === 'string' ? schema.$id : '';

const installed = new WeakSet();
function install (Validator, KNOWN, createSmall, features) {
  if (installed.has(Validator)) return;
  installed.add(Validator);
  KNOWN.add('patternFallback');
  const P = Validator.prototype;
  const build = P._build;
  const add = P.addSchema;
  const tierUp = P._tierUp;

  // The module the Validator's engine compiles patterns with, and the linear
  // engine it is given now: what the Validator hands removeAdditional.
  const engineOf = () => {
    const removal = features.removeAdditional;
    let got;
    features.removeAdditional = { build (schema, safe, engine) { got = [engine, safe]; return null; } };
    try { build.call(new Validator({}, { removeAdditional: true })); } finally { features.removeAdditional = removal; }
    return got;
  };

  // The validator's matcher for patterns, made and given the schema and the
  // `schemas` option to scan the first time it is asked for.
  const hookOf = (v) => {
    if (v._pf !== undefined) return v._pf;
    const [engine, safe] = engineOf();
    const hook = make(v._options.patternFallback, (src) => engine.compilePattern(src, safe));
    hook.scan(v._rawSchema);
    hook.scanAll(v._options.schemas);
    return (v._pf = hook);
  };

  P.addSchema = function (schema) {
    if (set(this._options.patternFallback)) hookOf(this).scan(schema, idOf(schema));
    return add.call(this, schema);
  };

  // Asked before the validator's first use, as after it: one that holds a
  // matcher does not move to generated code.
  P._tierUp = function () {
    return set(this._options.patternFallback) && hookOf(this).matchers.size > 0 ? never() : tierUp.call(this);
  };

  P._build = function () {
    const o = this._options;
    if (!set(o.patternFallback)) return build.call(this);
    const hook = hookOf(this);
    const small = (schema, args) => args === undefined ? text(schema) : createSmall(schema, { ...args, pf: hook });
    if (hook.matchers.size === 0) {
      // The entry's own `core` (the edge entry's verdict core), if it has one.
      const own = Object.getPrototypeOf(this).core;
      this.core = own ? (schema, args) => own(schema, args && { ...args, pf: hook }) : small;
      return build.call(this);
    }
    this.core = small;
    this._count = nothing;
    const removal = features.removeAdditional;
    let pre;
    features.removeAdditional = {
      build (schema, safe) {
        pre = schema;
        if (!o.removeAdditional) return null;
        if (!removal) throw new Error('ata2: removeAdditional, Validator.use(removeAdditional)');
        return removal.build(schema, safe, hook);
      },
    };
    this._options = Object.create(o, { removeAdditional: { value: true }, useDefaults: { value: false } });
    let engine;
    try { engine = build.call(this); } finally { features.removeAdditional = removal; this._options = o; }
    const fill = o.useDefaults === false ? null : require('../defaults-match').buildDefaultsApplier(pre, hook);
    if (fill !== null) { const first = this._fill; this._fill = first === null ? fill : (d) => { first(d); fill(d); }; }
    return engine;
  };
}

module.exports = { patternFallback: Object.freeze({ name: 'patternFallback', install }) };
