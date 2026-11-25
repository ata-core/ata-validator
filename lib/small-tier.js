'use strict';

// What a 2.0 page loads when one of its validators gets hot (see
// lib/validator-small.js): the full Validator with the code generator. The
// small Validator hands its calls to one built here from the same schema and
// options, which answers the same on generated code.
const core = require('./validator-core.js');
if (!core._codegenRegistered()) core._registerCodegen(require('./codegen-engine.js'));
// A validator with the patternFallback feature tiers up only once its scan
// found no pattern outside the linear-time engine
// (lib/features/patternFallback.js), so the option has nothing left to do on
// generated code. The 1.x Validator reads it as its own option, which needs
// lib/pattern-fallback.js registered; it is handed the same options with that
// one read as unset, every other read and copy going to the caller's object.
const NO_PF = { get: (o, k, r) => k === 'patternFallback' ? undefined : Reflect.get(o, k, r) };
const withoutPf = (opts) => opts !== null && typeof opts === 'object' && opts.patternFallback !== undefined ? new Proxy(opts, NO_PF) : opts;
module.exports = { full: (schema, opts) => new core.Validator(schema, withoutPf(opts)) };
