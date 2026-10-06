'use strict';

// All ahead-of-time (AOT) code generation lives here so the default and browser
// entries can stay free of `fs`, `path`, and `__dirname`.
// Browser bundles get `lib/aot.browser.js` instead (see package.json `browser`
// field), which throws if anyone tries to call an AOT function from the browser.
//
// Public surface (called by index.js and ata-validator/build):
//   toStandalone(validator)
//   toStandaloneModule(validator, opts)
//   bundle(Validator, schemas, opts)
//   bundleStandalone(Validator, schemas, opts)
//   bundleCompact(Validator, schemas, opts)
//   loadBundle(Validator, mods, schemas, opts)

const { compileToJSCodegenWithErrors, compileToJSCodegen, compileToJSCombined, unevalContributions } = require('./js-compiler');
const VALID_RESULT = Object.freeze({ valid: true, errors: Object.freeze([]) });
const { buildTargetedPositionMap } = require('./data-positions');
const { schemaHash } = require('./schema-hash');
const ATA_VERSION = require('./version');
const safeRegexEngineSource = () => require('./safe-regex').engineSource();

// Embedded verbatim in standalone modules so the output file has no runtime
// dependency on ata-validator. ASCII fast-path plus surrogate-aware slow path.
const _CP_LEN_SOURCE = `function _cpLen(s) {
  const len = s.length;
  for (let i = 0; i < len; i++) {
    if (((s.charCodeAt(i) - 0xD800) >>> 0) < 0x400) {
      let n = 0; for (const _ of s) n++; return n;
    }
  }
  return len;
}`;

// The linear-time regex engine, embedded in standalone modules whose patterns
// need it so the output does not depend on ata-validator at run time. The text
// is the engine's own function (lib/safe-regex.js), called once for the
// `__ataSafeRe` the emitted code uses. No fs, path or __dirname, so this is
// safe in browser bundles, and the engine has no eval or new Function, so the
// embed is CSP-safe.
let _safeRegexEmbed = null;
function getSafeRegexEmbed() {
  if (_safeRegexEmbed === null) {
    _safeRegexEmbed = 'const __ataSafeRe = (' + safeRegexEngineSource() + ')().compileSafe;';
  }
  return _safeRegexEmbed;
}

// Returns the engine embed when any supplied compiled function references the
// safe matcher (jsFn._usesSafeRe), else an empty string so non-pattern modules
// pay zero bytes.
function safeRePrelude(...fns) {
  return fns.some((f) => f && f._usesSafeRe) ? getSafeRegexEmbed() + '\n' : '';
}

// Serialize the closure variables a compiled function referenced (regexes,
// sets, lookup tables, preprocessor functions) into declarations for load
// scope. Regex lines are no longer inlined into _source, so every emitter
// must declare them exactly once outside the emitted function; inlining them
// in the body recompiled the pattern on every call.
function closureDeclLines(jsFn, declKW) {
  const kw = declKW || 'const';
  const lines = [];
  if (!jsFn || !jsFn._closures || jsFn._closures.length === 0) return lines;
  for (const { name, val } of jsFn._closures) {
    if (Array.isArray(val)) { lines.push(`${kw} ${name} = ${JSON.stringify(val)};`); continue; }
    if (val && val.__ataSafe) {
      lines.push(`${kw} ${name} = __ataSafeRe(${JSON.stringify(val.source)});`);
    } else if (val instanceof RegExp) {
      const flags = val.flags;
      lines.push(`${kw} ${name} = new RegExp(${JSON.stringify(val.source)}${flags ? ', ' + JSON.stringify(flags) : ''});`);
    } else if (val instanceof Set) {
      lines.push(`${kw} ${name} = new Set(${JSON.stringify([...val])});`);
    } else if (typeof val === 'function') {
      // new Function('_ppv', body) — extract body from toString()
      const str = val.toString();
      const m = str.match(/^function[^(]*\([^)]*\)\s*\{([\s\S]*)\}$/);
      const body = m ? m[1].trim() : str;
      lines.push(`${kw} ${name} = function(_ppv) { ${body} };`);
    }
  }
  return lines;
}

// A validator can enforce more than its schema says. `withKeywords` from
// @ata-project/keywords wraps an instance's entry points, and a wrapper
// declares that by setting `_externalChecks`. The emitters below build their
// module from the compiled schema alone, so a wrapped instance would emit a
// module that accepts documents the validator itself rejects. Refuse instead.
// Declining to compile is recoverable. A module that wrongly accepts is not.
function assertEmittable(validator, fnName) {
  if (validator._usesKeywords) {
    throw new Error(fnName + ': a schema that uses custom keywords cannot be compiled into a standalone module (option "keywords")');
  }
  if (validator._externalChecks) {
    throw new Error(fnName + ': this validator enforces checks that are not in its schema, so a standalone module would be weaker than the validator it came from. Those checks come from a wrapper such as withKeywords() from @ata-project/keywords, and JSON Schema has no spelling for them. Compile the unwrapped validator if the extra checks are not needed.');
  }
}

// --- Standalone pre-compilation ---
// Generate a JS module string that can be written to a file.
// On next startup, load with Validator.fromStandalone() -- zero compile time.
function toStandalone(validator) {
  assertEmittable(validator, 'toStandalone');
  validator._ensureCompiled();
  const jsFn = validator._jsFn;
  if (!jsFn || !jsFn._source) return null;
  const src = jsFn._source;
  const hybridSrc = jsFn._hybridSource || '';
  const preambleSrc = jsFn._preambleSource || '';

  // Also capture error function source for zero-compile standalone load
  const jsErrFn = compileToJSCodegenWithErrors(
    typeof validator._schemaObj === 'object' ? validator._schemaObj : {},
  );
  const errSrc = jsErrFn && jsErrFn._errSource ? jsErrFn._errSource : '';

  const closureSrc = closureDeclLines(jsFn).join('\n');
  return `// Auto-generated by ata-validator ${ATA_VERSION}, do not edit
'use strict';
${_CP_LEN_SOURCE}
${safeRePrelude(jsFn, jsErrFn)}${preambleSrc}
${closureSrc ? closureSrc + '\n' : ''}const boolFn = function(d) {
  ${src}
};
const hybridFactory = function(R, E) {
  return function(d) {
    ${hybridSrc}
  };
};
${errSrc ? `const errFn = function(d, _all) {\n  ${errSrc}\n};` : 'const errFn = null;'}
module.exports = { boolFn, hybridFactory, errFn };
`;
}

