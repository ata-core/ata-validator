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

// Hot means TIER_CALLS calls within WINDOW_MS. A count alone is not enough:
// a form checked as the user types reaches a thousand calls over a long
// session, and generated code saves it nothing it would notice (tens of
// nanoseconds a check) while the page pays for the download and the compile.
// Measured on a form schema: interpreted 58 ns, generated 18 ns, loading the
// generator about 3.5 ms and compiling the schema 2.4 ms.
const TIER_CALLS = 1000;
const WINDOW_MS = 1000;
const now = typeof performance !== 'undefined' && typeof performance.now === 'function' ? () => performance.now() : Date.now;
// Recompiling takes a few milliseconds a validator. Each runs as its own
// task, when the page is idle where the browser says so, so that several
// validators turning hot together do not hold the main thread for all of
// them at once, and none compiles inside the call that crossed the line.
const later = typeof requestIdleCallback === 'function' ? (f) => requestIdleCallback(f, { timeout: 1000 }) : (f) => setTimeout(f, 0);

function createTiering (load) {
  let loading = null;
  // Validators that turned hot, waiting for the generator or for their turn.
  const waiting = new Set();
  let draining = null;

  function drain () {
    if (draining !== null) return draining;
    draining = new Promise((resolve) => {
      const step = () => {
        const next = waiting.values().next();
        if (next.done) { draining = null; resolve(); return; }
        waiting.delete(next.value);
        tierUp(next.value);
        later(step);
      };
      later(step);
    });
    return draining;
  }

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
    loading.then((ok) => { if (ok) drain(); else waiting.clear(); });
    return loading;
  }

  // The fields the constructor sets, the same for every validator; anything
  // else on an instance was put there by compiling it, or by a method's first
  // call, and is dropped when it is compiled again.
  let ctorKeys = null;
  const SCHEMA_KEYS = new Set(['_schemaObj', '_usesKeywords', '_schemaIsCallers']);

  // Rebuilt on generated code, in place: what compiling put on the validator
  // is dropped and it compiles again, now with the generator. In place rather
  // than by copying from a second validator because the compiled methods
  // close over the instance they were built for and swap themselves on it
  // after their first calls (the one-pass and result-factory stages); copied
  // across, those swaps would land on the copy. A caller holding a method
  // taken earlier (`const check = v.isValidObject`) keeps the interpreted
  // one, which answers the same.
  function tierUp (v) {
    if (!core._codegenRegistered() || v._tieredUp) return;
    if (ctorKeys === null) ctorKeys = new Set(Reflect.ownKeys(new core.Validator(true, {})));
    // Reset without `delete`: deleting properties turns a V8 object into a
    // slow dictionary, and every method read on the validator got slower,
    // 20 ns a check against 17 for one compiled directly (in any order; V8
    // did not step back even for the newest property). Values are swapped
    // instead, which keeps the object's shape: a method the prototype makes
    // on first use gets a fresh one, as a new validator would; any other
    // field the compile put there reads as undefined, as if absent. What the
    // schema itself resolved to (_schemaObj and the flags read with it) does
    // not change and stays.
    const proto = Object.getPrototypeOf(v);
    for (const k of Reflect.ownKeys(v)) {
      if (ctorKeys.has(k) || SCHEMA_KEYS.has(k)) continue;
      let d = null;
      for (let p = proto; p !== null && d === null; p = Object.getPrototypeOf(p)) d = Object.getOwnPropertyDescriptor(p, k) || null;
      if (d !== null && typeof d.get === 'function') d.get.call(v);
      else v[k] = d !== null ? d.value : undefined;
    }
    v._initialized = false;
    v._engine = undefined;
    v._preprocess = null;
    v._applyDefaults = null;
    Object.defineProperty(v, '_tieredUp', { value: true, writable: true, configurable: true, enumerable: false });
    v._ensureCompiled();
  }

  // A call counter for one validator: the TIER_CALLS-th call asks for the
  // generator and has the validator rebuilt once it is in.
  function counter (v) {
    let calls = 0, start = 0;
    return () => {
      if (++calls < TIER_CALLS) { if (calls === 1) start = now(); return; }
      if (calls !== TIER_CALLS) return;
      // Too slow to be hot: start a new window.
      if (now() - start > WINDOW_MS) { calls = 0; return; }
      waiting.add(v);
      if (core._codegenRegistered()) drain();
      else loadCodegen();
    };
  }

  // Count the interpreted engine's calls for this validator.
  function watch (v, interp) {
    const v0 = interp.validate, i0 = interp.isValid;
    const tick = counter(v);
    interp.validate = (d) => { tick(); return v0.call(interp, d); };
    interp.isValid = (d) => { tick(); return i0.call(interp, d); };
  }

  // The emitters stay out of the page, as they did when the generator was in
  // it (the package.json browser field maps lib/aot.js to this stub); loading
  // a built module works.
  const aotStub = () => require('./aot.browser.js');

  // Resolves once the generator has loaded (or failed to) and every validator
  // waiting for it has been rebuilt. For tests, and a page that wants to wait.
  async function settled () {
    if (loading !== null) await loading;
    while (draining !== null) await draining;
  }

  return { watch, counter, aotStub, loadCodegen, tierUp, settled, TIER_CALLS, WINDOW_MS, get loading () { return loading; } };
}

module.exports = { createTiering, TIER_CALLS };
