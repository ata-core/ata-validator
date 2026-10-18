'use strict';

// The browser build's code generator, loaded on demand. index.browser.mjs
// registers this with the core and hands it a loader (a dynamic import, which
// bundlers split into a chunk of its own), so a page starts with the
// interpreted engine alone. A validator counts its calls; one that reaches
// TIER_CALLS asks for the generator and, once it has arrived, rebuilds itself
// on generated code. Answers are the same on either engine; what changes is
// the speed and what the page downloads. Validators that stay cold, a form
// checked as the user types, never cause the download.
//
// Kept out of lib/validator-core.js so the entries that never load the
// generator on demand (lite, edge, Node) carry none of this.
const core = require('./validator-core.js');
const { compileFunction } = require('./compile-fn.js');

const TIER_CALLS = 1000;

function createTiering (load) {
  let loading = null;
  // Validators that reached TIER_CALLS while the generator was on its way.
  const waiting = new Set();

  function loadCodegen () {
    if (loading !== null) return loading;
    let allowed;
    try { allowed = compileFunction('return 1')() === 1; } catch { allowed = false; }
    loading = !allowed
      // Code generation is blocked here (a strict Content-Security-Policy):
      // the generator would decline every schema, so it is not downloaded.
      ? Promise.resolve(false)
      : Promise.resolve().then(load).then((mod) => {
        if (!core._codegenRegistered()) core._registerCodegen(mod && mod.default ? mod.default : mod);
        return true;
      }, () => false);
    loading.then((ok) => {
      const list = [...waiting];
      waiting.clear();
      if (ok) for (const v of list) tierUp(v);
    });
    return loading;
  }

  // Rebuilt on generated code: a fresh validator for the same schema and
  // options compiles, and this one takes its compiled methods and state. A
  // caller holding a method taken earlier (`const check = v.isValidObject`)
  // keeps the interpreted one, which answers the same.
  function tierUp (v) {
    if (!core._codegenRegistered() || v._tieredUp) return;
    v._tieredUp = true;
    const fresh = new core.Validator(v._rawSchema, v._options);
    fresh._ensureCompiled();
    if (fresh._engine === 'interpreter') return;
    for (const k of Reflect.ownKeys(fresh)) Object.defineProperty(v, k, Object.getOwnPropertyDescriptor(fresh, k));
    v._tieredUp = true;
  }

  // Count the interpreted engine's calls for this validator.
  function watch (v, interp) {
    const v0 = interp.validate, i0 = interp.isValid;
    let calls = 0;
    const tick = () => {
      if (++calls !== TIER_CALLS) return;
      if (core._codegenRegistered()) { tierUp(v); return; }
      waiting.add(v);
      loadCodegen();
    };
    interp.validate = (d) => { tick(); return v0.call(interp, d); };
    interp.isValid = (d) => { tick(); return i0.call(interp, d); };
  }

  // The emitters stay out of the page, as they did when the generator was in
  // it (the package.json browser field maps lib/aot.js to this stub); loading
  // a built module works.
  const aotStub = () => require('./aot.browser.js');

  return { watch, aotStub, loadCodegen, tierUp, TIER_CALLS, get loading () { return loading; } };
}

module.exports = { createTiering, TIER_CALLS };