// --- Fully standalone module ---
// Generates a self-contained module that can be imported directly without
// pulling in ata-validator at runtime. Browser bundle gets only the
// generated validator (~2 KB typical) instead of the 165 KB compiler.
//
//   import { validate, isValid } from './user-validator.mjs'
//   if (isValid(data)) { ... }
//
// format: 'esm' | 'cjs'. Default 'esm'.
// abortEarly: if true, invalid result is a shared stub; smaller output.

// Custom format functions in standalone output.
//
// 'embed' (default) writes each function's source into the module through
// Function#toString. That only works for a plain function: one that closes
// over nothing and is not rewritten by a coverage or transpile step (istanbul
// injects `cov_` counters; a bundler may hoist helpers). The check below
// rejects those at build time with a named error instead of emitting a module
// that throws on first use.
//
// 'inject' writes no function source. The module exports `setFormats(map)`
// and each format is looked up from that registry when a value is checked,
// so the caller supplies the functions at load time.
function emitFormatDecls(closures, mode, declKW) {
  if (!closures || closures.length === 0) return { decls: '', exportsSetFormats: false };
  if (mode === 'inject') {
    let out = `${declKW} __formats = Object.create(null);\n`;
    out += `function setFormats(map) { for (const k in map) __formats[k] = map[k]; }\n`;
    for (const { name, format } of closures) {
      const key = JSON.stringify(format === null ? name.slice(4) : format);
      out += `${declKW} ${name} = function (v) { const f = __formats[${key}]; if (typeof f !== 'function') throw new Error('ata: format ' + ${key} + ' is not registered; call setFormats({ [' + ${key} + ']: fn }) before validating'); return f(v); };\n`;
    }
    return { decls: out, exportsSetFormats: true };
  }
  let out = '';
  for (const { name, fn, format } of closures) {
    const src = fn.toString();
    const label = format === null ? name : format;
    if (/\bcov_[A-Za-z0-9_$]+\b/.test(src)) {
      throw new Error(`ata: custom format "${label}" is instrumented for coverage and cannot be embedded; use { formatMode: 'inject' } and register it with setFormats() at load time`);
    }
    try {
      // eslint-disable-next-line no-new-func
      new Function('return (' + src + ')');
    } catch {
      throw new Error(`ata: custom format "${label}" has no standalone source (a bound function, a class method, or a native); use { formatMode: 'inject' } and register it with setFormats() at load time`);
    }
    out += `${declKW} ${name} = ${src};\n`;
  }
  return { decls: out, exportsSetFormats: false };
}

const { emitClone, inlineRefsForClone } = require('./clone-emit');

// The schema-source frames the error function names, as `__ataSS[i]`. Each
// is built once, frozen, from a [line, col, text index] row, with every source
// line's text written once. Frozen, so sharing one object between reads is safe.
function sourceFrameDecls(frames, schemaFile) {
  if (!frames || frames.size === 0) return '';
  const texts = [];
  const textIndex = new Map();
  const rows = [];
  for (const f of frames.values()) {
    let i = textIndex.get(f.text);
    if (i === undefined) { i = texts.length; texts.push(f.text); textIndex.set(f.text, i); }
    rows[f.index] = `[${f.line},${f.col},${i}]`;
  }
  return `const __ataSF = ${JSON.stringify(schemaFile)};\n` +
    `const __ataSL = ${JSON.stringify(texts)};\n` +
    `const __ataSS = [${rows.join(',')}].map((r) => Object.freeze({ file: __ataSF, line: r[0], col: r[1], text: __ataSL[r[2]] }));\n`;
}

