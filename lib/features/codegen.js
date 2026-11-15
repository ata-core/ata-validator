'use strict';
// Generated code for a validator that gets hot, for the 2.0 Validator:
// Validator.use(codegen). The full Validator with the code generator is a
// chunk of its own (lib/small-tier.js), loaded by the first hot validator,
// and not where code generation is blocked (a strict Content-Security-Policy),
// where it would decline every schema.
const { compileFunction } = require('../compile-fn');
let allowed = null;
function load() {
  if (allowed === null) { try { allowed = compileFunction('return 1')() === 1; } catch { allowed = false; } }
  return allowed ? import('../small-tier.js') : Promise.resolve(null);
}
module.exports = { codegen: Object.freeze({ name: 'codegen', load }) };
