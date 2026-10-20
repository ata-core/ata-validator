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
    if (warm === 1) warm = 2;
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

  // A page's first check pays for V8 compiling the engine and the error
  // builders (3.1 ms of an eight-field form's first submit, 0.4 ms once any
  // other schema had been checked) and for building its own schema's engine.
  // Both move to when the page is idle, or 200 ms later where there is no
  // requestIdleCallback (Safari, workers): one check of a small schema, once
  // per page and dropped when a validator compiles first, then the engine for
  // each validator built since, at most eight, kept aside. A validator adopts
  // it at its first check only if every input is still the same, its schema
  // text included, so addSchema() or a change to the schema in between is
  // honored as before.
  // warm: 0 none, 1 scheduled, 2 done or dropped.
  let warm = 0, scheduled = false, warming = false, adopted = 0;
  const pending = [];
  const shadows = new WeakMap();
  const idle = (f) => {
    if (typeof requestIdleCallback === 'function') return requestIdleCallback(f, { timeout: 2000 });
    const t = setTimeout(f, 200);
    if (t && typeof t.unref === 'function') t.unref();
  };
  function built (v) {
    if (warming) return;
    if (warm === 0) warm = 1;
    if (pending.length < 8 && typeof WeakRef === 'function') pending.push(new WeakRef(v));
    if (!scheduled) { scheduled = true; idle(run); }
  }
  function run (deadline) {
    scheduled = false;
    if (warm === 1) {
      warm = 2;
      warming = true;
      try { warmUp(); } catch { /* a warm-up never reaches the page */ }
      warming = false;
    }
    while (pending.length > 0) {
      if (deadline !== undefined && deadline.timeRemaining() < 1) { scheduled = true; idle(run); return; }
      const v = pending.shift().deref();
      if (v === undefined || core._codegenRegistered()) continue;
      let s = null;
      try { s = prebuild(v); } catch { /* built as usual at the first check */ }
      if (s !== null) shadows.set(v, s);
    }
  }

  // One check of a small schema, rejected and accepted, compiles the engine's
  // code for the page: the plan builder, the walk, the regex and format
  // checks, the error builders.
  function warmUp () {
    const v = new core.Validator({
      type: 'object',
      properties: {
        a: { type: 'string', minLength: 2, maxLength: 9, pattern: '^[a-z]+$', format: 'email' },
        b: { type: 'integer', minimum: 1, maximum: 9 },
        c: { type: 'array', items: { type: 'string' }, maxItems: 3 },
        d: { const: true },
        e: { type: 'object', properties: { f: { type: 'string' } }, required: ['f'] },
      },
      required: ['a', 'b'],
    });
    void v.validate({ a: '1', b: 0, c: [1], d: false, e: {} }).errors.length;
    v.validate({ a: 'ab@c.de', b: 2, c: ['x'], d: true, e: { f: 'x' } });
  }

  // The engine a validator will build at its first check, built now from the
  // same inputs and kept aside; null where something besides the schema object
  // decides the build: custom keywords (their compile functions are the
  // caller's code), registered schemas, a schema that needs rewriting.
  function prebuild (v) {
    if (v._initialized || v._keywords !== null || v._schemaMap.size !== 0) return null;
    const raw = v._rawSchema;
    const { _interpArgs, _normalizeCallerSchemaUncached } = core._internals;
    if (raw === null || typeof raw !== 'object' || _normalizeCallerSchemaUncached(raw) !== raw) return null;
    const args = _interpArgs(v, raw);
    return { schema: raw, text: JSON.stringify(raw), args, interp: require('./interpreter').createInterpreter(raw, args) };
  }

  function adopt (v, schemaObj, args) {
    const s = shadows.get(v);
    if (s === undefined) return null;
    shadows.delete(v);
    if (s.schema !== schemaObj || s.text !== v._schemaStr) return null;
    for (const k of Object.keys(args)) if (args[k] !== s.args[k]) return null;
    adopted++;
    return s.interp;
  }

  // Count the interpreted engine's calls for this validator.
  function watch (v, interp) {
    if (warm === 1) warm = 2;
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

  return { watch, counter, built, aotStub, loadCodegen, settled, TIER_CALLS, WINDOW_MS, get loading () { return loading; }, get warm () { return warm; }, get adopted () { return adopted; }, adopt };
}

module.exports = { createTiering, TIER_CALLS };