// The one-pass function as the module's error path. The runtime's validate()
// becomes this function once a validator's errors are read (compileToJSCombined):
// it checks and collects in one walk, with a verdict per subtree so an
// accepted subtree is never collected over. The module used to carry the
// older collector instead, which walked everything and built every path: on
// a 175 KB SchemaStore schema and a 15 KB document with two errors, 61 µs
// against 12 for this function (a report from a config validator measured
// 2 to 2.7x against the default validator on 84 to 234 KB schemas, and
// guessed at the position pass, which costs 11). The program's closure
// values are written out as declarations, the runtime helpers it shares
// with every other program as their source, and a oneOf/anyOf branch
// verdict compiled on its own as a module of its own inside an IIFE. Null
// where a value has no source form (a custom format, a keyword check), and
// the module keeps the older collector.
const ONE_PASS_RT = new Set(['_cpLen', '_A', '_ap', '_sr', '_srX', '_ER', '_EE', '_SRT', '_FB', '_VF', '__ataSafeRe']);
function onePassCore(validator, opts) {
  if (validator._userFormats && Object.keys(validator._userFormats).length) return null;
  const schemaObj = typeof validator._schemaObj === 'object' ? validator._schemaObj : null;
  if (schemaObj === null) return null;
  let emit;
  try {
    // No schema map, as for the older collector: a module carries one
    // document. (The program could embed what a remote reference resolves to,
    // but the wrapper that applies defaults around a module cannot see into
    // another document, and would then answer differently from the runtime.)
    emit = compileToJSCombined(schemaObj, VALID_RESULT, null, null, {
      // runtimeShape: the program the runtime runs, literal for literal (the
      // other shape of this generator is not what validate() runs and is
      // not held to the suite); the codes and links its literals leave out
      // are added once in _ER below.
      moduleShape: true, emit: true, runtimeShape: true,
      resultShape: { Rejection: function (e) { this.valid = false; this.errors = e; }, empty: Object.freeze([]), sort: (e) => e, fallback: () => ABORT_SHAPE, verdict: null },
    });
  } catch { return null; }
  if (!emit || typeof emit !== 'object') return null;
  const rt = require('./combined-runtime');
  const { DEQ_HELPER, PTR_ESC_HELPER, OWN_HELPER_CODE } = require('./js-compiler')._helperSources;
  // The helpers' source without their comments and indentation.
  const compact = (fn) => fn.toString().replace(/^\s*\/\/.*$/mg, '').replace(/\n\s*/g, '\n').replace(/\n+/g, '\n');
  const decls = [];
  const args = [];
  const own = new Set();
  const addOwn = (n) => { if (own.has(n)) return; own.add(n); if (n === '_h' || n === '_hall') addOwn('_hop'); if (n === '_ok') { addOwn('_PN'); addOwn('_hop'); } decls.push(OWN_HELPER_CODE[n]); };
  let usesSafeRe = emit.usesSafeRe, usesCollapse = false;
  for (let i = 0; i < emit.names.length; i++) {
    const name = emit.names[i], val = emit.values[i];
    if (name === 'R') { args.push('VALID'); continue; }
    if (name === '_cpLen') { args.push('_cpLen'); continue; }
    if (name === '__ataSafeRe') { usesSafeRe = true; args.push('__ataSafeRe'); continue; }
    if (name === '_A') { decls.push('const _A={mo:true,lo:-1,on:0,os:[]};'); args.push('_A'); continue; }
    if (name === '_ap') { decls.push(compact(rt.multiBranch) + '\nconst _ap=' + compact(rt.ap) + ';'); args.push('_ap'); continue; }
    if (name === '_sr') { decls.push('const _sr=' + compact(rt.sr) + ';'); args.push('_sr'); continue; }
    // The checked sort compares with the reader, which a module has no use for.
    if (name === '_srX') { args.push('null'); continue; }
    // Rejections: the plain shape every module reports, with the code and the
    // documentation link the runtime would derive from the keyword.
    if (name === '_ER') { args.push('_ER'); continue; }
    if (name === '_EE') { args.push('Object.freeze([])'); continue; }
    if (name === '_SRT') { args.push('function(e){return e}'); continue; }
    if (name === '_FB') { args.push('function(){return ABORT}'); continue; }
    if (name === '_VF') { args.push('null'); continue; }
    if (name === '_PN') { addOwn('_PN'); args.push('_PN'); continue; }
    if (name === '_OP' || name === '_gp') { addOwn('_PN'); args.push(name); continue; }
    if (name === '_hop' || name === '_h' || name === '_ok' || name === '_hall') { addOwn(name); args.push(name); continue; }
    if (name === '_pe') { decls.push(PTR_ESC_HELPER); args.push('_pe'); continue; }
    if (name === '_deq') { decls.push(DEQ_HELPER); args.push('_deq'); continue; }
    if (name === '_anT') { decls.push('function _anT(){return true}'); args.push('_anT'); continue; }
    if (name === '_anF') { decls.push('function _anF(){return false}'); args.push('_anF'); continue; }
    if (name === '_rb') { decls.push('function _rb(S,m){if(S.length!==m)S.length=m}'); args.push('_rb'); continue; }
    if (name === '__ataCollapse' || name === '__ataMulti') { usesCollapse = true; args.push(name); continue; }
    const expr = serializeClosure(val, name);
    if (expr === null) return null;
    decls.push(`const ${name}=${expr};`);
    args.push(name);
  }
  if (usesCollapse) decls.unshift(require('./branch-collapse').embedSource());
  const core = `${decls.join('\n')}\nreturn (function(${emit.names.join(',')}){${emit.source}})(${args.join(',')});`;
  // The keywords and formats the program can report, for the code table.
  const keywords = new Set(), formats = new Set();
  for (const m of core.matchAll(/keyword:'([A-Za-z$]+)'/g)) keywords.add(m[1]);
  for (const m of core.matchAll(/format:'([A-Za-z0-9-]+)'/g)) formats.add(m[1]);
  return { core, usesSafeRe, keywords, formats };
}
// A closure value as source: a pattern, a name set, a frozen error literal,
// or a verdict compiled on its own (compileToJSCodegen output, which carries
// its source and its own closures). Null for anything else.
function serializeClosure(val, name) {
  if (val === null || val === undefined) return String(val);
  if (val && val.__ataSafe) return `__ataSafeRe(${JSON.stringify(val.source)})`;
  if (val instanceof RegExp) return `new RegExp(${JSON.stringify(val.source)}${val.flags ? ', ' + JSON.stringify(val.flags) : ''})`;
  if (val instanceof Set) return `new Set(${JSON.stringify([...val])})`;
  if (Array.isArray(val)) return JSON.stringify(val);
  if (typeof val === 'function') {
    if (typeof val._source !== 'string') return null;
    const inner = [];
    if (val._closures) {
      for (const { name: n, val: v } of val._closures) {
        if (n === '__ataSafeRe') continue;
        const e = serializeClosure(v, n);
        if (e === null) return null;
        inner.push(`const ${n}=${e};`);
      }
    }
    return `(function(){${inner.join('\n')}\n${val._preambleSource || ''}return function(d){${val._source}}})()`;
  }
  if (typeof val === 'object') {
    // A frozen error literal of a static site: it gets its code and link
    // here, once, since the module runs in strict mode and could not add
    // them to a frozen object when it is reported.
    let v = val;
    if (typeof val.keyword === 'string' && typeof val.schemaPath === 'string' && val.code === undefined) {
      // The same rule as enrich (lib/enrich-error.js): a property that
      // dependentRequired asks for is `required` with code ATA7005.
      const c = val.keyword === 'required' && val.schemaPath.endsWith('/dependentRequired') ? 'ATA7005' : require('./error-codes').codeFor(val.keyword, val.params && val.params.format);
      if (c !== null) v = Object.assign({ code: c }, val, { docUrl: 'https://ata-validator.com/e/' + c });
    }
    try { const t = JSON.stringify(v); if (t === undefined) return null; return `Object.freeze(${t})`; } catch { return null; }
  }
  if (typeof val === 'number' || typeof val === 'boolean' || typeof val === 'string') return JSON.stringify(val);
  return null;
}
// keyword -> code for the one-pass module's rejections (lib/error-codes.js),
// holding only the keywords and formats the program can report.
function codeTableSource(keywords, formats) {
  const { CODES } = require('./error-codes');
  const byKw = {}, byFmt = {};
  // The same first-writer rule as codeFor in lib/error-codes.js.
  for (const code of Object.keys(CODES).sort()) {
    const c = CODES[code];
    if (keywords.has(c.keyword) && byKw[c.keyword] === undefined) byKw[c.keyword] = code;
    if (c.keyword === 'format' && c.format && formats.has(c.format) && byFmt[c.format] === undefined) byFmt[c.format] = code;
  }
  return `const _ataKw = ${JSON.stringify(byKw)};\nconst _ataFmt = ${JSON.stringify(byFmt)};\nfunction _ataCode(k, f) { if (k === 'format' && f) { const h = _ataFmt[f]; return h === undefined ? 'ATA3099' : h; } const h = _ataKw[k]; return h === undefined ? null : h; }\n`;
}

