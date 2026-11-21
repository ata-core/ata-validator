'use strict';

// The `patternFallback` option: what happens to a pattern the linear-time
// engine (lib/safe-regex.js) cannot represent, which otherwise runs on the
// platform RegExp and can backtrack. Loaded only for a validator that sets the
// option to something other than 'platform'.
//
// Which patterns count is decided by the interpreted engine's own compile
// (compilePattern in lib/interpreter-core.js), asked through its hook: a
// pattern counts exactly when that compile would hand it to the platform
// RegExp without having shown it to run in linear time there. The answer
// cannot drift from the engine, because it is the engine.
//
// The schema is scanned when the validator is built. Every object in every
// document is read, not only the places a keyword is known to hold a
// subschema: a `$ref` can point anywhere in a document, `#/default` included,
// and a scan that skipped a place a reference reaches would let that pattern
// through to the RegExp. A `pattern` string inside a `default` or `const`
// value therefore counts too.

const { _compilePattern } = require('./interpreter-core');

const OUT = {};
const outside = (src) => {
  try { return _compilePattern(src, () => OUT) === OUT; } catch { return false; }
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
  // What the engines ask at compile time. A pattern the scan found is
  // answered from the map; one it did not (a custom keyword's macro writes
  // schema no scan sees) is refused or resolved here, never handed to the
  // RegExp.
  const hook = (src) => get(src, 'a schema the validator compiled');
  hook.matchers = matchers;
  hook.scan = (doc, id) => walk(doc, (id || '') + '#', new Set());
  // Scans a document of validator `v`. One holding a matcher answers on the
  // interpreted engine alone, the one engine that asks the hook.
  hook.add = (v, doc, id) => {
    hook.scan(doc, id);
    if (matchers.size > 0) v._interpretOnly = true;
  };
  return hook;
}

// Set up the option on a new validator: every document scanned now, so
// 'reject' throws here and a function is asked about each pattern once.
patternFallback.attach = (v, raw) => {
  const hook = v._patternHook = patternFallback(v._options.patternFallback);
  hook.add(v, raw);
  for (const [id, doc] of v._schemaMap) hook.add(v, doc, id);
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
