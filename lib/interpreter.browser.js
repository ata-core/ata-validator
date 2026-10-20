'use strict';

// The interpreted engine for the browser build (the package.json browser
// field maps lib/interpreter.js here). The plan compiler, the closure tree
// that makes the engine fast on a schema checked many times, is not in the
// page's first load: it comes through the dynamic import below, which
// bundlers split into a chunk of its own, once the page is idle after its
// first validator. Until then the plain walk answers, as it does for every
// schema's first thousand calls (TIER in lib/interpreter-core.js), with the
// same answers. Without a bundler that splits, the chunk is inlined and
// nothing changes.
const core = require('./interpreter-core');

core._setPlanCompiler(null, true);
let asked = false;
const idle = (f) => {
  if (typeof requestIdleCallback === 'function') return requestIdleCallback(f, { timeout: 2000 });
  const t = setTimeout(f, 200);
  if (t && typeof t.unref === 'function') t.unref();
};
function load() {
  import('./plan-compiler.js').then((m) => {
    const mod = m && m.install ? m : m.default;
    core._setPlanCompiler(() => mod.install);
  }, () => core._setPlanCompiler(null));
}

// The first engine built asks for it, when the page is next idle.
const create = core.createInterpreter;
core.createInterpreter = (schema, opts) => {
  if (!asked) { asked = true; idle(load); }
  return create(schema, opts);
};
module.exports = core;