const ABORT_SHAPE = Object.freeze({ valid: false, errors: Object.freeze([Object.freeze({ code: 'ATA9000', message: 'validation failed', keyword: '__abort_early__', path: '' })]) });

function toStandaloneModule(validator, opts) {
  assertEmittable(validator, 'toStandaloneModule');
  validator._ensureCompiled();
  const jsFn = validator._jsFn;
  if (!jsFn || !jsFn._source) return null;
  const format = (opts && opts.format) || 'esm';
  const abortEarly = !!(opts && opts.abortEarly);
  const source = !!(opts && opts.source);
  const sourceMap = opts && opts.sourceMap ? opts.sourceMap : null;
  const schemaFile = opts && opts.schemaFile ? opts.schemaFile : null;
  const src = jsFn._source;

  let errCore = '';
  let jsErrFn = null;
  const sourceFrames = new Map();
  // Schema-source frames are attached by the older collector only; a module
  // built with them keeps it. Otherwise the one-pass function takes the
  // error path when asked for (`onePass: true`) and when the older collector
  // declines the schema, where the module reported one stub error before.
  // Not by default elsewhere: the one-pass program carries a verdict per
  // subtree and a counting copy per branch, and its module is 1.3 to 1.7
  // times the older one, gzipped, which a bundle notices more than it
  // notices a rejected document's cost. A build that validates large
  // documents against large schemas asks for it.
  let onePass = null;
  const wantOnePass = opts && opts.onePass === true ? 'always' : (opts && (opts.onePass === false || opts.noOnePass)) ? 'never' : 'auto';
  // Asked for explicitly, the one-pass function wins over schema-source
  // frames, which `ata compile` writes by default outside production; the
  // caller is told, since it asked for both.
  if (wantOnePass === 'always' && source && sourceMap && schemaFile) {
    if (opts && typeof opts.onWarning === 'function') opts.onWarning('schema-source frames are not written with the one-pass error function; the module carries the one-pass function and no frames (pass --no-source to silence this)', { kind: 'source-frames' });
  }
  if (!abortEarly && (wantOnePass === 'always' || !(source && sourceMap && schemaFile)) && wantOnePass !== 'never') {
    let errLen = 1;
    if (wantOnePass === 'auto') {
      const probe = compileToJSCodegenWithErrors(typeof validator._schemaObj === 'object' ? validator._schemaObj : {}, null, validator._userFormats, null);
      errLen = probe && probe._errSource ? probe._errSource.length : 0;
    }
    if (wantOnePass === 'always' || errLen === 0) onePass = onePassCore(validator, opts);
  }
  if (onePass !== null) {
    errCore = `function _ataStamp(e) { for (let i = 0; i < e.length; i++) { const x = e[i]; if (x.code === undefined) { const c = x.keyword === 'required' && typeof x.schemaPath === 'string' && x.schemaPath.endsWith('/dependentRequired') ? 'ATA7005' : _ataCode(x.keyword, x.params && x.params.format); if (c !== null) { x.code = c; x.docUrl = 'https://ata-validator.com/e/' + c; } } else if (x.docUrl === undefined) x.docUrl = 'https://ata-validator.com/e/' + x.code; if (x.branchErrors !== undefined) _ataStamp(x.branchErrors); } }\n` +
      `const _ER = function(e) { _ataStamp(e); this.valid = false; this.errors = e; };\n` +
      `${codeTableSource(onePass.keywords, onePass.formats)}const _vC = (function() {\n${onePass.core}\n})();\n`;
  } else if (!abortEarly) {
    jsErrFn = compileToJSCodegenWithErrors(
      typeof validator._schemaObj === 'object' ? validator._schemaObj : {},
      null,
      validator._userFormats,
      (source && sourceMap && schemaFile) ? { sourceMap, schemaFile, frames: sourceFrames } : null,
    );
    const errSrc = jsErrFn && jsErrFn._errSource ? jsErrFn._errSource : '';
    if (errSrc && jsErrFn._errFactory) {
      // The helpers (patterns, name sets, definition and branch functions) are
      // built once, not on every call. With $defs the
      // cycle guard's state sits beside them, so a call made while one is
      // running takes a function from a fresh factory call.
      // Built on the first error read rather than at import, so a page that
      // only ever accepts pays nothing for them at load.
      const fac = jsErrFn._errFactory;
      errCore = jsErrFn._errGuarded
        ? `const _mkErr = function() {\n  ${fac}\n};\nlet _errMain = null;\nlet _errBusy = false;\nconst errFn = function(d, _all) { if (_errBusy) return _mkErr()(d, _all); if (_errMain === null) _errMain = _mkErr(); _errBusy = true; try { return _errMain(d, _all); } finally { _errBusy = false; } };\n`
        : `const _mkErr = function() {\n  ${fac}\n};\nlet _errMain = null;\nconst errFn = function(d, _all) { return (_errMain || (_errMain = _mkErr()))(d, _all); };\n`;
    } else if (errSrc) {
      errCore = `const errFn = function(d, _all) {\n  ${errSrc}\n};\n`;
    } else if (opts && typeof opts.onWarning === 'function') {
      // The caller asked for error detail and is not getting it: the error
      // generator declined this schema (unevaluated* and a few other shapes),
      // and a standalone module has no interpreted engine to fall back to the
      // way the runtime validator does. The module still ships, with the
      // verdict exact, but every failure reports the single ATA9000 stub.
      // Silence here cost a user a debugging session; hence the channel.
      // The second argument names which capability degraded, so a build that
      // requested several can tell this warning from a parse decline instead
      // of treating any warning as "errors degraded".
      opts.onWarning(
        'error detail could not be generated for this schema; the module reports failures as the single ATA9000 abort-early error. The verdict is unaffected. For detailed errors, validate failing documents with the runtime Validator.',
        { kind: 'error-detail' }
      );
    }
  }

  // Schema-source frames are baked as literals inside each emitted error so
  // consumers don't need a runtime lookup. We still expose the schema file
  // as a sentinel constant when --source is on — handy for introspection
  // and visible in source graphs. With --no-source, the constant is omitted
  // entirely so size budgets and grep-based "is this source-mapped?" checks
  // both work.
  const schemaSourceConst = (source && schemaFile)
    ? `const __ATA_SCHEMA_SOURCE__ = ${JSON.stringify({ file: schemaFile })};\n` + sourceFrameDecls(sourceFrames, schemaFile)
    : '';

  // Serialize closure vars referenced in _fn body: regex, sub-validators, sets.
  let closureDecls = '';
  {
    const lines = closureDeclLines(jsFn);
    if (lines.length) closureDecls = lines.join('\n') + '\n';
  }

  // A few helpers are self-contained and named the same wherever they appear,
  // the email check being the big one at about 2.7 KB. The boolean function
  // and the error function each hoisted their own copy, so every module that
  // used a format carried it twice. They are declared once at module scope
  // here and removed from both bodies. Everything else in the preamble stays
  // where it is: emitConstant and the generated branch checks name things per
  // compilation, and two of them at module scope would collide.
  const sharedDecls = [];
  {
    const seen = new Set();
    for (const fn of [jsFn, jsErrFn]) {
      if (!fn || !fn._sharedHelpers) continue;
      for (const h of fn._sharedHelpers) if (!seen.has(h)) { seen.add(h); sharedDecls.push(h); }
    }
    if (sharedDecls.length && errCore) {
      for (const h of sharedDecls) errCore = errCore.split(h).join('');
    }
  }
  const sharedBlock = sharedDecls.length ? sharedDecls.join('\n') + '\n' : '';

  // Hoisted oneOf/anyOf branch checks live in the boolean fn's preamble (the
  // runtime emits them before the function). The standalone module must declare
  // them at module scope too, or _fn references undefined names (e.g. _af1_b0).
  const sharedSet = new Set(sharedDecls);
  const preambleParts = jsFn._preambleParts
    ? jsFn._preambleParts.filter((part) => !sharedSet.has(part))
    : null;
  const preambleBody = preambleParts !== null
    ? (preambleParts.length ? preambleParts.join('\n  ') + '\n  ' : '')
    : (jsFn._preambleSource || '');
  const preambleDecls = preambleBody || (jsFn._preambleGuard || '')
    ? (jsFn._preambleParts ? (jsFn._preambleGuard || '') + preambleBody : preambleBody) + '\n'
    : '';

  // User-supplied format functions are referenced as _uf_<name> by both the
  // boolean (_fn) and error (errFn) bodies. Embed them via Function#toString
  // so the standalone module stays self-contained.
  const fmt = emitFormatDecls(jsFn._formatClosures, opts && opts.formatMode, 'const');
  const formatDecls = fmt.decls;

  const validBody = onePass !== null
    ? 'return _vC(data)'
    : errCore
      ? 'return _fn(data) ? VALID : { valid: false, errors: errFn(data, true).errors }'
      : 'return _fn(data) ? VALID : ABORT';

  // parse(): validate, then hand back a copy holding only the properties the
  // schema declares. Off by default: it costs bytes in every emitted module,
  // and the reason to compile a schema ahead of time is usually to ship as
  // little as possible. Ask for it with { parse: true }.
  // Local acyclic $refs are inlined first, so the schemas generators emit
  // ($defs + $ref everywhere) still get a parse(). When the clone is still
  // not provable, the decline is loud: the caller asked for parse and is not
  // getting it, and discovering that by reading the export list cost a user
  // an afternoon. Same channel as the error-detail decline above.
  let cloneExpr = null;
  if (opts && opts.parse) {
    const baseSchema = typeof validator._schemaObj === 'object' ? validator._schemaObj : null;
    cloneExpr = baseSchema ? emitClone(inlineRefsForClone(baseSchema), 'data', 0) : null;
    if (!cloneExpr && typeof opts.onWarning === 'function') {
      opts.onWarning(
        'parse() could not be generated for this schema: the rebuild is only emitted where the allowed key set is provable, and a remaining $ref (cyclic, external, or carrying constraining siblings), patternProperties, applicators next to an open key set, or an unconstrained additionalProperties makes it someone else\'s decision. The module ships without a parse export; validate and strip with the runtime Validator instead.',
        { kind: 'parse' }
      );
    }
  }
  // Named _ataParse rather than parse: the emitted module also carries the
  // safe-regex prelude, which has a module-scope parse() of its own for
  // reading patterns. A second declaration of that name shadowed it and the
  // prelude called this one instead, reaching _fn before its initialiser ran.
  const parseCore = cloneExpr
    ? `function _ataParse(data) {\n  if (!_fn(data)) { const e = new Error('validation failed'); e.name = 'AtaValidationError'; throw e; }\n  return ${cloneExpr};\n}\n`
    : '';

  // validateJSON(): parse the text, validate, and on failure attach a
  // dataFrame (byte offset, line, col, source line) to every error by
  // walking the original text once. Off by default for the same reason as
  // parse(): it costs bytes in every emitted module. Ask for it with
  // { positions: true }. The walker is the runtime's buildTargetedPositionMap,
  // embedded verbatim via toString so the two cannot drift; that is why the
  // function in lib/data-positions.js must stay self-contained. It is given the
  // pointers the errors name, which is the only thing this module looks up, so a
  // subtree that cannot hold one is scanned to its end and never walked: framing
  // an error went from 8.02x a JSON.parse of the document to 1.72x, and 3.11x in
  // the worst case of a pointer at the very end. It is also 125 characters
  // smaller than the full-map builder it replaces.
  const positionsCore = !(opts && opts.positions) ? '' : `const _ataPosMap = ${buildTargetedPositionMap.toString()};
function _ataFrame(p) { return { byteOffset: p.byteOffset, length: p.length, line: p.line, col: p.col, text: p.text }; }
function validateJSON(text) {
  const s = String(text);
  let data;
  try { data = JSON.parse(s); } catch (e) {
    const nl = s.indexOf(String.fromCharCode(10));
    let frame = { byteOffset: 0, length: s.length, line: 1, col: 1, text: nl === -1 ? s : s.slice(0, nl) };
    try { const m = _ataPosMap(s, new Set([''])); if (m['']) frame = _ataFrame(m['']); } catch (_) {}
    return { valid: false, errors: [{ code: 'ATA9001', message: 'invalid JSON document', keyword: '__parse__', path: '', instancePath: '', dataFrame: frame }] };
  }
  const r = validate(data);
  if (r.valid || !r.errors || !r.errors.length) return r;
  let map;
  const _want = new Set();
  for (const e of r.errors) _want.add(e.instancePath != null ? e.instancePath : (e.path || ''));
  try { map = _ataPosMap(s, _want); } catch (_) { return r; }
  const errors = r.errors.map((e) => {
    const ptr = e.instancePath != null ? e.instancePath : (e.path || '');
    const p = map[ptr];
    return p ? Object.assign({}, e, { dataFrame: _ataFrame(p) }) : e;
  });
  return { valid: false, errors };
}
`;

  const baseNames = cloneExpr ? 'validate, isValid' : 'validate, isValid';
  // The content hash of the schema this module was compiled from, over the
  // schema as the caller wrote it (before dialect normalization), so a build
  // can compare it against schemaHash(currentSchema) and know the module is
  // stale without embedding its own fingerprint.
  const hashSrc = schemaHash(validator._rawSchema !== undefined ? validator._rawSchema : validator._schemaObj);
  // The schema hash answers "is this module built from a different schema" and
  // nothing else. Upgrading ata and not re-running the generate step leaves the
  // hash matching, so the stale module reads as current. The module cannot ask
  // the installed ata itself, since it imports nothing, so it carries the
  // version that wrote it and a build compares that too.
  const hashDecl = `const schemaHash = ${JSON.stringify(hashSrc)};\nconst ataVersion = ${JSON.stringify(ATA_VERSION)};\n`;

  let names = fmt.exportsSetFormats ? baseNames + ', setFormats' : baseNames;
  names += ', schemaHash, ataVersion';
  if (positionsCore) names += ', validateJSON';
  const parseAlias = cloneExpr ? ', _ataParse as parse' : '';
  const parseProp = cloneExpr ? ', parse: _ataParse' : '';
  const exports = format === 'esm'
    ? `export { ${names}${parseAlias} };\nexport default { ${names}${parseProp} };\n`
    : `module.exports = { ${names}${parseProp} };\nmodule.exports.default = module.exports;\n`;

  let degradedNote = (!abortEarly && !errCore)
    ? '// NOTE: error detail was requested but could not be generated for this\n// schema; failures report the single ATA9000 abort-early error. The verdict\n// is exact. Validate failing documents with the runtime Validator for detail.\n'
    : '';
  if (opts && opts.parse && !cloneExpr) {
    degradedNote += '// NOTE: parse() was requested but could not be generated for this schema;\n// the module has no parse export. Validate and strip with the runtime Validator.\n';
  }
  return `// Auto-generated by ata-validator ${ATA_VERSION}, do not edit.
// Schema is embedded; runtime has zero dependency on ata-validator.
// Re-run the build after upgrading ata: the version above is what wrote this.
${degradedNote}'use strict';
${_CP_LEN_SOURCE}
${safeRePrelude(jsFn, jsErrFn, onePass !== null && onePass.usesSafeRe ? { _usesSafeRe: true } : null)}${schemaSourceConst}const VALID = Object.freeze({ valid: true, errors: Object.freeze([]) });
const ABORT = Object.freeze({
  valid: false,
  errors: Object.freeze([Object.freeze({
    code: 'ATA9000',
    message: 'validation failed',
    keyword: '__abort_early__',
    path: '',
  })]),
});
${closureDecls}${sharedBlock}${preambleDecls}${formatDecls}const _fn = function(d) {
  ${src}
};
${errCore}function isValid(data) { return _fn(data); }
function validate(data) { ${validBody}; }
${parseCore}${positionsCore}${hashDecl}${exports}`;
}

