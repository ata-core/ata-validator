'use strict';

// The `patternFallback` option: what happens to a pattern ata cannot show to
// run in linear time, which otherwise runs on the platform RegExp and can
// backtrack. Loaded only for a validator that sets the option to something
// other than 'platform': the Node entries register this module, and a bundle
// for a page or a Worker carries it only through ata-validator/pattern-fallback.
// Everything the option does lives here; the core holds the slot this module
// is registered in and passes the hook below to the interpreted engine. The
// 2.0 Validator's patternFallback feature and ata-validator/ir use the scan in
// lib/pattern-fallback-scan.js instead, which loads no engine.
//
// Which patterns count is decided by the interpreted engine's own compile
// (compilePattern in lib/interpreter-core.js), through its hook: it hands the
// hook every pattern bound for the platform RegExp, those it takes because
// they are plainly linear included. A pattern counts when lib/regex-linear.js
// does not prove it linear on that RegExp either, the proof the code
// generator uses to put a pattern on the RegExp. So `^\p{L}+$` runs on the
// RegExp as before, and `^(\p{L}+)+$` counts. The answer cannot drift from
// the engine, because it is the engine and the generator's own proof.
//
// The schema is scanned when the validator is built. Every object in every
// document is read, not only the places a keyword is known to hold a
// subschema: a `$ref` can point anywhere in a document, `#/default` included,
// and a scan that skipped a place a reference reaches would let that pattern
// through to the RegExp. A `pattern` string inside a `default`, `const` or
// `enum` value therefore counts too.

const { _compilePattern } = require('./interpreter-core');
const { nativeIsLinear } = require('./regex-linear');

const OUT = {};
const outside = (src) => {
  try { return _compilePattern(src, (s, re) => nativeIsLinear(s) ? re : OUT) === OUT; } catch { return false; }
};
const esc = (k) => k.replace(/~/g, '~0').replace(/\//g, '~1');

function patternFallback(mode) {
  if (mode !== 'reject' && typeof mode !== 'function') throw new TypeError("patternFallback must be 'platform', 'reject' or a function");
  const matchers = new Map();
  const get = (src, at) => {
    let m = matchers.get(src);
    if (m) return m;
    const what = `the pattern ${JSON.stringify(src)} at ${at}`;
    if (mode === 'reject') throw new Error(`patternFallback: ${what} is outside the linear-time engine and would run on a RegExp that can backtrack`);
    let flags = 'u';
    try { new RegExp(src, flags); } catch { flags = ''; }
    const r = mode(src, flags);
    if (!r || typeof r.test !== 'function') throw new TypeError(`patternFallback returned no test() for ${what}`);
    matchers.set(src, m = {
      test(s) {
        const v = r.test(s);
        if (v === true || v === false) return v;
        throw new TypeError(`patternFallback: test() returned ${typeof v}, not a boolean, for ${what}`);
      },
    });
    return m;
  };
  const walk = (node, at, seen) => {
    if (node === null || typeof node !== 'object' || seen.has(node)) return;
    seen.add(node);
    for (const k of Object.keys(node)) {
      const v = node[k], here = at + '/' + esc(k);
      if (k === 'pattern' && typeof v === 'string' && outside(v)) get(v, here);
      if (k === 'patternProperties' && v !== null && typeof v === 'object') for (const p of Object.keys(v)) if (outside(p)) get(p, here + '/' + esc(p));
      walk(v, here, seen);
    }
  };
  // What the interpreted engine asks at compile time, with the RegExp it would
  // run. A pattern the scan found is answered from the map; one it did not (a
  // custom keyword's macro writes schema no scan sees) is refused or resolved
  // here, never handed to the RegExp.
  const hook = (src, re) => nativeIsLinear(src) ? re : get(src, 'a schema the validator compiled');
  hook.matchers = matchers;
  // The key matcher for the removeAdditional and defaults passes.
  hook.key = (src) => _compilePattern(src, hook);
  hook.scan = (doc, id) => walk(doc, (id || '') + '#', new Set());
  return hook;
}

// A validator holding a matcher answers on the interpreted engine alone, the
// one engine that asks the hook, and its buffer methods through validate():
// the native walker runs patterns on RE2, not on the caller's function. A
// native engine marked ready with no fast slot is what sends them there.
const route = (v, hook) => {
  if (hook.matchers.size > 0) { v._interpretOnly = true; v._nativeReady = true; }
};

// Set up the option on a new validator: every document scanned now, so
// 'reject' throws here and a function is asked about each pattern once.
// addSchema() scans the document it is given before registering it.
patternFallback.attach = (v, raw) => {
  const hook = v._patternHook = patternFallback(v._options.patternFallback);
  hook.scan(raw);
  for (const [id, doc] of v._schemaMap) hook.scan(doc, id);
  route(v, hook);
  const add = v.addSchema;
  v.addSchema = (schema) => {
    hook.scan(schema, schema && typeof schema === 'object' && typeof schema.$id === 'string' ? schema.$id : '');
    add.call(v, schema);
    route(v, hook);
  };
};

// For what writes or runs a module compiled ahead of time, whose patterns
// stay as they were compiled: a function cannot reach them, and 'reject'
// refuses the schema given and the documents in `options.schemas`.
patternFallback.module = (options, schema) => {
  const mode = options.patternFallback;
  if (mode === undefined || mode === 'platform') return;
  if (typeof mode === 'function') throw new TypeError("patternFallback: a function cannot be carried into a compiled module, which imports nothing; 'reject' refuses such patterns at build time");
  const hook = patternFallback(mode);
  if (schema !== undefined) hook.scan(schema);
  for (const doc of Object.values(options.schemas || {})) hook.scan(doc);
};

module.exports = patternFallback;
