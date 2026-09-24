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

const { compileToJSCodegenWithErrors, compileToJSCodegen, unevalContributions } = require('./js-compiler');
const { buildTargetedPositionMap } = require('./data-positions');
const { schemaHash } = require('./schema-hash');
const ATA_VERSION = require('./version');
const SAFE_REGEX_SOURCE = require('./safe-regex-source');

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

// The linear-time regex engine, inlined verbatim into standalone output so a
// compiled module that uses safe `pattern` matchers has no runtime dependency
// on ata-validator. The engine source is baked into `lib/safe-regex-source.js`
// at build time (see `scripts/regen-safe-regex-source.js`), so this path has
// no `fs`/`path`/`__dirname` reads — safe in browser bundles too. The embed
// strips the strict directive and CommonJS exports and adds the `__ataSafeRe`
// alias the emitted code calls. The engine has no eval/new Function, so the
// embed is CSP-safe.
let _safeRegexEmbed = null;
function getSafeRegexEmbed() {
  if (_safeRegexEmbed === null) {
    const body = SAFE_REGEX_SOURCE
      .replace(/^'use strict'\s*\n/, '')
      .replace(/\nmodule\.exports[^\n]*\n?/, '\n');
    _safeRegexEmbed = body.trimEnd() + '\nconst __ataSafeRe = compileSafe;';
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

// Emit an expression that rebuilds `access` from the properties the schema
// declares, dropping everything else. This is the sanitising counterpart to
// removeAdditional: instead of enumerating the input and deleting the keys
// that do not belong, it reads only the keys that do. That is O(schema)
// rather than O(input), it leaves the caller's object untouched, and it keeps
// one hidden class instead of walking the object through a transition per
// delete.
//
// Returns null when the clone cannot be proven exact, and the module then
// simply has no parse(). Declining is recoverable; a sanitiser that quietly
// drops a property the schema allows is not.
// Resolve a local JSON pointer ('#', '#/$defs/x', draft-7 '#/definitions/x',
// any '#/...' path) against the schema root. Returns null for anything else:
// external documents, anchors, URNs. Those stay with the runtime engines.
function resolveLocalPointer(root, ref) {
  if (ref === '#') return root;
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return null;
  let cur = root;
  for (const raw of ref.slice(2).split('/')) {
    let seg = raw.replace(/~1/g, '/').replace(/~0/g, '~');
    if (cur === null || typeof cur !== 'object') return null;
    if (!Object.prototype.hasOwnProperty.call(cur, seg)) {
      try { seg = decodeURIComponent(seg); } catch (_) { return null; }
      if (!Object.prototype.hasOwnProperty.call(cur, seg)) return null;
    }
    cur = cur[seg];
  }
  return cur;
}

// Inline local, acyclic $refs before the clone proof runs, so a generated
// schema ($defs + $ref, the shape every schema generator emits) can still get
// a parse(). Only a node that is exactly a $ref plus annotations is replaced;
// a $ref with a constraining sibling, a cycle, an unresolvable target or an
// external reference is left in place, and emitClone declines it as before.
// The walk never mutates its input and never descends into data positions
// (default, const, enum, examples), where an object holding a "$ref" key is
// a value, not a schema.
const _INLINE_ANNOTATIONS = new Set(['$ref', 'title', 'description', '$comment', 'examples', 'deprecated', 'readOnly', 'writeOnly', 'default']);
const _INLINE_DATA_KEYS = new Set(['default', 'const', 'enum', 'examples']);
function inlineRefsForClone(root) {
  const state = { budget: 512 };
  // `inRef` marks content brought in from behind a reference. The runtime's
  // useDefaults fills a default written next to the $ref, and does not fill
  // defaults written inside the referenced definition, so the inlined copy
  // keeps the first and drops the second. parse() must stay exactly as
  // generous as validate(); a parse that fills more is a disagreement, not a
  // feature.
  const walk = (node, active, inRef) => {
    if (!node || typeof node !== 'object') return node;
    if (Array.isArray(node)) return node.map((n) => walk(n, active, inRef));
    let cur = node;
    let entered = false;
    let siblingDefault;
    while (cur && typeof cur === 'object' && !Array.isArray(cur) && typeof cur.$ref === 'string') {
      for (const k of Object.keys(cur)) if (!_INLINE_ANNOTATIONS.has(k)) return node;
      if (active.has(cur.$ref) || state.budget-- <= 0) return node;
      const target = resolveLocalPointer(root, cur.$ref);
      if (!target || typeof target !== 'object' || Array.isArray(target)) return node;
      if (!entered && !inRef && cur.default !== undefined) siblingDefault = cur.default;
      active = new Set(active);
      active.add(cur.$ref);
      cur = target;
      entered = true;
    }
    const strip = inRef || entered;
    const out = {};
    for (const k of Object.keys(cur)) {
      if (strip && k === 'default') continue;
      const v = cur[k];
      if (_INLINE_DATA_KEYS.has(k) || k === '$defs' || k === 'definitions') { out[k] = v; continue; }
      out[k] = walk(v, active, strip);
    }
    if (siblingDefault !== undefined) out.default = siblingDefault;
    return out;
  };
  return walk(root, new Set(), false);
}

function emitClone(node, access, depth) {
  if (!node || typeof node !== 'object') return null;
  if (depth > 12) return null;
  // Only plain object nodes are cloneable, and only when the schema names
  // every property it keeps. A $ref means the set of allowed keys is not
  // this node's to decide. In-place applicators (allOf, anyOf, oneOf,
  // if/then/else) are admitted under the same proof the unevaluated* error
  // generators use: every property name they contribute must already be
  // declared in this node's own `properties`, so they constrain values but
  // never widen the key set. `not` never widens it. `unevaluatedProperties`
  // is admitted only as `false` under that proof, where it is exactly
  // `additionalProperties: false`.
  if (node.$ref || node.patternProperties || node.additionalProperties === true) {
    return null;
  }
  // additionalProperties as a schema is the record shape (z.record and every
  // generator's map type): the key set is open by declaration, so keeping
  // every key is exact, and every undeclared value is rebuilt against that
  // one schema. That is a proof, not a guess, so it is admitted. What stays
  // out: applicators next to a record (a branch could constrain some keys'
  // values beyond the record schema, and the rebuild would ignore it), and
  // `additionalProperties: true`, where the value is unconstrained and this
  // pass only copies what it can name. An open object with no
  // `additionalProperties` at all also stays out, for the original reason:
  // validate() accepts its unknown keys, so a parse() that strips them would
  // silently drop allowed data, and one that keeps them raw would not be a
  // sanitiser.
  const apSchema = (node.additionalProperties && typeof node.additionalProperties === 'object')
    ? node.additionalProperties
    : null;
  if (apSchema) {
    if (node.unevaluatedProperties !== undefined) return null;
    if (node.allOf || node.anyOf || node.oneOf || node.if || node.then || node.else ||
        node.dependentSchemas !== undefined || node.dependencies !== undefined ||
        node.$dynamicRef !== undefined || node.$recursiveRef !== undefined) return null;
  }
  if (node.unevaluatedProperties !== undefined && node.unevaluatedProperties !== false) return null;
  if (node.type !== 'object') return null;
  if (!node.properties && !apSchema) return null;
  const keys = node.properties ? Object.keys(node.properties) : [];
  if (keys.length === 0 && !apSchema) return null;
  if (node.allOf || node.anyOf || node.oneOf || node.if || node.then || node.else ||
      node.unevaluatedProperties === false) {
    if (node.$dynamicRef !== undefined || node.$recursiveRef !== undefined ||
        node.dependentSchemas !== undefined || node.dependencies !== undefined) return null;
    const names = new Set();
    const state = { prefix: 0 };
    for (const k of ['allOf', 'anyOf', 'oneOf']) {
      if (node[k] !== undefined) {
        if (!Array.isArray(node[k])) return null;
        for (const b of node[k]) if (!unevalContributions(b, 'props', names, state, 0)) return null;
      }
    }
    for (const k of ['if', 'then', 'else']) {
      if (node[k] !== undefined && !unevalContributions(node[k], 'props', names, state, 0)) return null;
    }
    for (const n of names) if (!Object.prototype.hasOwnProperty.call(node.properties, n)) return null;
  }
  const required = new Set(Array.isArray(node.required) ? node.required : []);

  const fixed = [];
  const conditional = [];
  for (const key of keys) {
    const prop = node.properties[key];
    if (!prop || typeof prop !== 'object') return null;
    if (prop.$ref) return null;
    // A property that is required and carries a default is the one place the
    // runtime and a raw-input validation disagree: the runtime fills the
    // default before checking `required`, so `{}` validates there and would
    // throw here. Declining keeps parse() exactly as strict as validate().
    if (required.has(key) && prop.default !== undefined) return null;
    // A default the property's own schema rejects would make parse() hand
    // back a document validate() refuses: the runtime fills defaults before
    // validating, so it catches the bad default, and a raw-input check here
    // never sees it. Probe the default at emit time and decline when it does
    // not hold, or when the subschema cannot be compiled to check it.
    if (prop.default !== undefined) {
      let probe = null;
      try { probe = compileToJSCodegen(prop, null, null); } catch (_) { probe = null; }
      if (!probe || !probe(prop.default)) return null;
    }
    const read = `${access}[${JSON.stringify(key)}]`;
    const value = emitValueExpr(prop, read, depth);
    if (value === null) return null;
    // Computed key syntax: a plain `"__proto__":` in an object literal is
    // the prototype slot, not a property; `["__proto__"]:` is a property.
    if (required.has(key)) fixed.push(`[${JSON.stringify(key)}]: ${value}`);
    else conditional.push({ key, value, dflt: prop.default });
  }
  if (fixed.length === 0 && conditional.length === 0 && !apSchema) return null;

  const tmp = `_c${depth}`;
  // The record loop: every key of the input that is not a declared property
  // is kept, its value rebuilt against the additionalProperties schema. The
  // input is already validated, so every such value satisfies that schema;
  // the rebuild only strips inside it. Defaults under a record value are
  // dropped before emission because the runtime's useDefaults does not fill
  // them there, and parse() must equal validate().data, not improve on it.
  let recordLoop = '';
  if (apSchema) {
    const kVar = `_k${depth}`;
    const vVar = `_v${depth}`;
    const valueExpr = emitValueExpr(stripDefaultsDeep(apSchema), vVar, depth);
    if (valueExpr === null) return null;
    let skip = '';
    let declSet = '';
    if (keys.length > 8) {
      declSet = `const _d${depth} = new Set(${JSON.stringify(keys)}); `;
      skip = `if (_d${depth}.has(${kVar})) continue; `;
    } else if (keys.length > 0) {
      skip = `if (${keys.map((k) => `${kVar} === ${JSON.stringify(k)}`).join(' || ')}) continue; `;
    }
    // The key comes from the input, so it can be the string "__proto__" (an
    // own key only JSON.parse writes); assignment would hit the prototype
    // setter, so that one key goes through defineProperty.
    recordLoop = ` ${declSet}for (const ${kVar} of Object.keys(${access})) { ${skip}const ${vVar} = ${access}[${kVar}]; if (${kVar} === "__proto__") Object.defineProperty(${tmp}, ${kVar}, { value: ${valueExpr}, writable: true, enumerable: true, configurable: true }); else ${tmp}[${kVar}] = ${valueExpr}; }`;
  }

  const literal = `{ ${fixed.join(', ')} }`;
  if (conditional.length === 0 && !recordLoop) return literal;
  // Optional properties are added only when present, so the result never
  // gains a key the input did not have.
  const adds = conditional
    .map(({ key, value, dflt }) => {
      // Object.hasOwn, not `in`: `in` also answers for what the instance
      // inherits, so a property named `constructor` would copy the inherited
      // function into the output that validate().data does not carry. And a
      // key named `__proto__` cannot be written by assignment, which hits
      // the prototype setter; defineProperty writes an own key.
      const assign = key === '__proto__'
        ? `Object.defineProperty(${tmp}, ${JSON.stringify(key)}, { value: ${value}, writable: true, enumerable: true, configurable: true });`
        : `${tmp}[${JSON.stringify(key)}] = ${value};`;
      const set = `if (Object.hasOwn(${access}, ${JSON.stringify(key)})) ${assign}`;
      // The default is emitted as a literal inside the call, so an object or
      // array default is a fresh value on every parse, never shared state.
      if (dflt === undefined) return set;
      const setDflt = key === '__proto__'
        ? `Object.defineProperty(${tmp}, ${JSON.stringify(key)}, { value: ${JSON.stringify(dflt)}, writable: true, enumerable: true, configurable: true });`
        : `${tmp}[${JSON.stringify(key)}] = ${JSON.stringify(dflt)};`;
      return `${set} else ${setDflt}`;
    })
    .join(' ');
  return `(function(){ const ${tmp} = ${literal}; ${adds}${recordLoop} return ${tmp}; })()`;
}

// The value dispatch shared by declared properties and the record loop. A
// value is copyable only when the emitter can name everything that may live
// under it: a primitive holds nothing, an object with declared properties or
// a record schema is rebuilt the same way, an array of primitives has
// nowhere to hide a key. A $ref, a composition or an untyped node could all
// carry keys this code cannot see, and copying the reference would smuggle
// them into a value that claims to be sanitised, so the caller declines the
// whole clone instead.
// Drop every schema-position `default` in a subtree, leaving data positions
// (const, enum, examples) untouched. Used on a record's value schema, where
// the runtime's useDefaults fills nothing.
function stripDefaultsDeep(node) {
  if (!node || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(stripDefaultsDeep);
  const out = {};
  for (const k of Object.keys(node)) {
    if (k === 'default') continue;
    out[k] = _INLINE_DATA_KEYS.has(k) ? node[k] : stripDefaultsDeep(node[k]);
  }
  return out;
}

const _CLONE_PRIMITIVE = new Set(['string', 'number', 'integer', 'boolean', 'null']);
function emitValueExpr(prop, read, depth) {
  if (!prop || typeof prop !== 'object') return null;
  if (prop.$ref) return null;
  const types = Array.isArray(prop.type) ? prop.type : [prop.type];
  if (types.every((t) => _CLONE_PRIMITIVE.has(t))) return read;
  const isRecordable = (s) => s.properties ||
    (s.additionalProperties && typeof s.additionalProperties === 'object');
  if (prop.type === 'object' && isRecordable(prop)) {
    return emitClone(prop, read, depth + 1);
  }
  if (prop.type === 'array' && prop.items && typeof prop.items === 'object' &&
      !Array.isArray(prop.items)) {
    const it = prop.items;
    const itemTypes = Array.isArray(it.type) ? it.type : [it.type];
    if (itemTypes.every((t) => _CLONE_PRIMITIVE.has(t))) return read;
    if (it.type === 'object' && isRecordable(it)) {
      const el = '_e' + depth;
      const inner = emitClone(it, el, depth + 1);
      if (!inner) return null;
      return `${read}.map((${el}) => (${inner}))`;
    }
  }
  return null;
}

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
  if (!abortEarly) {
    jsErrFn = compileToJSCodegenWithErrors(
      typeof validator._schemaObj === 'object' ? validator._schemaObj : {},
      null,
      validator._userFormats,
      (source && sourceMap && schemaFile) ? { sourceMap, schemaFile } : null,
    );
    const errSrc = jsErrFn && jsErrFn._errSource ? jsErrFn._errSource : '';
    if (errSrc) {
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
    ? `const __ATA_SCHEMA_SOURCE__ = ${JSON.stringify({ file: schemaFile })};\n`
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

  const validBody = errCore
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
${safeRePrelude(jsFn, jsErrFn)}${schemaSourceConst}const VALID = Object.freeze({ valid: true, errors: Object.freeze([]) });
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

module.exports = {
  toStandalone,
  toStandaloneModule,
  bundle,
  bundleStandalone,
  bundleCompact,
  loadBundle,
};