// Bundle multiple validators into a single JS file for fast startup.
// Usage:
//   const bundle = Validator.bundle([schema1, schema2, ...]);
//   fs.writeFileSync('validators.js', bundle);
//   // On startup:
//   const validators = Validator.loadBundle(require('./validators.js'), [schema1, schema2, ...]);
function bundle(Validator, schemas, opts) {
  if (opts && opts.keywords && Object.keys(opts.keywords).length > 0) {
    throw new Error('bundle: custom keywords cannot be compiled into a standalone module (option "keywords")');
  }
  const parts = schemas.map((schema) => {
    const v = new Validator(schema, opts);
    const standalone = toStandalone(v);
    if (!standalone) return 'null';
    return (
      '(function(){' +
      standalone
        .replace("'use strict';", '')
        .replace('module.exports = ', 'return ') +
      '})()'
    );
  });
  return "'use strict';\nmodule.exports = [\n" + parts.join(',\n') + '\n];\n';
}

// Zero-dependency self-contained bundle — no require('ata-validator') needed at runtime.
// opts.format: 'cjs' (default) or 'esm'.
// opts.formats: { name: fn } — embedded in the output via Function#toString.
function bundleStandalone(Validator, schemas, opts) {
  // A custom keyword is a function, and a standalone module imports nothing,
  // so there is no way to carry it. Refuse rather than emit a module that
  // silently ignores the keyword.
  if (opts && opts.keywords && Object.keys(opts.keywords).length > 0) {
    throw new Error('bundleStandalone: custom keywords cannot be compiled into a standalone module (option "keywords")');
  }
  // Cross-schema $ref resolution: only meaningful when at least one schema has
  // an $id. Skip the schemas-as-map plumbing when none of them do.
  const haveIds = schemas.some((s) => s && typeof s === 'object' && s.$id);
  const bundleOpts = haveIds ? { ...(opts || {}), schemas } : (opts || {});
  const format = (opts && opts.format) || 'cjs';
  const R = 'Object.freeze({valid:true,errors:Object.freeze([])})';
  let bundleUsesSafeRe = false;
  let bundleInjects = false;
  // Pass one compiles; pass two emits. The helpers that several schemas hoist
  // are the same text declaring the same name, so the bundle keeps one copy at
  // module scope, and pass two needs to know the set before it writes anything.
  const compiledEntries = schemas.map((schema) => {
    const v = new Validator(schema, bundleOpts);
    v._ensureCompiled();
    const jsFn = v._jsFn;
    if (!jsFn || !jsFn._hybridSource) return null;
    // The schema the validator compiled, not the one the caller passed. They
    // differ whenever anything prepared the schema: draft-07 normalization,
    // `format` removed under assertFormat: false, keywords outside the
    // dialect's vocabularies. Reading the original here would leave the
    // boolean path and the error path disagreeing about the same document.
    const jsErrFn = compileToJSCodegenWithErrors(
      v._schemaObj,
      v._schemaMap,
      v._userFormats,
    );
    if (jsFn._usesSafeRe || (jsErrFn && jsErrFn._usesSafeRe)) bundleUsesSafeRe = true;
    return { v, jsFn, jsErrFn };
  });

  const sharedDecls = [];
  {
    const seen = new Set();
    for (const e of compiledEntries) {
      if (!e) continue;
      for (const fn of [e.jsFn, e.jsErrFn]) {
        if (!fn || !fn._sharedHelpers) continue;
        for (const h of fn._sharedHelpers) if (!seen.has(h)) { seen.add(h); sharedDecls.push(h); }
      }
    }
  }
  const sharedSet = new Set(sharedDecls);

  const fns = compiledEntries.map((e) => {
    if (!e) return 'null';
    const { v, jsFn, jsErrFn } = e;
    let errBody =
      jsErrFn && jsErrFn._errSource
        ? jsErrFn._errSource
        : "return{valid:false,errors:[{code:'error',path:'',message:'validation failed'}]}";
    for (const h of sharedDecls) errBody = errBody.split(h).join('');
    // Custom format closures: embedded, or bound to the bundle-level
    // registry when opts.formats is 'inject'.
    let preamble = '';
    if (jsFn._formatClosures) {
      const f = emitFormatDecls(jsFn._formatClosures, opts && opts.formatMode, 'var');
      preamble = f.decls.replace(/^var __formats = [^\n]*\n|^function setFormats[^\n]*\n/gm, '');
      if (f.exportsSetFormats) bundleInjects = true;
    }
    // Include hoisted anyOf/oneOf branch helpers (e.g. `_af1_b0`) so the
    // bundle output is self-contained, minus anything lifted to module scope.
    const kept = jsFn._preambleParts
      ? jsFn._preambleParts.filter((part) => !sharedSet.has(part))
      : null;
    const preambleSrc = kept !== null
      ? (jsFn._preambleGuard || '') + (kept.length ? kept.join('\n  ') + '\n  ' : '')
      : (jsFn._preambleSource || '');
    if (preambleSrc) preamble = preamble ? `${preamble}\n${preambleSrc}` : preambleSrc;
    const closureSrc = closureDeclLines(jsFn, 'var').join('\n');
    if (closureSrc) preamble = preamble ? `${preamble}\n${closureSrc}\n` : closureSrc + '\n';
    if (opts && opts.verbose) {
      // Embed the schema and a small resolver so errors carry parentSchema.
      const schemaLit = JSON.stringify(v._schemaObj);
      return `(function(R){${preamble}var _S=${schemaLit};function _PS(p){if(!p||p[0]!=='#')return undefined;var s=p.slice(1);if(!s)return _S;var ps=s.split('/').filter(Boolean).map(function(x){return x.replace(/~1/g,'/').replace(/~0/g,'~')});var t=_S;for(var i=0;i<ps.length-1;i++){if(t==null||typeof t!=='object')return undefined;t=t[ps[i]]}return t}var E=function(d){var _all=true;${errBody}};var _v=function(d){${jsFn._hybridSource}};return function(d){var r=_v(d);if(r&&r.valid===false&&r.errors){var es=[];for(var i=0;i<r.errors.length;i++){var e=r.errors[i];es.push(Object.assign({},e,{parentSchema:_PS(e.schemaPath)}))}return{valid:false,errors:es}}return r}})(R)`;
    }
    return `(function(R){${preamble}var E=function(d){var _all=true;${errBody}};return function(d){${jsFn._hybridSource}}})(R)`;
  });
  const arr = `[${fns.join(',')}]`;
  const safeEmbed = (bundleUsesSafeRe ? getSafeRegexEmbed() + '\n' : '') +
    (sharedDecls.length ? sharedDecls.join('\n') + '\n' : '');
  const registry = bundleInjects
    ? `var __formats=Object.create(null);\nfunction setFormats(map){for(var k in map)__formats[k]=map[k]}\n`
    : '';
  if (format === 'esm') {
    const extra = bundleInjects ? 'export { validators, setFormats };' : 'export { validators };';
    return `// Auto-generated by ata-validator ${ATA_VERSION}, do not edit\n${safeEmbed}${registry}const R=${R};\nconst validators=${arr};\nexport default validators;\n${extra}\n`;
  }
  const attach = bundleInjects ? 'module.exports.setFormats=setFormats;\n' : '';
  return `// Auto-generated by ata-validator ${ATA_VERSION}, do not edit\n'use strict';\n${safeEmbed}${registry}var R=${R};\nmodule.exports=[${fns.join(',')}];\n${attach}`;
}

// Compact bundle: deduplicated code. Shared template functions + per-schema params.
// Much smaller file → faster V8 parse → faster startup.
// opts.format: 'cjs' (default) or 'esm'.
function bundleCompact(Validator, schemas, opts) {
  if (opts && opts.keywords && Object.keys(opts.keywords).length > 0) {
    throw new Error('bundleCompact: custom keywords cannot be compiled into a standalone module (option "keywords")');
  }
  const haveIds = schemas.some((s) => s && typeof s === 'object' && s.$id);
  const bundleOpts = haveIds ? { ...(opts || {}), schemas } : (opts || {});
  const format = (opts && opts.format) || 'cjs';
  let bundleUsesSafeRe = false;
  // Analyze schemas and group by structure
  const entries = schemas.map((schema) => {
    const v = new Validator(schema, bundleOpts);
    v._ensureCompiled();
    const jsFn = v._jsFn;
    if (!jsFn || !jsFn._hybridSource) return null;
    // The schema the validator compiled, not the one the caller passed. They
    // differ whenever anything prepared the schema: draft-07 normalization,
    // `format` removed under assertFormat: false, keywords outside the
    // dialect's vocabularies. Reading the original here would leave the
    // boolean path and the error path disagreeing about the same document.
    const jsErrFn = compileToJSCodegenWithErrors(
      v._schemaObj,
      v._schemaMap,
      v._userFormats,
    );
    if (jsFn._usesSafeRe || (jsErrFn && jsErrFn._usesSafeRe)) bundleUsesSafeRe = true;
    // Hoisted anyOf/oneOf branch helpers (e.g. `_af1_b0`) must travel with the
    // hybrid body or it references undefined names. Prepending keeps dedup honest:
    // schemas with different branch sets no longer collide on body alone.
    return {
      guard: jsFn._preambleGuard || '',
      parts: jsFn._preambleParts || null,
      preamble: jsFn._preambleSource || '',
      closures: closureDeclLines(jsFn, 'var').join('\n'),
      hybridBody: jsFn._hybridSource,
      err: jsErrFn && jsErrFn._errSource ? jsErrFn._errSource : null,
      fmt: jsFn._formatClosures || null,
      shared: [
        ...(jsFn._sharedHelpers || []),
        ...((jsErrFn && jsErrFn._sharedHelpers) || []),
      ],
    };
  });

  // A helper hoisted by several schemas is the same text declaring the same
  // name, so the bundle holds one copy at module scope rather than one per
  // schema. The rest of each preamble stays with its schema: those names are
  // per compilation and would collide.
  const sharedDecls = [];
  {
    const seen = new Set();
    for (const e of entries) {
      if (!e) continue;
      for (const h of e.shared) if (!seen.has(h)) { seen.add(h); sharedDecls.push(h); }
    }
  }
  const sharedSet = new Set(sharedDecls);
  for (const e of entries) {
    if (!e) continue;
    const kept = e.parts ? e.parts.filter((part) => !sharedSet.has(part)) : null;
    const preamble = kept !== null
      ? e.guard + (kept.length ? kept.join('\n  ') + '\n  ' : '')
      : e.preamble;
    // Factory-scope code: guard state, hoisted branch helpers, and the
    // closure declarations (regexes above all), matching where the
    // in-process compiler places them. Keeping them per call recompiled
    // every pattern on every validation.
    e.factory = (preamble ? preamble + '\n' : '') + (e.closures ? e.closures + '\n' : '');
    if (e.err) for (const h of sharedDecls) e.err = e.err.split(h).join('');
  }

  // Deduplicate function bodies — many schemas produce identical or near-identical code
  const bodyMap = new Map(); // body → index
  const bodies = [];
  const errMap = new Map();
  const errBodies = [];

  const indices = entries.map((e) => {
    if (!e) return [-1, -1];
    // The dedupe key must include the factory code: two schemas can emit an
    // identical body that references _re1 with different patterns, and the
    // pattern now lives only in the factory-scope declaration.
    const key = e.factory + '\u0000' + e.hybridBody;
    let hi = bodyMap.get(key);
    if (hi === undefined) {
      hi = bodies.length;
      bodies.push({ factory: e.factory, body: e.hybridBody });
      bodyMap.set(key, hi);
    }
    let ei = -1;
    if (e.err) {
      ei = errMap.get(e.err);
      if (ei === undefined) {
        ei = errBodies.length;
        errBodies.push(e.err);
        errMap.set(e.err, ei);
      }
    }
    return [hi, ei];
  });

  // Generate compact bundle
  const isEsm = format === 'esm';
  let out = isEsm
    ? `// Auto-generated by ata-validator ${ATA_VERSION}, do not edit\n`
    : `// Auto-generated by ata-validator ${ATA_VERSION}, do not edit\n'use strict';\n`;
  if (bundleUsesSafeRe) out += getSafeRegexEmbed() + '\n';
  if (sharedDecls.length) out += sharedDecls.join('\n') + '\n';
  const declKW = isEsm ? 'const' : 'var';
  out += `${declKW} R=Object.freeze({valid:true,errors:Object.freeze([])});\n`;

  // User format functions are referenced as _uf_<name> by the hybrid and error
  // bodies. Collect them across all schemas (deduped by name) and embed via
  // Function#toString so the bundle stays self-contained.
  const fmtSeen = new Set();
  const fmtAll = [];
  for (const e of entries) {
    if (!e || !e.fmt) continue;
    for (const entry of e.fmt) {
      if (fmtSeen.has(entry.name)) continue;
      fmtSeen.add(entry.name);
      fmtAll.push(entry);
    }
  }
  const fmtOut = emitFormatDecls(fmtAll, opts && opts.formatMode, declKW);
  out += fmtOut.decls;

  // Shared hybrid factories
  out += `${declKW} H=[\n`;
  out += bodies
    .map((b) => `function(R,E){${b.factory}return function(d){${b.body}}}`)
    .join(',\n');
  out += '\n];\n';

  // Shared error functions
  out += `${declKW} EF=[\n`;
  out += errBodies.map((b) => `function(d){var _all=true;${b}}`).join(',\n');
  out += '\n];\n';

  // Build validators from shared templates
  const arrBody = indices
    .map(([hi, ei]) => {
      if (hi < 0) return 'null';
      if (ei >= 0) return `H[${hi}](R,EF[${ei}])`;
      return `H[${hi}](R,function(){return{valid:false,errors:[]}})`;
    })
    .join(',');
  if (isEsm) {
    out += `const validators=[${arrBody}];\nexport default validators;\nexport { validators${fmtOut.exportsSetFormats ? ', setFormats' : ''} };\n`;
  } else {
    out += `module.exports=[${arrBody}];\n`;
    if (fmtOut.exportsSetFormats) out += 'module.exports.setFormats=setFormats;\n';
  }

  return out;
}

function loadBundle(Validator, mods, schemas, opts) {
  return schemas.map((schema, i) => {
    if (mods[i]) return Validator.fromStandalone(mods[i], schema, opts);
    return new Validator(schema, opts);
  });
}

// A module written here may end up inline in an HTML page, inside a <script>
// element, and the HTML parser ends that element at the first `</script` it
// sees, whatever JavaScript context it is in. A schema string carrying one, an
// enum value, a pattern, a property name, closed the element early and handed
// the rest of the module to the HTML parser. `<!--` changes how the parser
// reads the element too. Both are written with `\x3C` for the `<`, an escape
// that means the same character in a string, a template and a regular
// expression, with or without the u flag. An escaped `\<`, which the emitters
// do not write but a pattern could carry, has its backslash dropped, since
// `\x3C` already is the escape. A module with neither sequence, which is
// nearly every one, comes back as the same string.
function htmlSafe(src) {
  if (typeof src !== 'string' || src.indexOf('<') === -1) return src;
  return src.replace(/(\\*)<(\/script|!--)/gi, (m, bs, rest) => (bs.length % 2 ? bs.slice(0, -1) : bs) + '\\x3C' + rest);
}
const htmlSafeResult = (fn) => function () { return htmlSafe(fn.apply(this, arguments)); };

module.exports = {
  toStandalone: htmlSafeResult(toStandalone),
  toStandaloneModule: htmlSafeResult(toStandaloneModule),
  bundle: htmlSafeResult(bundle),
  bundleStandalone: htmlSafeResult(bundleStandalone),
  bundleCompact: htmlSafeResult(bundleCompact),
  loadBundle,
};
