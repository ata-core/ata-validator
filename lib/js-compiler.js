'use strict'

// uniqueItems helpers for the boolean generator, hoisted once per compiled
// function (and carried into standalone output through the preamble).
// _deq is JSON equality: numbers by value, objects by own keys regardless of
// order, arrays positionally. _uq answers whether every item is distinct.
// Structural JSON equality, hoisted once per compiled function. `const` and
// `enum` compare instances by value: two objects with the same members are
// equal whatever order their keys were written in. Comparing serialized
// forms answers a different question and costs a string per call.
const DEQ_HELPER = "function _deq(a,b){if(a===b)return true;if(a===null||b===null||typeof a!=='object'||typeof b!=='object')return false;var aa=Array.isArray(a);if(aa!==Array.isArray(b))return false;var i;if(aa){if(a.length!==b.length)return false;for(i=0;i<a.length;i++)if(!_deq(a[i],b[i]))return false;return true}var ka=Object.keys(a);if(ka.length!==Object.keys(b).length)return false;for(i=0;i<ka.length;i++){var k=ka[i];if(!Object.prototype.hasOwnProperty.call(b,k)||!_deq(a[k],b[k]))return false}return true}"

// uniqueItems helpers, emitted from the functions the interpreted engine
// calls (lib/unique-items.js): `_uq` answers whether every item is distinct.
// Loaded at the first schema with uniqueItems, not on every cold start.
// Comment lines and indentation are dropped: the text lands in every
// generated function and ahead-of-time module that checks uniqueItems.
let _uqSources = null
function uqSources () {
  if (_uqSources === null) {
    const u = require('./unique-items')
    const compact = (fn) => String(fn).replace(/\n\s*\/\/[^\n]*/g, '').replace(/\n\s*/g, '\n')
    _uqSources = { uq: compact(u._uqh) + compact(u._uq), uqp: 'var _uqpI=0;' + compact(u._uqp) }
  }
  return _uqSources
}

// Where a generator hoists a declaration so it runs once per compiled
// function rather than once per call. The boolean generator has a preamble
// for exactly this; the error and combined generators emit `helperCode` into
// their function source. The boolean generator's `helperCode` is only
// scanned for regex entries and must not be used here.
// The helpers the one-pass generator takes from lib/combined-runtime.js as
// closure values instead of writing into each program, by the hoistOnce key
// that would have written them.
const SHARED_RT = {
  _deqHoisted: ['_deq'], _peHoisted: ['_pe'],
  _own_PN: ['_PN', '_OP', '_gp'], _own_hop: ['_hop'], _own_h: ['_h'], _own_ok: ['_ok'], _own_hall: ['_hall'],
}
let _rt = null
function sharedRt () { return _rt || (_rt = require('./combined-runtime')) }
function bindRt (ctx, names) {
  const rt = sharedRt()
  for (const n of names) { ctx.closureVars.push(n); ctx.closureVals.push(rt[n]) }
}
function hoistOnce(ctx, key, code) {
  if (ctx[key]) return
  ctx[key] = true
  if (ctx.sharedRuntime && SHARED_RT[key] !== undefined) { bindRt(ctx, SHARED_RT[key]); return }
  // Recorded as shared: the text is a constant and the name it declares is
  // fixed, so several compiled schemas in one bundle can use one copy. The
  // rest of the preamble cannot move, because emitConstant and the generated
  // branch checks name things per compilation (_kv0, _av3) and two schemas
  // would collide.
  if (ctx.shared) ctx.shared.push(code)
  if (ctx.preamble) ctx.preamble.push(code)
  else if (ctx.helperCode) ctx.helperCode.push(code)
}

// Above this many declared names, asking whether a key is one of them by
// testing it against each name in turn costs a comparison per name per key,
// which is quadratic in the number of properties: a 1000-property schema with
// `additionalProperties: false` spent 75 us where the same schema without the
// keyword took 3, and doubling the properties quadrupled that. Below this many
// the two are the same within noise and the chain allocates nothing, so it
// stays. Cross-process medians, one variant per process, properties of type
// string: 3 to 100 names are a tie; 250 names 8.76 us against 5.49, 500 26.29
// against 12.47, and with no per-property work 2000 names 273 against 49.
const AP_LOOKUP_MIN = 128

// A name set built once per compiled function rather than once per call, as
// source text so the standalone output carries it the same way. A null
// prototype means a key called `toString` is not a member by accident, and a
// plain property read measured faster than `Set#has` at every size tried.
function emitNameLookup (ctx, names) {
  const id = `_apn${ctx.varCounter++}`
  const list = names.map((n) => JSON.stringify(n)).join(',')
  const decl = `const ${id}=Object.create(null);for(const _apx of [${list}])${id}[_apx]=1`
  if (ctx.preamble) ctx.preamble.push(decl)
  else if (ctx.helperCode) ctx.helperCode.push(decl)
  else return null
  return id
}

// "every own key of `v` is one of `names`", as a `return false` check. A
// hoisted lookup above the crossover, the comparison chain below it.
function apMembershipCheck (ctx, names, v) {
  if (names.length >= AP_LOOKUP_MIN) {
    const id = emitNameLookup(ctx, names)
    if (id !== null) {
      // An indexed loop over `Object.keys`, not `for...in`: it allocates the key
      // array but measured faster at every size tried, by about a quarter.
      const i = ctx.varCounter++
      return `var _apk${i}=Object.keys(${v});for(var _api${i}=0;_api${i}<_apk${i}.length;_api${i}++)if(${id}[_apk${i}[_api${i}]]===undefined)return false`
    }
  }
  // With nothing declared every key is additional; `if()` would not parse.
  if (names.length === 0) return `for(var _k in ${v})return false`
  return `for(var _k in ${v})if(${names.map((k) => `_k!==${JSON.stringify(k)}`).join('&&')})return false`
}

function emitDeq(ctx) {
  hoistOnce(ctx, '_deqHoisted', DEQ_HELPER)
  return '_deq'
}

// RFC 6901: a property key reaching an instancePath has to have `~` and `/`
// escaped, or the pointer splits into the wrong segments. Static keys are
// escaped at compile time with ptrSeg; a key only known at run time needs
// this. It mirrors interpreter.js escapePointer, including skipping the two
// regex passes for the keys that need nothing, which is almost all of them.
const PTR_ESC_HELPER = "function _pe(s){for(let i=0;i<s.length;i++){const c=s.charCodeAt(i);if(c===126||c===47)return s.replace(/~/g,'~0').replace(/\\//g,'~1')}return s}"

function emitPtrEsc(ctx) {
  hoistOnce(ctx, '_peHoisted', PTR_ESC_HELPER)
  return '_pe'
}

// `_uq` compares items with `_deq`, so it can never be hoisted alone.
function emitUq(ctx) {
  emitDeq(ctx)
  hoistOnce(ctx, '_uqHoisted', uqSources().uq)
  return '_uq'
}

// The error and combined generators need the duplicate pair, not only the
// verdict. `_uqp` returns the index of the duplicate (-1 when every item is
// distinct) and leaves the item it repeats in `_uqpI`: the first item that has
// a later equal, paired with its first later equal. That is the pair the
// interpreted engine reports, and the generators used to report a different
// one (the earliest repeat, paired with what it repeats), so the same document
// named a different pair depending on the engine that answered. See
// lib/unique-items.js for how it finds the pair.
function emitUqp(ctx) {
  emitUq(ctx)
  hoistOnce(ctx, '_uqpHoisted', uqSources().uqp)
  return '_uqp'
}

// An object or array a const error reports as `allowedValue`, parsed once per
// compiled function rather than on every error: parsing it per error made
// reading a const error two to five times what the check costs. A copy of its
// own, not the compared constant, so an error a caller edits cannot change
// what the validator compares against. Declared in the function's helper
// code, so standalone output carries it the same way.
function emitParamConstant(ctx, value) {
  const name = `_pc${ctx.varCounter++}`
  const decl = `const ${name}=JSON.parse(${JSON.stringify(JSON.stringify(value))})`
  if (ctx.preamble) ctx.preamble.push(decl)
  else ctx.helperCode.push(decl)
  return name
}

// The compared value, parsed once at compile time. `JSON.parse` rather than a
// JS object literal so a `__proto__` member stays an ordinary property.
function emitConstant(ctx, value) {
  if (!ctx._constPool) ctx._constPool = new Map()
  const json = JSON.stringify(value)
  let name = ctx._constPool.get(json)
  if (name === undefined) {
    name = '_kv' + ctx._constPool.size
    ctx._constPool.set(json, name)
    const decl = `const ${name}=JSON.parse(${JSON.stringify(json)})`
    if (ctx.preamble) ctx.preamble.push(decl)
    else if (ctx.helperCode) ctx.helperCode.push(decl)
  }
  return name
}

// One `enum` test: primitives compare with `===`, which needs no call, and
// object members go through structural equality.
function enumCondition(ctx, vals, v) {
  const parts = []
  const prims = vals.filter((x) => x === null || typeof x !== 'object')
  const objs = vals.filter((x) => x !== null && typeof x === 'object')
  if (prims.length) parts.push(prims.map((x) => `${v}===${JSON.stringify(x)}`).join('||'))
  if (objs.length) {
    const deq = emitDeq(ctx)
    parts.push(objs.map((o) => `${deq}(${v},${emitConstant(ctx, o)})`).join('||'))
  }
  return parts.filter(Boolean).join('||') || 'false'
}


const { codeFor } = require('./error-codes')
const { ordinalFor, rankFor } = require('./schema-order')
const { compileSafe, patternIsSafe } = require('./safe-regex')
// Whether a pattern goes to the linear-time engine. A pattern the platform
// RegExp also runs in linear time (nativeIsLinear) takes the RegExp: it answers
// the same, runs faster, and a compiled module that needs no other pattern
// does not carry the engine. Patterns the engine cannot represent keep the
// RegExp, as before.
// Loaded on the first pattern, so a schema without one does not pay for it.
let _nativeIsLinear = null
// The linearity check only parses; it runs first so a pattern bound for the
// RegExp is never compiled for the engine just to be told it could have been.
// Unicode property escapes need a real RegExp in unicode mode, as the
// interpreter compiles them (Interpreter#pattern): the linear engine does not
// know them, and without the flag `\p{L}` reads as the letters p, {, L, }.
// The flag only where the pattern is valid with it, again as the interpreter
// does. These patterns used to send the whole schema to the interpreter.
const PROP_ESCAPE = /\\[pP]\{/
function reFlags (src) {
  if (!PROP_ESCAPE.test(src)) return ''
  try { new RegExp(src, 'u'); return 'u' } catch { return '' }
}
// The flag argument for generated `new RegExp(<json literal>)` source.
function reFlagArg (jsonLit) {
  let raw
  try { raw = JSON.parse(jsonLit) } catch { return '' }
  return typeof raw === 'string' && reFlags(raw) ? ",'u'" : ''
}
const useSafeEngine = (src) => {
  if (PROP_ESCAPE.test(src)) return false
  if (_nativeIsLinear === null) _nativeIsLinear = require('./regex-linear').nativeIsLinear
  if (_nativeIsLinear(src)) return false
  return patternIsSafe(src)
}

// Closure value for a patternProperties/propertyNames regex: the linear-time
// safe matcher when the pattern is in the supported subset (and flag the ctx so
// standalone embeds the engine), else a plain RegExp. Both expose `.test`.
function safeReClosure (ctx, src) {
  if (useSafeEngine(src)) { ctx.usesSafeRe = true; return compileSafe(src) }
  return new RegExp(src, reFlags(src))
}

// Compile a JSON Schema into a pure JS validator function.
// Closure-based validator — no new Function() or eval().
// Returns null if the schema is too complex for JS compilation.

const DOC_BASE = 'https://ata-validator.com/e/'

// Build the literal fragments injected into an emitted _e.push({...}) call.
// Returns { codeStr, docUrl, frame } where `frame` is a JS source fragment
// like ",schemaSource:Object.freeze({...})" or "" if no source map hit.
// The fragment always starts with a leading comma when non-empty so callers
// can splice it inside an existing object literal.
// The error's position in schema declaration order, as a literal field the
// reader sorts by without deriving it from the path. Empty when the path is
// not into the root document.
function ordinalField (ctx, schemaPath) {
  if (ctx && ctx.noOrdinal) return ''
  const o = ctx && ctx.rootSchema ? ordinalFor(ctx.rootSchema, unescapeSp(schemaPath)) : null
  return o === null ? '' : `,_o:${o}`
}

// A schema path as the generators hold it is text for a single-quoted source
// literal: ptrSeg put a backslash before every backslash and quote in a key.
// Anything that uses the path as a value, the ordinal lookup and the frozen
// error objects below, has to take that backslash off again, or a key such as
// `it's` reads as `it\'s` and the error names a path that does not exist.
// The value of a string literal the generators built for source. One that does
// not parse on its own (a key with a raw line break) would not parse inside the
// generated function either, so the generator declines, as it would have when
// that function failed to build.
function literalValue (lit) {
  try {
    return Function('return ' + lit)()
  } catch {
    throw DECLINE
  }
}

function unescapeSp (sp) {
  return sp.indexOf('\\') === -1 ? sp : sp.replace(/\\u([0-9a-fA-F]{4})|\\(.)/g, (m, h, c) => (h !== undefined ? String.fromCharCode(parseInt(h, 16)) : c))
}

const FRAME_INLINE_MAX = 120

function buildErrorLiteral (opts) {
  const { keyword, format, schemaPath, sourceMap } = opts
  let code = (keyword === 'format' && format) ? codeFor('format', format) : codeFor(keyword)
  if (!code) code = 'ATA9001'
  const docUrl = DOC_BASE + code
  let frame = ''
  if (sourceMap && sourceMap.file && sourceMap.map) {
    const ptr = schemaPath && schemaPath.charAt(0) === '#' ? schemaPath.slice(1) : (schemaPath || '')
    let hit = sourceMap.map[ptr + '#key']
    if (!hit) hit = sourceMap.map[ptr]
    if (hit) {
      // Support both {line,col,text} (raw output of buildPositionMap) and
      // [line,col,text] (compact form passed by callers that pre-flattened).
      const line = Array.isArray(hit) ? hit[0] : hit.line
      const col = Array.isArray(hit) ? hit[1] : hit.col
      const text = Array.isArray(hit) ? hit[2] : hit.text
      if (sourceMap.frames && text.length > FRAME_INLINE_MAX) {
        // A long source line is written once at module scope (see
        // sourceFrameDecls in aot-impl.js) and the literal names it. Inlined,
        // every error site carried the whole line, and a schema kept on one
        // line is one line of all of it: 181 KB minified for a 2 KB schema.
        // Short lines stay inline: gzip folds the repeats, and measured on
        // the 50-field fixture the table cost 1206 gzipped bytes where the
        // inline frames cost 696.
        const key = line + ':' + col
        let f = sourceMap.frames.get(key)
        if (!f) { f = { line, col, text, index: sourceMap.frames.size }; sourceMap.frames.set(key, f) }
        frame = ',schemaSource:__ataSS[' + f.index + ']'
      } else {
        frame = ',schemaSource:Object.freeze({file:' + JSON.stringify(sourceMap.file) +
          ',line:' + line +
          ',col:' + col +
          ',text:' + JSON.stringify(text) + '})'
      }
    }
  }
  return { codeStr: code, docUrl, frame }
}

// Count Unicode code points, not UTF-16 code units (surrogate pairs).
// JSON Schema: minLength/maxLength count characters per RFC 8259.
// Fast path: if no surrogate pairs exist, .length is correct (covers >99% of real data).
function _cpLen(s) {
  const len = s.length;
  for (let i = 0; i < len; i++) {
    // Wraparound test: one compare classifies a high surrogate.
    if (((s.charCodeAt(i) - 0xD800) >>> 0) < 0x400) {
      // Found a high surrogate — count code points the slow way
      let n = 0; for (const _ of s) n++; return n;
    }
  }
  return len;
}

// AJV-compatible error message templates (compile-time, not runtime)
const AJV_MESSAGES = {
  type: (p) => `must be ${p.type}`,
  required: (p) => `must have required property '${p.missingProperty}'`,
  additionalProperties: () => 'must NOT have additional properties',
  enum: () => 'must be equal to one of the allowed values',
  const: () => 'must be equal to constant',
  minimum: (p) => `must be >= ${p.limit}`,
  maximum: (p) => `must be <= ${p.limit}`,
  exclusiveMinimum: (p) => `must be > ${p.limit}`,
  exclusiveMaximum: (p) => `must be < ${p.limit}`,
  minLength: (p) => `must NOT have fewer than ${p.limit} characters`,
  maxLength: (p) => `must NOT have more than ${p.limit} characters`,
  pattern: (p) => `must match pattern "${p.pattern}"`,
  format: (p) => `must match format "${p.format}"`,
  minItems: (p) => `must NOT have fewer than ${p.limit} items`,
  maxItems: (p) => `must NOT have more than ${p.limit} items`,
  uniqueItems: (p) => `must NOT have duplicate items (items ## ${p.j} and ${p.i} are identical)`,
  minProperties: (p) => `must NOT have fewer than ${p.limit} properties`,
  maxProperties: (p) => `must NOT have more than ${p.limit} properties`,
  multipleOf: (p) => `must be multiple of ${p.multipleOf}`,
  oneOf: () => 'must match exactly one schema in oneOf',
  anyOf: () => 'must match a schema in anyOf',
  allOf: () => 'must match all schemas in allOf',
  not: () => 'must NOT be valid',
  if: (p) => `must match "${p.failingKeyword}" schema`,
}

function compileToJS(schema, defs, schemaMap) {
  if (typeof schema === 'boolean') {
    return schema ? () => true : () => false
  }
  if (typeof schema !== 'object' || schema === null) return null

  // Bail if schema has edge cases that JS fast path gets wrong
  // Exception: $dynamicRef/$anchor are handled by the interpretive path even though codegen can't
  if (!defs && !codegenSafe(schema, schemaMap)) {
    const str = JSON.stringify(schema)
    const hasDynamic = str.includes('"$dynamicRef"') || str.includes('"$dynamicAnchor"')
    if (!hasDynamic && !str.includes('"$anchor"')) return null
    // The flat anchor map resolves "#name" without regard to $id base-URI
    // scopes. When a plain-anchor schema opens nested $id scopes, same-named
    // anchors can shadow each other, so those schemas must not use codegen.
    if (!hasDynamic && hasNestedIdScope(schema)) return null
  }

  if (!defs && needsBaseTracking(schema, schemaMap, new Set())) return null
  if (!defs && externalDocsNeedInterpreter(schema, schemaMap)) return null
  // A $ref cycle on one value recurses here as it does in generated code; see
  // hasSameInstanceRefCycle.
  if (!defs && hasSameInstanceRefCycle(schema)) return null
  if (!defs && bothDefsContainers(schema)) return null

  // unevaluatedProperties / unevaluatedItems need annotation tracking this
  // path does not do. Decline so the schema reaches an engine that does.
  if (!defs) {
    const str = JSON.stringify(schema)
    if (str.includes('"unevaluatedProperties"') || str.includes('"unevaluatedItems"')) return null
  }

  // Collect $defs early so sub-schemas can resolve $ref
  const rootDefs = defs || collectDefs(schema)

  // Bail on features this path has no emitter for. Tested for presence, not
  // truthiness: `propertyNames: false` is falsy, passed this bail, and then
  // validated nothing, which the entry-point agreement test caught.
  if (schema.patternProperties !== undefined ||
      schema.dependentSchemas !== undefined ||
      schema.propertyDependencies !== undefined ||
      schema.propertyNames !== undefined) {
    return null
  }

  const checks = []

  // $ref (local only)
  if (schema.$ref) {
    const refFn = resolveRef(schema.$ref, rootDefs, schemaMap)
    if (!refFn) return null
    checks.push(refFn)
  }

  // $dynamicRef — resolve via anchor defs or JSON pointer
  if (schema.$dynamicRef) {
    const ref = schema.$dynamicRef
    const anchorName = ref.startsWith('#') ? ref : '#' + ref
    // Resolved at compile time; one that resolves to nothing, or to a
    // definition that cannot compile, declines instead of checking nothing.
    const m = ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/)
    const entry = rootDefs && (rootDefs[anchorName] || (m && rootDefs[m[1]]))
    const fn = entry ? entry.fn : null
    if (!fn) return null
    checks.push(fn)
  }

  // type
  if (schema.type) {
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    checks.push(buildTypeCheck(types))
  }

  // enum
  if (schema.enum) {
    const vals = schema.enum
    const primitives = vals.filter(v => v === null || typeof v !== 'object')
    const objects = vals.filter(v => v !== null && typeof v === 'object')
    const primSet = new Set(primitives.map(v => v === null ? 'null' : typeof v === 'string' ? 's:' + v : 'n:' + v))
    const objStrs = objects.map(v => _canonical(v))
    checks.push((d) => {
      // Fast primitive check
      const key = d === null ? 'null' : typeof d === 'string' ? 's:' + d : typeof d === 'number' || typeof d === 'boolean' ? 'n:' + d : null
      if (key !== null && primSet.has(key)) return true
      // Slow object check, key order independent
      const ds = _canonical(d)
      for (let i = 0; i < objStrs.length; i++) {
        if (ds === objStrs[i]) return true
      }
      // Also check primitives by stringify for edge cases (boolean in enum)
      for (let i = 0; i < primitives.length; i++) {
        if (d === primitives[i]) return true
      }
      return false
    })
  }

  // const
  if (schema.const !== undefined) {
    const cv = schema.const
    if (cv === null || typeof cv !== 'object') {
      checks.push((d) => d === cv)
    } else {
      const cs = _canonical(cv)
      checks.push((d) => _canonical(d) === cs)
    }
  }

  // required applies to objects only; other types are ignored.
  if (schema.required && Array.isArray(schema.required)) {
    for (const key of schema.required) {
      checks.push((d) => typeof d !== 'object' || d === null || Array.isArray(d) || hasOwnKey(d, key))
    }
  }

  // properties
  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      const propCheck = compileToJS(prop, rootDefs)
      if (!propCheck) return null // bail if sub-schema too complex
      checks.push((d) => {
        if (typeof d !== 'object' || d === null || !hasOwnKey(d, key)) return true
        return propCheck(d[key])
      })
    }
  }

  // additionalProperties (with or without a properties map)
  if (schema.additionalProperties !== undefined) {
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties || {}))
      checks.push((d) => {
        if (typeof d !== 'object' || d === null || Array.isArray(d)) return true
        const keys = Object.keys(d)
        for (let i = 0; i < keys.length; i++) {
          if (!allowed.has(keys[i])) return false
        }
        return true
      })
    } else if (typeof schema.additionalProperties === 'object') {
      const apCheck = compileToJS(schema.additionalProperties, rootDefs)
      if (!apCheck) return null
      const known = new Set(Object.keys(schema.properties || {}))
      checks.push((d) => {
        if (typeof d !== 'object' || d === null || Array.isArray(d)) return true
        const keys = Object.keys(d)
        for (let i = 0; i < keys.length; i++) {
          if (!known.has(keys[i]) && !apCheck(d[keys[i]])) return false
        }
        return true
      })
    }
  }

  // dependentRequired
  if (schema.dependentRequired) {
    for (const [key, deps] of Object.entries(schema.dependentRequired)) {
      checks.push((d) => {
        if (typeof d !== 'object' || d === null || !hasOwnKey(d, key)) return true
        for (let i = 0; i < deps.length; i++) {
          if (!hasOwnKey(d, deps[i])) return false
        }
        return true
      })
    }
  }

  // items, applied after the prefixItems positions
  if (schema.items !== undefined && schema.items !== true) {
    const itemCheck = compileToJS(schema.items, rootDefs)
    if (!itemCheck) return null
    const start = Array.isArray(schema.prefixItems) ? schema.prefixItems.length : 0
    checks.push((d) => {
      if (!Array.isArray(d)) return true
      for (let i = start; i < d.length; i++) {
        if (!itemCheck(d[i])) return false
      }
      return true
    })
  }

  // prefixItems
  if (schema.prefixItems) {
    const prefixChecks = []
    for (const ps of schema.prefixItems) {
      const pc = compileToJS(ps, rootDefs)
      if (!pc) return null
      prefixChecks.push(pc)
    }
    checks.push((d) => {
      if (!Array.isArray(d)) return true
      for (let i = 0; i < prefixChecks.length && i < d.length; i++) {
        if (!prefixChecks[i](d[i])) return false
      }
      return true
    })
  }

  // contains
  if (schema.contains !== undefined) {
    const containsCheck = compileToJS(schema.contains, rootDefs)
    if (!containsCheck) return null
    const minC = schema.minContains !== undefined ? schema.minContains : 1
    const maxC = schema.maxContains !== undefined ? schema.maxContains : Infinity
    checks.push((d) => {
      if (!Array.isArray(d)) return true
      let count = 0
      for (let i = 0; i < d.length; i++) {
        if (containsCheck(d[i])) count++
      }
      return count >= minC && count <= maxC
    })
  }

  // uniqueItems — sorted-key canonical form for correct object comparison
  if (schema.uniqueItems) {
    const canonical = (x) => {
      if (x === null || typeof x !== 'object') return typeof x + ':' + x
      if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']'
      return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}'
    }
    checks.push((d) => {
      if (!Array.isArray(d)) return true
      const seen = new Set()
      for (let i = 0; i < d.length; i++) {
        const key = canonical(d[i])
        if (seen.has(key)) return false
        seen.add(key)
      }
      return true
    })
  }

  // numeric. A non-finite number carries no type here, so an empty schema
  // accepts it and these must let it through for the same reason: otherwise
  // `{ minimum: 3 }` turns away a value `{}` admits, and the two engines
  // answer differently for it.
  if (schema.minimum !== undefined) {
    const min = schema.minimum
    checks.push((d) => !Number.isFinite(d) || d >= min)
  }
  if (schema.maximum !== undefined) {
    const max = schema.maximum
    checks.push((d) => !Number.isFinite(d) || d <= max)
  }
  if (schema.exclusiveMinimum !== undefined) {
    const min = schema.exclusiveMinimum
    checks.push((d) => !Number.isFinite(d) || d > min)
  }
  if (schema.exclusiveMaximum !== undefined) {
    const max = schema.exclusiveMaximum
    checks.push((d) => !Number.isFinite(d) || d < max)
  }
  if (schema.multipleOf !== undefined) {
    const div = schema.multipleOf
    checks.push((d) => {
      if (!Number.isFinite(d)) return true
      if (div === 0) return false
      const q = d / div
      return Number.isInteger(q) || Math.abs(q - Math.round(q)) < 1e-9
    })
  }

  // string
  if (schema.minLength !== undefined) {
    const min = schema.minLength
    const min2 = min * 2
    checks.push((d) => typeof d !== 'string' || d.length >= min2 || (d.length >= min && _cpLen(d) >= min))
  }
  if (schema.maxLength !== undefined) {
    const max = schema.maxLength
    checks.push((d) => typeof d !== 'string' || d.length <= max || (d.length <= 2 * max + 1 && _cpLen(d) <= max))
  }
  if (schema.pattern) {
    try {
      const re = useSafeEngine(schema.pattern) ? compileSafe(schema.pattern) : new RegExp(schema.pattern, reFlags(schema.pattern))
      checks.push((d) => typeof d !== 'string' || re.test(d))
    } catch {
      return null
    }
  }

  // format — hand-written fast checks. A format the code generator asserts
  // but this path cannot is a decline, not a pass.
  if (schema.format) {
    const fc = FORMAT_CHECKS[schema.format]
    if (fc) checks.push((d) => typeof d !== 'string' || fc(d))
    else if (FORMAT_CODEGEN[schema.format]) return null
  }

  // array size
  if (schema.minItems !== undefined) {
    const min = schema.minItems
    checks.push((d) => !Array.isArray(d) || d.length >= min)
  }
  if (schema.maxItems !== undefined) {
    const max = schema.maxItems
    checks.push((d) => !Array.isArray(d) || d.length <= max)
  }

  // object size
  if (schema.minProperties !== undefined) {
    const min = schema.minProperties
    checks.push((d) => typeof d !== 'object' || d === null || Array.isArray(d) || Object.keys(d).length >= min)
  }
  if (schema.maxProperties !== undefined) {
    const max = schema.maxProperties
    checks.push((d) => typeof d !== 'object' || d === null || Array.isArray(d) || Object.keys(d).length <= max)
  }

  // allOf
  if (schema.allOf) {
    const subs = []
    for (const s of schema.allOf) {
      const fn = compileToJS(s, rootDefs)
      if (!fn) return null
      subs.push(fn)
    }
    checks.push((d) => {
      for (let i = 0; i < subs.length; i++) {
        if (!subs[i](d)) return false
      }
      return true
    })
  }

  // anyOf
  if (schema.anyOf) {
    const subs = []
    for (const s of schema.anyOf) {
      const fn = compileToJS(s, rootDefs)
      if (!fn) return null
      subs.push(fn)
    }
    checks.push((d) => {
      for (let i = 0; i < subs.length; i++) {
        if (subs[i](d)) return true
      }
      return false
    })
  }

  // oneOf
  if (schema.oneOf) {
    const subs = []
    for (const s of schema.oneOf) {
      const fn = compileToJS(s, rootDefs)
      if (!fn) return null
      subs.push(fn)
    }
    checks.push((d) => {
      let count = 0
      for (let i = 0; i < subs.length; i++) {
        if (subs[i](d)) count++
        if (count > 1) return false
      }
      return count === 1
    })
  }

  // not
  if (schema.not !== undefined) {
    const notFn = compileToJS(schema.not, rootDefs)
    if (!notFn) return null
    checks.push((d) => !notFn(d))
  }

  // if/then/else
  if (schema.if !== undefined) {
    const ifFn = compileToJS(schema.if, rootDefs)
    if (!ifFn) return null
    const thenFn = schema.then !== undefined ? compileToJS(schema.then, rootDefs) : null
    const elseFn = schema.else !== undefined ? compileToJS(schema.else, rootDefs) : null
    if (schema.then !== undefined && !thenFn) return null
    if (schema.else !== undefined && !elseFn) return null
    checks.push((d) => {
      if (ifFn(d)) {
        return thenFn ? thenFn(d) : true
      } else {
        return elseFn ? elseFn(d) : true
      }
    })
  }

  // A definition reached through a cycle and found uncompilable only later.
  if (!defs && rootDefs && rootDefs[DEF_FAILED]) return null
  if (checks.length === 0) return () => true
  if (checks.length === 1) return checks[0]

  // Flatten to a single function — V8 JIT will inline
  return (data) => {
    for (let i = 0; i < checks.length; i++) {
      if (!checks[i](data)) return false
    }
    return true
  }
}

// A definition compiled on first use. A reference into it made while it is
// still compiling (a cycle) gets a function that calls the finished one when
// it runs. One that fails to compile yields null, which the reference turns
// into a decline, and marks the set so the root declines too: a cycle may have
// reached it before the failure was known. It used to return an always-true
// function for both, so a definition this path could not compile, such as one
// containing `$ref: '#'`, accepted every value that reached it.
const DEF_FAILED = Symbol('ata.defFailed')
function lazyDefEntry (def, defs) {
  let state = 0
  let compiled = null
  return {
    get fn () {
      if (state === 0) {
        state = 1
        compiled = compileToJS(def, defs)
        state = 2
        if (!compiled) defs[DEF_FAILED] = true
      }
      if (state === 1) return (d) => (compiled ? compiled(d) : false)
      return compiled
    },
    raw: def,
  }
}

function collectDefs(schema) {
  const defs = {}
  const raw = schema.$defs || schema.definitions
  if (raw && typeof raw === 'object') {
    for (const [name, def] of Object.entries(raw)) {
      defs[name] = lazyDefEntry(def, defs)
      // Register anchors
      if (def && typeof def === 'object') {
        if (def.$anchor) defs['#' + def.$anchor] = lazyDefEntry(def, defs)
        if (def.$dynamicAnchor) defs['#' + def.$dynamicAnchor] = lazyDefEntry(def, defs)
      }
    }
  }
  // Register root-level $anchor/$dynamicAnchor (self-referencing schemas)
  if (schema.$anchor && !defs['#' + schema.$anchor]) defs['#' + schema.$anchor] = lazyDefEntry(schema, defs)
  if (schema.$dynamicAnchor && !defs['#' + schema.$dynamicAnchor]) defs['#' + schema.$dynamicAnchor] = lazyDefEntry(schema, defs)
  return defs
}

// Walk a JSON-pointer fragment ("/foo/bar/0") into a schema object.
// Returns the target node, or null if any segment is missing.
function walkJsonPointer(root, fragment) {
  if (!fragment || fragment === '/' || fragment === '#') return root
  const path = fragment.startsWith('#') ? fragment.slice(1) : fragment
  if (!path.startsWith('/')) return null
  const parts = path.split('/').slice(1).map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'))
  let target = root
  for (const p of parts) {
    if (target == null || typeof target !== 'object') return null
    if (!(p in target)) {
      const alt = p === 'definitions' ? '$defs' : p === '$defs' ? 'definitions' : p === 'items' && Array.isArray(target.prefixItems) ? 'prefixItems' : null
      if (alt !== null && alt in target) { target = target[alt]; continue }
      return null
    }
    target = target[p]
  }
  return target == null ? null : target
}

// Resolve a cross-schema $ref of the form "<id>#/<json-pointer>" (or just "<id>").
// Returns { schema, fullId } where fullId is the resolved $id of the host schema.
function resolveCrossSchemaRef(ref, schemaMap) {
  if (!schemaMap) return null
  const hashIdx = ref.indexOf('#')
  const baseId = hashIdx >= 0 ? ref.slice(0, hashIdx) : ref
  const fragment = hashIdx >= 0 ? ref.slice(hashIdx) : ''
  if (!baseId) return null

  let baseSchema = null
  let fullId = null
  if (schemaMap.has(baseId)) {
    baseSchema = schemaMap.get(baseId)
    fullId = baseId
  } else if (!ref.includes('://')) {
    for (const [id] of schemaMap) {
      if (id.endsWith('/' + baseId)) {
        baseSchema = schemaMap.get(id)
        fullId = id
        break
      }
    }
  }
  if (!baseSchema) return null
  const target = fragment ? walkJsonPointer(baseSchema, fragment) : baseSchema
  if (target == null) return null
  return { schema: target, fullId }
}

function resolveRef(ref, defs, schemaMap) {
  // Self-reference: "#" cannot be expressed as a closure without a recursion
  // guard. Decline rather than substitute a vacuous check.
  if (ref === '#') return null

  // 1. Local ref
  if (defs) {
    const m = ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/)
    if (m) {
      const name = m[1]
      const entry = defs[name]
      if (entry) return entry.fn || null
    }
    // Anchor ref: "#foo"
    if (ref.startsWith('#') && !ref.startsWith('#/')) {
      const entry = defs[ref]
      if (entry) return entry.fn || null
    }
  }
  // A referenced schema that cannot itself be compiled must propagate the bail.
  // Substituting an always-true function here would make the reference vacuous
  // and silently drop every constraint behind it.
  // 2. Cross-schema ref (exact match)
  if (schemaMap && schemaMap.has(ref)) {
    return compileToJS(schemaMap.get(ref), null, schemaMap)
  }
  // 3. Cross-schema ref with JSON pointer fragment ("<id>#/<path>")
  if (schemaMap && ref.includes('#')) {
    const r = resolveCrossSchemaRef(ref, schemaMap)
    if (r) return compileToJS(r.schema, null, schemaMap)
  }
  // 4. Cross-schema ref (relative URI resolution, no fragment)
  if (schemaMap && !ref.includes('://') && !ref.startsWith('#')) {
    for (const [id] of schemaMap) {
      if (id.endsWith('/' + ref)) {
        return compileToJS(schemaMap.get(id), null, schemaMap)
      }
    }
  }
  return null
}

function buildTypeCheck(types) {
  if (types.length === 1) {
    return TYPE_CHECKS[types[0]] || (() => true)
  }
  const fns = types.map(t => TYPE_CHECKS[t]).filter(Boolean)
  return (d) => {
    for (let i = 0; i < fns.length; i++) {
      if (fns[i](d)) return true
    }
    return false
  }
}

// `multipleOf` as the interpreter reads it: divide and ask whether the
// quotient is a whole number. The remainder form this replaces answered -1 %
// 0.1 with -0.09999999999999995, which is neither near zero nor near the
// divisor, so it called -1 not a multiple of 0.1 when -1 / 0.1 is exactly -10.
// Emitted from one place because the expression stood in six.
function multipleOfBad(v, m) {
  if (m === 0) return 'true'
  // Negated rather than written as "the distance is too large": a quotient
  // that overflows to Infinity makes the distance NaN, and every comparison
  // with NaN is false, so the direct form called 1e308 a multiple of
  // 0.123456789. Asking whether it is good and negating keeps that case a
  // rejection, which is what the suite wants and what the closure form does.
  return `!(Number.isInteger(${v}/${m})||Math.abs(${v}/${m}-Math.round(${v}/${m}))<1e-9)`
}

const TYPE_CHECKS = {
  string: (d) => typeof d === 'string',
  number: (d) => Number.isFinite(d),
  integer: (d) => Number.isInteger(d),
  boolean: (d) => typeof d === 'boolean',
  null: (d) => d === null,
  array: (d) => Array.isArray(d),
  object: (d) => typeof d === 'object' && d !== null && !Array.isArray(d),
}

// Key-order independent JSON rendering for const/enum comparison.
function _canonical(x) {
  if (x === null || typeof x !== 'object') return JSON.stringify(x)
  if (Array.isArray(x)) return '[' + x.map(_canonical).join(',') + ']'
  return '{' + Object.keys(x).sort().map((k) => JSON.stringify(k) + ':' + _canonical(x[k])).join(',') + '}'
}

const _formats = { ...require('./formats'), ...require('./formats-source') }
// The closure path's formats. It carried its own idea of an email and knew
// five formats in all, so a schema that reached it was told "valid" for
// anything the other engines turned away; the first call on a fresh validator
// is the one that lands here. Every entry now names the same function the
// other two paths use, and the list is the list they implement.
const FORMAT_CHECKS = {
  email: _formats.email,
  'idn-email': _formats.idnEmail,
  date: _formats.date,
  'date-time': _formats.dateTime,
  time: _formats.time,
  duration: _formats.duration,
  uuid: _formats.uuid,
  uri: _formats.uri,
  'uri-reference': _formats.uriReference,
  'uri-template': _formats.uriTemplate,
  iri: _formats.iri,
  'iri-reference': _formats.iriReference,
  ipv4: _formats.ipv4,
  ipv6: _formats.ipv6,
  hostname: _formats.hostname,
  'json-pointer': _formats.jsonPointer,
  'relative-json-pointer': _formats.relativeJsonPointer,
  regex: (s) => { try { new RegExp(s, 'u'); return true } catch { return false } },
}

// Dangerous JS property names that exist on Object.prototype
// Presence is an own-property question: `required: ['toString']` is not
// satisfied by `{}`. `'k' in v` and `v.k !== undefined` both answer yes for a
// name found on the prototype chain, which accepted documents the interpreted
// engine rejects. Object.hasOwn would be exact but is not inlined, about 5 ns
// a key against well under 1 for `in`, so the check is split:
//   - a name on Object.prototype (and `__proto__`) is always checked with
//     hasOwnProperty; these are rare in schemas and known when compiling;
//   - any other name can only be inherited from a prototype that is not
//     Object.prototype, so an ordinary object answers with `in` and one
//     comparison of its prototype, and anything else, a class instance, a
//     null-prototype object, one from another realm, pays for hasOwnProperty.
// `v.__proto__` is read rather than Object.getPrototypeOf(v) because the engine
// inlines the accessor and not the call (0.8 ns against 8 for eleven keys). An
// object whose own `__proto__` is a data property reads that value, which is
// not Object.prototype, so it takes the exact path.
const PROTO_NAMES = new Set([...Object.getOwnPropertyNames(Object.prototype), '__proto__'])
// Declared once per compiled function and called by name: spelled out at each
// property, the test grew a 50-property module by a tenth. Both are small
// enough for the engine to inline.
//
// The `in` stays at the call site with the key as a constant: inside a shared
// helper the key is a parameter, the engine cannot keep that `in` monomorphic,
// and reading the errors of a product document went from 3.9 to 5.8 us. The
// helper only runs once `in` has said yes, and on an ordinary object it
// answers from the prototype without looking at the key.
//
// `__proto__` is read through the accessor on Object.prototype, which Deno
// removes. There every read came back undefined, every object took the per-key
// hasOwnProperty path, and a ten-field check went from 2.5 to 40 ns. Where the
// accessor is missing the prototype comes from Object.getPrototypeOf instead,
// chosen by a constant the engine folds, so Node pays nothing for the branch.
// Each helper is hoisted only where something emitted uses it, with what it
// depends on. Hoisting all of them as one block put five declarations into
// every module that asked about presence at all, about a sixth of a small
// schema's compiled module.
const OWN_HELPER_CODE = {
  _PN: 'const _PN=({}).__proto__===Object.prototype;const _OP=Object.prototype;const _gp=Object.getPrototypeOf;',
  _hop: 'const _hop=Object.prototype.hasOwnProperty;',
  _h: 'function _h(o,k){return _hop.call(o,k)}',
  _ok: 'function _ok(o,k){return (_PN?o.__proto__:_gp(o))===_OP||_hop.call(o,k)}',
  _hall: 'function _hall(o,ks){for(let i=0;i<ks.length;i++)if(!_hop.call(o,ks[i]))return false;return true}',
}
const OWN_HELPER_DEPS = { _h: ['_hop'], _ok: ['_PN', '_hop'], _hall: ['_hop'] }
function useOwnHelper (ctx, name) {
  for (const dep of OWN_HELPER_DEPS[name] || []) useOwnHelper(ctx, dep)
  hoistOnce(ctx, '_own' + name, OWN_HELPER_CODE[name])
}
//
// Better still, the prototype is read once per object: a node that asks about
// presence declares `_pkN`, whether its value is an ordinary object, before
// anything else, and every key test in that node reads the local. A shared
// helper reading `__proto__` for each key was megamorphic, since it saw every
// object shape in the document, and cost the error path about a microsecond
// on a product document.
// Whether `v`, already known to be an object, has Object.prototype as its
// prototype, read without depending on the __proto__ accessor.
function protoIs (ctx, v) {
  useOwnHelper(ctx, '_PN')
  return `((_PN?${v}.__proto__:_gp(${v}))===_OP)`
}
// The flag withPlain declared for `v`, if any, recorded as used when read so
// withPlain can drop an unused declaration without searching the code for it.
function plainFlag (ctx, v) {
  const pk = ctx.plainOf ? ctx.plainOf.get(v) : undefined
  if (pk !== undefined) (ctx.plainUsed || (ctx.plainUsed = new Set())).add(pk)
  return pk
}
function ownKeyExpr (ctx, v, key) {
  const k = JSON.stringify(key)
  const pk = plainFlag(ctx, v)
  useOwnHelper(ctx, PROTO_NAMES.has(key) || pk !== undefined ? '_h' : '_ok')
  if (PROTO_NAMES.has(key)) return `_h(${v},${k})`
  return pk !== undefined ? `(${pk}?${k} in ${v}:_h(${v},${k}))` : `(${k} in ${v}&&_ok(${v},${k}))`
}
// For a value already read as `v[key]` and found not to be undefined: whether
// it came from `v` itself. `in` is known to hold, so only the second half runs.
function ownGuard (ctx, v, key) {
  const k = JSON.stringify(key)
  const pk = plainFlag(ctx, v)
  useOwnHelper(ctx, PROTO_NAMES.has(key) || pk !== undefined ? '_h' : '_ok')
  if (PROTO_NAMES.has(key)) return `_h(${v},${k})`
  return pk !== undefined ? `(${pk}||_h(${v},${k}))` : `_ok(${v},${k})`
}

// Declares the per-object prototype flag for a node that asks about presence,
// and records it for the key tests emitted while the node is generated. The
// record is restored on the way out, so a nested node over the same value
// expression, an allOf branch say, cannot leave its name behind.
function withPlain (schema, v, lines, ctx, run) {
  if (typeof schema !== 'object' || schema === null ||
      !(schema.required || schema.properties || schema.dependentRequired || schema.dependentSchemas)) {
    return run()
  }
  if (!ctx.plainOf) ctx.plainOf = new Map()
  // A flag an enclosing node already declared for this same value stands:
  // the straight-line unevaluatedProperties code (inlineUnevalBlock) declares
  // one for the object and writes every branch's verdict under it, where each
  // branch used to read the prototype again.
  if (ctx.plainReuse === v && ctx.plainOf.get(v) !== undefined) return run()
  const name = '_pk' + ctx.varCounter++
  const at = lines.length
  const decl = `const ${name}=typeof ${v}==='object'&&${v}!==null&&${protoIs(ctx, v)}`
  lines.push(decl)
  const prev = ctx.plainOf.get(v)
  ctx.plainOf.set(v, name)
  try {
    return run()
  } finally {
    if (prev === undefined) ctx.plainOf.delete(v)
    else ctx.plainOf.set(v, prev)
    // A node whose keys are all typed never reads the flag; declaring it
    // anyway cost a strict-object check about five percent. Unused, it goes.
    // Readers record the flag through plainFlag(); searching the lines this
    // node emitted for its name instead made every ancestor scan its whole
    // subtree again, 2.2 of the 5 seconds a 7.6 MB schema took to compile.
    const used = ctx.plainUsed !== undefined && ctx.plainUsed.has(name)
    if (!used && lines[at] === decl) lines.splice(at, 1)
  }
}
// The same test at run time, for the closure compiler.
const _hop = Object.prototype.hasOwnProperty
const _PN = ({}).__proto__ === Object.prototype
// One hasOwnProperty call. From 1.31.2 to 1.33.0 this first tested the name
// against Object.prototype's names, then `in`, then read the prototype through
// the __proto__ accessor, on every property of every object the eval-free
// engine checked: a schema of 14 properties went from 641 to 828 ns a verdict.
// hasOwnProperty gives the same answer and V8 inlines it.
function hasOwnKey (d, key) {
  return _hop.call(d, key)
}

// Writes an own key. A schema can name a property, a definition or even a
// keyword "__proto__", and assigning that key sets the copy's prototype
// instead: the property was gone from the copy, so a constraint on it was
// generated as nothing and accepted anything (a schema with such a property
// and a reference the resolver rewrites, 1.40.1 to 1.43.0).
function setOwn (o, k, v) {
  if (k === '__proto__') Object.defineProperty(o, k, { value: v, writable: true, enumerable: true, configurable: true })
  else o[k] = v
}

const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'toString', 'valueOf',
  'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable', 'toLocaleString'])

// The nodes the removeAdditional pass deletes from, when deleting them during
// the verdict gives the answer removing them first would, or null when it may
// not. It may not whenever a keyword could look at a key before it is deleted
// and pass where it would fail after: minProperties, a const or enum object
// that holds the extra key, uniqueItems over objects that differ only in one,
// a branch that requires it, a `required` naming a key the node does not
// declare. So the whole schema is held to keywords that only look at declared
// properties or at scalar values. The node set mirrors emitRemovals in
// index.js: reached through `properties` from the root, with
// additionalProperties false and at least one declared property.
const FUSED_REMOVAL_KEYS = new Set(['type', 'properties', 'required', 'additionalProperties', 'items',
  'minItems', 'maxItems', 'minLength', 'maxLength', 'pattern', 'format', 'minimum', 'maximum',
  'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'enum', 'const', 'title', 'description',
  '$comment', '$schema'])
function fusedRemovalNodes (root) {
  const isScalar = (x) => x === null || (typeof x !== 'object' && typeof x !== 'function')
  const safe = (node) => {
    if (typeof node === 'boolean') return true
    if (!node || typeof node !== 'object' || Array.isArray(node)) return false
    for (const k of Object.keys(node)) if (!FUSED_REMOVAL_KEYS.has(k)) return false
    if (node.enum !== undefined && !(Array.isArray(node.enum) && node.enum.every(isScalar))) return false
    if (node.const !== undefined && !isScalar(node.const)) return false
    if (node.properties !== undefined) {
      if (!node.properties || typeof node.properties !== 'object' || Array.isArray(node.properties)) return false
      for (const k of Object.keys(node.properties)) if (!safe(node.properties[k])) return false
    }
    if (node.additionalProperties === false) {
      const declared = node.properties ? Object.keys(node.properties) : []
      if (declared.length === 0) return false
      if (Array.isArray(node.required) && node.required.some((r) => !declared.includes(r))) return false
    } else if (node.additionalProperties !== undefined && node.additionalProperties !== true && !safe(node.additionalProperties)) {
      return false
    }
    if (node.items !== undefined && (Array.isArray(node.items) || !safe(node.items))) return false
    return true
  }
  if (!safe(root)) return null
  const nodes = new Set()
  const walk = (node) => {
    if (!node || typeof node !== 'object' || !node.properties) return
    if (node.additionalProperties === false && Object.keys(node.properties).length > 0) nodes.add(node)
    for (const k of Object.keys(node.properties)) {
      const p = node.properties[k]
      if (p && typeof p === 'object' && p.properties) walk(p)
    }
  }
  walk(root)
  return nodes.size > 0 ? nodes : null
}

// Check if all $dynamicRef in a target schema can be resolved via the calling schema's anchors.
function canResolveDynamicRefs(target, callingSchema, schemaMap) {
  // Collect anchors from calling schema
  const anchors = new Set()
  if (callingSchema.$dynamicAnchor) anchors.add(callingSchema.$dynamicAnchor)
  const defs = callingSchema.$defs || callingSchema.definitions
  if (defs) {
    for (const def of Object.values(defs)) {
      if (def && typeof def === 'object' && def.$dynamicAnchor) anchors.add(def.$dynamicAnchor)
    }
  }
  // Also collect from schemaMap
  if (schemaMap) {
    for (const ext of schemaMap.values()) {
      if (ext && typeof ext === 'object' && ext.$dynamicAnchor) anchors.add(ext.$dynamicAnchor)
    }
  }
  // Find all $dynamicRef in target
  const refs = []
  const findDynRefs = (s) => {
    if (typeof s !== 'object' || s === null) return
    if (s.$dynamicRef) {
      const name = s.$dynamicRef.startsWith('#') ? s.$dynamicRef.slice(1) : s.$dynamicRef
      refs.push(name)
    }
    for (const v of Object.values(s)) {
      if (Array.isArray(v)) v.forEach(findDynRefs)
      else if (typeof v === 'object' && v !== null) findDynRefs(v)
    }
  }
  findDynRefs(target)
  return refs.every(r => anchors.has(r))
}

// Returns true if the node's subtree contains a local $ref pointing to one of
// the given def names (i.e., '#/$defs/Name' or '#/definitions/Name' where Name
// is in defNames). Used to detect whether a $defs body cycles back to a sibling.
function subtreeRefersToLocalDef(node, defNames) {
  if (typeof node !== 'object' || node === null) return false
  if (node.$ref) {
    const m = /^#\/(?:\$defs|definitions)\/([^/]+)$/.exec(node.$ref)
    if (m && defNames.has(m[1])) return true
  }
  for (const val of Object.values(node)) {
    if (typeof val === 'object' && val !== null) {
      if (Array.isArray(val)) {
        for (const item of val) { if (subtreeRefersToLocalDef(item, defNames)) return true }
      } else {
        if (subtreeRefersToLocalDef(val, defNames)) return true
      }
    }
  }
  return false
}

// Returns true if any sub-schema below the root declares a non-fragment $id,
// i.e. opens a new base-URI scope. Fragment-only ids ('#name') are draft-07
// anchors, not scope changes.
function hasNestedIdScope(node, isRoot = true) {
  if (typeof node !== 'object' || node === null) return false
  if (!isRoot && typeof node.$id === 'string' && !node.$id.startsWith('#')) return true
  for (const val of Object.values(node)) {
    if (typeof val !== 'object' || val === null) continue
    if (Array.isArray(val)) {
      for (const item of val) { if (hasNestedIdScope(item, false)) return true }
    } else if (hasNestedIdScope(val, false)) {
      return true
    }
  }
  return false
}

// Recursively check if a schema can be safely compiled to JS codegen.
// Returns false if any sub-schema contains features codegen gets wrong.
// Names of the defs that sit on a $ref cycle among defs. Such a def compiles
// as a named function rather than being inlined, so recursion terminates in
// the generated code the same way `$ref: "#"` does at the root. A plain
// cross-reference (A -> B where B does not refer back) is not on a cycle and
// still inlines.
// Data can point back at itself, and a schema that references itself would
// then recurse until the stack runs out. Validation runs in two passes: the
// fast one counts depth and gives up past CYCLE_DEPTH, the second re-runs with
// a set of the values currently under check, where a value met twice is a
// fixed point and counts as satisfied. That is what the interpreted engine
// does, so both engines answer the same on cyclic input. Legitimate documents
// never reach the threshold, so they only pay the counter.
// Raised by a generator that meets a construct it cannot express. The entry
// point turns it into a decline, so the caller falls back to an engine that
// can. Emitting nothing would mean "everything is valid", which is the failure
// mode this project has shipped three times in $ref handling; declining is the
// only safe way out.
const DECLINE = Symbol('ata.decline')

// How much source the verdict generator may hoist before it hands the schema to
// the interpreted engine. Across the 977 SchemaStore schemas the median emits
// 11 KB and the largest ordinary one, SARIF, 3.4 MB; Kestra's emitted 75 MB and
// took 7.3 seconds and 1.6 GB before its first answer, which the interpreted
// engine gives in about 0.4 seconds.
const CODE_BUDGET = 16 * 1024 * 1024
let codeBudget = CODE_BUDGET
function hoist (ctx, code) {
  ctx.preamble.push(code)
  ctx.preambleChars = (ctx.preambleChars || 0) + code.length
  if (ctx.preambleChars > codeBudget) throw DECLINE
}
// For tests: a budget small enough to reach with a schema that fits in a test.
function _setCodeBudget (n) { codeBudget = n === undefined ? CODE_BUDGET : n }

// The error and combined generators compile the subschemas of not, if, contains
// and their anyOf/oneOf closures with the boolean generator. That generator
// follows a reference back to the root with `_validate` and a reference cycle
// with a named function in its preamble, and neither exists inside the other
// two generators' functions: the first threw a ReferenceError on the first
// document that reached it, and the second cut the cycle, so the reference
// checked nothing. While `nestedBoolean` is set, genCode declines at those
// points instead, and the caller's generator declines the schema.
function nestedGenCode(schema, v, lines, ctx) {
  ctx.nestedBoolean = (ctx.nestedBoolean || 0) + 1
  try {
    genCode(schema, v, lines, ctx)
  } finally {
    ctx.nestedBoolean--
  }
}

const CYCLE_DEPTH = 512

// Declarations the guarded functions close over. Emitted once, ahead of them.
function emitGuardState () {
  return 'const _CYC={};const _stk=new Set();let _sd=0,_sg=false\n  '
}

// Wraps a self-recursive root: `name` is the guarded entry, `name`_b the body.
function emitRootGuard (name, args, onRepeat) {
  const call = `${name}_b(${args})`
  return (
    `function ${name}(${args}){\n  ` +
    `if(_sg){if(typeof d!=='object'||d===null)return ${call};if(_stk.has(d))return ${onRepeat};_stk.add(d);try{return ${call}}finally{_stk.delete(d)}}\n  ` +
    `if(++_sd>${CYCLE_DEPTH})throw _CYC\n  const _r=${call}\n  _sd--\n  return _r\n  }\n  `
  )
}

// Runs `attempt`, and on the depth signal runs it again under the guard.
// `reset` clears anything the abandoned pass left behind.
function emitGuardedRun (attempt, reset, defSets) {
  const clears = ['_stk.clear()'].concat(defSets.map((n) => `${n}_s.clear()`)).join(';')
  return (
    `_sd=0\n  try{${attempt}}catch(_err){\n  ` +
    `if(_err!==_CYC)throw _err\n  ` +
    `${reset}_sg=true;${clears}\n  ` +
    `try{${attempt}}finally{_sg=false}\n  }\n  `
  )
}

// Definitions referenced from more than one place whose body is large enough
// that repeating its error code at every reference costs more than a call.
function sharedDefNames (root, defs) {
  const out = new Set()
  if (!defs || typeof defs !== 'object') return out
  const counts = new Map()
  const seen = new WeakSet()
  const walk = (node) => {
    if (node === null || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)
    if (typeof node.$ref === 'string') {
      const m = /^#\/(?:\$defs|definitions)\/([^/]+)$/.exec(node.$ref)
      if (m) counts.set(m[1], (counts.get(m[1]) || 0) + 1)
    }
    for (const v of Object.values(node)) walk(v)
  }
  walk(root)
  for (const [name, n] of counts) {
    const def = defs[name]
    if (n >= 2 && def && typeof def === 'object' && JSON.stringify(def).length >= SHARED_DEF_MIN_CHARS) out.add(name)
  }
  return out
}
const SHARED_DEF_MIN_CHARS = 120

function cyclicDefNames (defs) {
  const out = new Set()
  if (!defs || typeof defs !== 'object') return out
  const defNames = new Set(Object.keys(defs))
  const defRefs = {}
  for (const [name, def] of Object.entries(defs)) {
    const refs = []
    const seen = new WeakSet()
    const collectRefs = (node) => {
      if (typeof node !== 'object' || node === null) return
      if (seen.has(node)) return
      seen.add(node)
      if (node.$ref) {
        const m = /^#\/(?:\$defs|definitions)\/([^/]+)$/.exec(node.$ref)
        if (m && defNames.has(m[1])) refs.push(m[1])
      }
      for (const val of Object.values(node)) {
        if (typeof val === 'object' && val !== null) {
          if (Array.isArray(val)) { for (const item of val) collectRefs(item) } else collectRefs(val)
        }
      }
    }
    collectRefs(def)
    defRefs[name] = refs
  }
  const visited = new Set()
  const inStack = []
  const dfs = (node) => {
    const at = inStack.indexOf(node)
    if (at !== -1) { for (let i = at; i < inStack.length; i++) out.add(inStack[i]); return }
    if (visited.has(node)) return
    visited.add(node)
    inStack.push(node)
    for (const neighbor of (defRefs[node] || [])) dfs(neighbor)
    inStack.pop()
  }
  for (const name of Object.keys(defRefs)) dfs(name)
  return out
}

// Keys beside a $ref that change nothing about validation: schema organization,
// the annotation vocabulary, and the annotation keys editors read.
const REF_NEUTRAL_SIBLINGS = new Set([
  '$ref', '$defs', 'definitions', '$schema', '$id', '$dynamicAnchor', '$anchor', '$comment',
  'title', 'description', 'default', 'examples', 'deprecated', 'readOnly', 'writeOnly',
  'markdownDescription', 'deprecationMessage', 'markdownDeprecationMessage', 'enumDescriptions',
  'markdownEnumDescriptions', 'defaultSnippets', 'doNotSuggest', 'suggestSortText',
])

// Stands for the schema path of a call to a recursive definition's error
// helper while its body is generated; see genCodeENode. Not a pointer, so no
// ordinal or source frame is looked up for it at compile time.
const SP_PLACEHOLDER = '@@ata-sp@@'

// Follows a definition that is a local $ref to another definition until it
// reaches one that is not. False for a chain that loops, and for one whose
// next hop is not a definition in this document; codegenSafe decides whether
// a non-local reference resolves.
function aliasChainEnds(def, defs) {
  const seen = new Set()
  let node = def
  while (node && typeof node === 'object' && typeof node.$ref === 'string') {
    const m = node.$ref.match(/^#\/(?:\$defs|definitions)\/([^/]+)$/)
    if (!m) return !node.$ref.startsWith('#/')
    const name = m[1].replace(/~1/g, '/').replace(/~0/g, '~')
    if (seen.has(name)) return false
    seen.add(name)
    node = defs[name]
    if (node === undefined) return false
  }
  return true
}

// When the properties a schema evaluates depend on which subschemas pass,
// genUnevaluatedPropertiesNode picks one of a few runtime models: if/then/else,
// one anyOf or oneOf, dependentSchemas, or patterns (root, allOf and a lone
// if). Each model reads only the keywords it was written for. A schema whose
// evaluated set comes from anything else was compiled with that part ignored,
// and a lone `if` with properties emitted no check at all, which accepted every
// object. This says whether the model the emitter will pick covers every
// source of evaluated properties the schema has; when it does not, the
// schema is not generated and the interpreter answers.
function unevalPropsModeled(schema, schemaMap) {
  const own = { ...schema }
  delete own.$defs
  delete own.definitions
  if (/"\$(?:ref|dynamicRef|recursiveRef)"/.test(JSON.stringify(own))) return false
  // A subschema whose evaluated names are a fixed list, which is all the
  // branch, dependentSchemas and if/then/else models can represent.
  const fixed = (s) => {
    if (typeof s === 'boolean') return true
    if (typeof s !== 'object' || s === null) return false
    const r = collectEvaluated(s, schemaMap)
    const j = JSON.stringify(s)
    return !r.dynamic && !r.allProps && !j.includes('"patternProperties"') && !j.includes('"unevaluatedProperties"')
  }
  const allOf = Array.isArray(schema.allOf) ? schema.allOf : []
  for (const sub of allOf) {
    if (typeof sub === 'boolean') continue
    if (typeof sub !== 'object' || sub === null) return false
    const r = collectEvaluated(sub, schemaMap)
    if (r.dynamic || r.allProps) return false
    const rest = { ...sub }
    delete rest.patternProperties
    const j = JSON.stringify(rest)
    if (j.includes('"patternProperties"') || j.includes('"unevaluatedProperties"')) return false
  }
  const patterns = !!schema.patternProperties || allOf.some((s) => s && typeof s === 'object' && s.patternProperties)
  const branch = schema.anyOf || schema.oneOf
  if (schema.anyOf && schema.oneOf) return false
  const hasIf = schema.if !== undefined
  const hasTE = schema.then !== undefined || schema.else !== undefined
  const dep = schema.dependentSchemas
  if (schema.unevaluatedProperties !== false) {
    // The schema-valued model reads the fixed names and one branch keyword.
    if (hasIf || hasTE || dep || patterns) return false
    return !branch || branch.every(fixed)
  }
  if (hasIf && hasTE && !branch && !schema.patternProperties && !dep) {
    if (patterns) return false
    if (!fixed(schema.if) || (schema.then !== undefined && !fixed(schema.then)) || (schema.else !== undefined && !fixed(schema.else))) return false
    // The model credits the if's own `properties` names, and only those.
    const ifNames = typeof schema.if === 'object' ? collectEvaluated(schema.if, schemaMap).props : []
    const declared = typeof schema.if === 'object' && schema.if.properties ? Object.keys(schema.if.properties) : []
    return ifNames.length === declared.length && ifNames.every((k) => declared.includes(k))
  }
  if (branch) return !hasIf && !hasTE && !dep && !patterns && branch.every(fixed)
  if (dep) return !hasIf && !hasTE && !patterns && Object.values(dep).every(fixed)
  if (hasTE) return false
  if (hasIf) {
    // A lone if contributes through its top-level patternProperties only.
    if (typeof schema.if === 'boolean') return true
    if (typeof schema.if !== 'object' || schema.if === null) return false
    const r = collectEvaluated(schema.if, schemaMap)
    if (r.dynamic || r.allProps || r.props.length) return false
    const rest = { ...schema.if }
    delete rest.patternProperties
    const j = JSON.stringify(rest)
    if (j.includes('"patternProperties"') || j.includes('"unevaluatedProperties"')) return false
  }
  return true
}

// Every `$ref` string under a node, once per node.
const _refStrings = new WeakMap()
function refStringsOf(node) {
  let set = _refStrings.get(node)
  if (set !== undefined) return set
  set = new Set()
  const seen = new Set()
  const walk = (n) => {
    if (n === null || typeof n !== 'object' || seen.has(n)) return
    seen.add(n)
    if (Array.isArray(n)) { for (const x of n) walk(x); return }
    if (typeof n.$ref === 'string') set.add(n.$ref)
    for (const k of Object.keys(n)) if (k !== 'enum' && k !== 'const' && k !== 'default' && k !== 'examples') walk(n[k])
  }
  walk(node)
  _refStrings.set(node, set)
  return set
}

function codegenSafe(schema, schemaMap) {
  if (typeof schema === 'boolean') return true
  if (typeof schema !== 'object' || schema === null) return true

  // propertyDependencies is a proposal the interpreted engine implements and
  // neither JS path does. Emitting nothing for it would make the keyword
  // vacuous, so hand the schema over rather than silently ignore a constraint.
  if (schema.propertyDependencies !== undefined) return false

  // Only bail on $dynamicRef if it can't be resolved at compile time
  if (schema.$dynamicRef && !schema.$dynamicRef.startsWith('#')) return false

  // Boolean sub-schemas anywhere cause bail — codegen doesn't handle schema=false correctly
  // items: false and items: true are constants; every generator handles a
  // boolean child at its head, so neither falls through as "nothing".
  // `additionalProperties: true` needs no check of its own, and it says nothing
  // about the rest of the node: returning early here waved the whole subtree
  // through, so a nested construct the generator cannot express was dropped
  // instead of declined, from 1.0.0 to 1.35.0.
  if (schema.properties) {
    for (const v of Object.values(schema.properties)) {
      if (typeof v === 'boolean') continue // constants; every generator handles them at its head
      if (!codegenSafe(v, schemaMap)) return false
    }
  }

  // Keys that collide with Object.prototype


  // Unicode property escapes in pattern need 'u' flag — codegen uses RegExp without it

  // $ref — allow local refs (#/$defs/Name) and non-local refs if in schemaMap
  if (schema.$ref) {
    // Self-reference "#" — treated as permissive (no-op) to avoid infinite recursion
    if (schema.$ref === '#') return true
    const isLocal = /^#\/(?:\$defs|definitions)\/[^/]+$/.test(schema.$ref)
    let isResolvable = !isLocal && schemaMap && schemaMap.has(schema.$ref)
    // Relative URI resolution: check if any schemaMap key ends with "/" + ref
    let resolvedTarget = null
    if (!isLocal && !isResolvable && schemaMap && !schema.$ref.includes('://') && !schema.$ref.startsWith('#')) {
      for (const [id] of schemaMap) {
        if (id.endsWith('/' + schema.$ref)) { isResolvable = true; resolvedTarget = schemaMap.get(id); break }
      }
    }
    // Cross-schema ref with JSON pointer fragment: "<id>#/<path>"
    if (!isLocal && !isResolvable && schemaMap && schema.$ref.includes('#') && !schema.$ref.startsWith('#')) {
      const r = resolveCrossSchemaRef(schema.$ref, schemaMap)
      if (r) { isResolvable = true; resolvedTarget = r.schema }
    }
    // Anchor-style ref: #name (not #/path, not bare #) — resolvable at compile time via anchors map
    const isAnchorRef = !isLocal && !isResolvable && schema.$ref.length > 1 && schema.$ref.startsWith('#') && !schema.$ref.startsWith('#/')
    if (!isLocal && !isResolvable && !isAnchorRef) return false
    // If the resolved target contains $dynamicRef, allow codegen only when:
    // 1. All $dynamicRefs can be resolved via the current schema's anchors
    // 2. The resolved target itself is simple enough for codegen (no additionalProperties: false, etc.)
    if (!resolvedTarget && isResolvable) resolvedTarget = schemaMap.get(schema.$ref)
    if (resolvedTarget && JSON.stringify(resolvedTarget).includes('"$dynamicRef"')) {
      const canResolve = canResolveDynamicRefs(resolvedTarget, schema, schemaMap)
      // Also verify the resolved target doesn't have complex features that codegen can't inline
      const targetSimple = canResolve && resolvedTarget.additionalProperties === undefined &&
        !resolvedTarget.patternProperties && !resolvedTarget.dependentSchemas &&
        !resolvedTarget.propertyNames
      if (!targetSimple && schema.unevaluatedProperties === undefined && schema.unevaluatedItems === undefined) return false
    }
    // In Draft 2020-12, $ref with siblings applies both. The verdict
    // generator compiles the siblings after the reference (genCodeNode), the
    // combined one too (genCodeCNode), and the error generator declines such
    // a node, so a sibling is never dropped. This used to decline the whole
    // schema unless an unevaluated keyword was beside the reference.
  }

  // additionalProperties as schema — supported when no composition (allOf/oneOf/anyOf)
  // is in play, and no patternProperties (unified loop does not emit the
  // per-key sub-schema walk yet). Closure path handles those cases.
  // additionalProperties as a schema: emitted by the per-key walk, or by the
  // unified key loop when patternProperties is present. Composition alongside
  // it is fine, since additionalProperties only looks at this schema's own
  // properties and patternProperties.
  if (typeof schema.additionalProperties === 'object' && schema.additionalProperties !== null) {
    if (!codegenSafe(schema.additionalProperties, schemaMap)) return false
  }

  // propertyNames: false — codegen doesn't handle this
  // propertyNames: false is emitted as a per-key rejection by every generator.

  // unevaluatedProperties: allow boolean and schema values
  if (schema.unevaluatedProperties !== undefined) {
    if (typeof schema.unevaluatedProperties === 'object' && schema.unevaluatedProperties !== null) {
      if (!codegenSafe(schema.unevaluatedProperties, schemaMap)) return false
    }
    // When evaluation is both dynamic (branch-dependent) and some branch
    // unconditionally evaluates all properties, static tracking cannot
    // correctly determine which properties are unevaluated at runtime.
    // For example, a oneOf whose branches include both patternProperties
    // and unevaluatedProperties:true requires annotation-aware evaluation
    // that only the interpreted engine provides.
    if (schema.unevaluatedProperties === false || (typeof schema.unevaluatedProperties === 'object' && schema.unevaluatedProperties !== null)) {
      const evalResult = collectEvaluated(schema, schemaMap)
      // What the static model cannot represent is built at run time
      // (genUnevalDynamicVerdict); shapes that cannot be (dynamic references,
      // reference cycles) decline there.
    }
  }
  // unevaluatedItems: allow boolean and schema values
  if (schema.unevaluatedItems !== undefined) {
    // contains marks matched items as evaluated; the generated evaluated-item
    // tracking never credits contains matches, so any contains in scope of an
    // unevaluatedItems keyword must go to the interpreted engine.
    if (JSON.stringify(schema).includes('"contains"')) return false
    if (typeof schema.unevaluatedItems === 'object' && schema.unevaluatedItems !== null) {
      if (!codegenSafe(schema.unevaluatedItems, schemaMap)) return false
    }
  }

  // Check $defs: targets must be safe, names must be simple, no nested $ref chains
  const defs = schema.$defs || schema.definitions
  if (defs) {
    const defNames = new Set(Object.keys(defs))
    // Defs on a $ref cycle compile as named functions (see genCode); nothing
    // to decline here. cyclicDefNames() is the walk that used to bail.
    for (const [name, def] of Object.entries(defs)) {
      // A name the generators would have to spell inside a path or an
      // identifier. Only a problem when a reference names it: tsconfig.json
      // keeps a comment object under the definition `//`, which nothing
      // references, and declined whole for it. A definition reached through
      // a deeper pointer was renamed by normalizeDeepRefs.
      if (/[~/"']/.test(name) && refStringsOf(schema).has('#/' + (schema.$defs === defs ? '$defs' : 'definitions') + '/' + name.replace(/~/g, '~0').replace(/\//g, '~1'))) return false
      if (typeof def === 'boolean') return false
      if (typeof def === 'object' && def !== null) {
        // A non-fragment $id (e.g. 'sub.json', 'http://...') opens a new base URI
        // scope — bail. A fragment-only $id ('#name') is a draft-07 anchor; the
        // codegen anchor maps register it (see "Build anchors map"), so anchor
        // refs (`$ref: '#name'`) resolve to it on all paths.
        if (def.$id && !def.$id.startsWith('#')) return false
        // A definition that is only a reference to another one is an alias,
        // the shape TypeScript-to-schema generators emit for a named union.
        // The generators resolve it like any other $ref; a chain of aliases
        // that loops back on itself has no schema at its end and declines.
        if (def.$ref && !aliasChainEnds(def, defs)) return false
        if (!codegenSafe(def, schemaMap)) return false
      }
    }
  }

  // The same checks compileToJSCodegen makes on the root, at every depth. They
  // were made on the root only, so a nested patternProperties with a Unicode
  // property escape, or a nested propertyNames the generators cannot express,
  // compiled to code that ignored it.
  if (schema.patternProperties) {
    for (const [pat, sub] of Object.entries(schema.patternProperties)) {
      if (typeof sub === 'object' && sub !== null && !codegenSafe(sub, schemaMap)) return false
    }
  }
  if (schema.dependentSchemas) {
    for (const sub of Object.values(schema.dependentSchemas)) {
      if (typeof sub === 'object' && sub !== null && !codegenSafe(sub, schemaMap)) return false
    }
  }
  if (typeof schema.propertyNames === 'object' && schema.propertyNames !== null &&
      !isSimplePN(schema.propertyNames) && !codegenSafe(schema.propertyNames, schemaMap)) return false

  // Recurse into sub-schemas — bail on boolean schemas in any position
  // A boolean subschema is a constant that every generator emits at its
  // head with the child's own path. The emitters below test for presence,
  // not truthiness, because `false` is falsy and a truthiness test would
  // skip it and validate nothing.
  const subs = [
    schema.items, schema.contains, schema.not,
    schema.if, schema.then, schema.else,
    ...(schema.prefixItems || []),
    ...(schema.allOf || []),
    ...(schema.anyOf || []),
    ...(schema.oneOf || []),
  ]
  if (typeof schema.additionalProperties === 'object') subs.push(schema.additionalProperties)
  for (const s of subs) {
    if (s === undefined || s === null || typeof s === 'boolean') continue
    if (!codegenSafe(s, schemaMap)) return false
  }

  return true
}

// Schema-bearing keywords, so the walk below never mistakes a property named
// "$ref" for an actual reference.
const SUBSCHEMA_MAPS = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']
const SUBSCHEMA_LISTS = ['allOf', 'anyOf', 'oneOf', 'prefixItems']
const SUBSCHEMA_SINGLES = ['items', 'additionalItems', 'contains', 'not', 'if', 'then', 'else',
  'additionalProperties', 'propertyNames', 'unevaluatedItems', 'unevaluatedProperties', 'contentSchema']

// genCode emits nothing for a $ref it cannot resolve, which makes the reference
// silently vacuous — a typo in a $ref would turn validation off rather than
// fail. Codegen bails instead, so the schema routes to the interpreted engine,
// which reports the unresolved reference as an error. Mirrors genCode's own
// resolution rules; anything genCode cannot resolve is treated as unresolvable.
function refResolves(ref, rootDefs, anchors, schemaMap) {
  if (ref === '#') return true
  const local = ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/)
  if (local) return !!(rootDefs && rootDefs[local[1]])
  if (ref.startsWith('#') && !ref.startsWith('#/')) {
    const entry = rootDefs && rootDefs[ref]
    return !!((entry && entry.raw) || (anchors && anchors[ref]))
  }
  if (ref.startsWith('#')) return false
  if (!schemaMap) return false
  if (schemaMap.has(ref)) return true
  if (!ref.includes('://')) {
    for (const [id] of schemaMap) if (id.endsWith('/' + ref)) return true
  }
  if (ref.includes('#')) return !!resolveCrossSchemaRef(ref, schemaMap)
  return false
}

// Resolve a $ref that crosses into another document, mirroring genCode's rules.
function crossDocTarget(ref, schemaMap) {
  if (!schemaMap || ref.startsWith('#')) return null
  if (schemaMap.has(ref)) return schemaMap.get(ref)
  if (!ref.includes('://')) {
    for (const [id, s] of schemaMap) if (id.endsWith('/' + ref)) return s
  }
  if (ref.includes('#')) {
    const r = resolveCrossSchemaRef(ref, schemaMap)
    if (r) return r.schema
  }
  return null
}

// True when a subtree contains a fragment-only reference ("#", "#/$defs/x",
// "#anchor"). Such a reference is relative to the document that holds it.
function subtreeHasLocalRef(node, seen) {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return false
  if (seen.has(node)) return false
  seen.add(node)
  if (typeof node.$ref === 'string' && node.$ref.startsWith('#')) return true
  for (const key of SUBSCHEMA_MAPS) {
    const group = node[key]
    if (group && typeof group === 'object' && !Array.isArray(group)) {
      for (const sub of Object.values(group)) if (subtreeHasLocalRef(sub, seen)) return true
    }
  }
  for (const key of SUBSCHEMA_LISTS) {
    if (Array.isArray(node[key])) {
      for (const sub of node[key]) if (subtreeHasLocalRef(sub, seen)) return true
    }
  }
  for (const key of SUBSCHEMA_SINGLES) {
    if (Array.isArray(node[key])) {
      for (const sub of node[key]) if (subtreeHasLocalRef(sub, seen)) return true
    } else if (subtreeHasLocalRef(node[key], seen)) return true
  }
  return false
}

// Neither JS path tracks the base URI a reference is resolved against: they
// match registry keys by exact string or by path suffix. That is fine for a
// flat registry of absolute ids, but wrong as soon as resolution depends on an
// enclosing scope. These shapes go to the interpreted engine, which resolves
// against a real base.
function needsBaseTracking(schema, schemaMap, seen) {
  if (!schemaMap || schemaMap.size === 0) return false
  // A nested $id opens a new scope that later relative references resolve
  // against.
  if (hasNestedIdScope(schema)) return true
  return refsAreScopeSensitive(schema, schemaMap, seen)
}

function refsAreScopeSensitive(node, schemaMap, seen) {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return false
  if (seen.has(node)) return false
  seen.add(node)

  const ref = node.$ref
  if (typeof ref === 'string' && !ref.startsWith('#')) {
    const key = ref.split('#')[0]
    // A key the registry holds verbatim needs no base to resolve — this is the
    // flat-registry case ($ref: 'shared#'). Anything else that is not absolute
    // only resolves by walking up from an enclosing base.
    if (!schemaMap.has(key) && !ref.includes('://')) return true
    const target = crossDocTarget(ref, schemaMap)
    if (target && typeof target === 'object') {
      // Registered under a key that differs from the $id it declares, so its
      // own references resolve against a different base than its retrieval URI.
      if (typeof target.$id === 'string' && target.$id !== key) return true
      if (subtreeHasLocalRef(target, new Set()) && refsAreScopeSensitive(target, schemaMap, seen)) return true
    }
  }

  for (const key of SUBSCHEMA_MAPS) {
    const group = node[key]
    if (group && typeof group === 'object' && !Array.isArray(group)) {
      for (const sub of Object.values(group)) if (refsAreScopeSensitive(sub, schemaMap, seen)) return true
    }
  }
  for (const key of SUBSCHEMA_LISTS) {
    if (Array.isArray(node[key])) {
      for (const sub of node[key]) if (refsAreScopeSensitive(sub, schemaMap, seen)) return true
    }
  }
  for (const key of SUBSCHEMA_SINGLES) {
    if (Array.isArray(node[key])) {
      for (const sub of node[key]) if (refsAreScopeSensitive(sub, schemaMap, seen)) return true
    } else if (refsAreScopeSensitive(node[key], schemaMap, seen)) return true
  }
  return false
}

function hasUnresolvableRef(node, rootDefs, anchors, schemaMap, seen) {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return false
  if (seen.has(node)) return false
  seen.add(node)

  if (typeof node.$ref === 'string') {
    if (!refResolves(node.$ref, rootDefs, anchors, schemaMap)) return true
    // Following a reference into another document changes the base URI, which
    // codegen does not track: it would resolve the target's own fragment-only
    // references against the entry schema instead. Bail so the interpreted
    // engine, which does track the base, handles it.
    const target = crossDocTarget(node.$ref, schemaMap)
    if (target && subtreeHasLocalRef(target, new Set())) return true
  }

  for (const key of SUBSCHEMA_MAPS) {
    const group = node[key]
    if (group && typeof group === 'object' && !Array.isArray(group)) {
      for (const sub of Object.values(group)) {
        if (hasUnresolvableRef(sub, rootDefs, anchors, schemaMap, seen)) return true
      }
    }
  }
  for (const key of SUBSCHEMA_LISTS) {
    if (Array.isArray(node[key])) {
      for (const sub of node[key]) {
        if (hasUnresolvableRef(sub, rootDefs, anchors, schemaMap, seen)) return true
      }
    }
  }
  for (const key of SUBSCHEMA_SINGLES) {
    if (Array.isArray(node[key])) {
      for (const sub of node[key]) {
        if (hasUnresolvableRef(sub, rootDefs, anchors, schemaMap, seen)) return true
      }
    } else if (hasUnresolvableRef(node[key], rootDefs, anchors, schemaMap, seen)) return true
  }
  return false
}


// --- The one gate every code generation entry point runs first ---
//
// Four entry points build four contexts, and three times a bail present in
// one was missing from another; each time the generator emitted nothing for
// a construct it could not represent and returned the empty program as
// always-valid. The checks that do not depend on an entry point's own anchor
// map live here, so adding a bail is one edit. Entry-point-specific checks
// (hasUnresolvableRef against each path's anchors) still run after this.
// tests/test_codegen_entrypoint_agreement.js holds the four to one verdict.

function collectExternalRefKeys(node, out, seen) {
  if (typeof node !== 'object' || node === null) return
  if (seen.has(node)) return
  seen.add(node)
  if (Array.isArray(node)) { for (const n of node) collectExternalRefKeys(n, out, seen); return }
  for (const key of Object.keys(node)) {
    const v = node[key]
    if ((key === '$ref' || key === '$dynamicRef') && typeof v === 'string' && !v.startsWith('#')) out.add(v.split('#')[0])
    else if (typeof v === 'object' && v !== null && key !== 'enum' && key !== 'const' && key !== 'default' && key !== 'examples') collectExternalRefKeys(v, out, seen)
  }
}

function lookupExternal(key, schemaMap) {
  if (schemaMap.has(key)) return schemaMap.get(key)
  if (!key.includes('://')) {
    for (const [id, doc] of schemaMap) if (id.endsWith('/' + key)) return doc
  }
  return null
}

// Documents reachable from `schema` through cross-document references.
function reachableExternalDocs(schema, schemaMap) {
  const docs = new Set()
  if (!schemaMap || schemaMap.size === 0) return docs
  const queue = [schema]
  const seenDocs = new Set([schema])
  while (queue.length) {
    const doc = queue.shift()
    const keys = new Set()
    collectExternalRefKeys(doc, keys, new Set())
    for (const key of keys) {
      const target = lookupExternal(key, schemaMap)
      if (target && !seenDocs.has(target)) { seenDocs.add(target); docs.add(target); queue.push(target) }
    }
  }
  return docs
}

// Dynamic scope and annotation tracking across documents is interpreter
// work. A referenced document that uses either must decline the whole
// schema, or the generator emits a vacuous check for the reference.
function externalDocsNeedInterpreter(schema, schemaMap) {
  for (const doc of reachableExternalDocs(schema, schemaMap)) {
    const str = JSON.stringify(doc)
    if (str.includes('"$dynamicRef"') || str.includes('"$dynamicAnchor"') ||
        str.includes('"unevaluatedProperties"') || str.includes('"unevaluatedItems"')) return true
    // An embedded $id inside a referenced document opens a resource the
    // generator never registers, so references to it would be vacuous.
    if (typeof doc === 'object' && doc !== null && hasNestedIdScope(doc)) return true
  }
  return false
}

// A local $ref cycle that returns to a schema without moving to another value,
// such as `A: { oneOf: [{ $ref: '#/$defs/A' }, ...] }`, never terminates on its
// own. The interpreter stops it and answers; generated code recursed until the
// stack ran out and threw a RangeError into the caller, on primitives, where
// the cycle guard has no object to recognise. Cycles that pass through
// properties, items or any other keyword that moves to a child value are
// ordinary recursion and are not affected.
const SAME_INSTANCE_LISTS = ['allOf', 'anyOf', 'oneOf']
const SAME_INSTANCE_ONE = ['not', 'if', 'then', 'else']
function localPointerTarget(root, ref) {
  if (typeof ref !== 'string' || ref.charCodeAt(0) !== 35) return null
  if (ref === '#') return root
  if (ref.charCodeAt(1) !== 47) return null
  let t = root
  for (let seg of ref.slice(2).split('/')) {
    if (seg.indexOf('%') >= 0) { try { seg = decodeURIComponent(seg) } catch { return null } }
    seg = seg.replace(/~1/g, '/').replace(/~0/g, '~')
    if (t === null || typeof t !== 'object') return null
    if (!Object.prototype.hasOwnProperty.call(t, seg)) {
      const alias = seg === 'definitions' ? '$defs' : seg === '$defs' ? 'definitions' : null
      if (alias === null || !Object.prototype.hasOwnProperty.call(t, alias)) return null
      seg = alias
    }
    t = t[seg]
  }
  return t !== null && typeof t === 'object' ? t : null
}
function sameInstanceEdges(root, node) {
  const out = []
  for (const k of SAME_INSTANCE_LISTS) if (Array.isArray(node[k])) for (const x of node[k]) if (x && typeof x === 'object') out.push(x)
  for (const k of SAME_INSTANCE_ONE) if (node[k] && typeof node[k] === 'object') out.push(node[k])
  if (node.dependentSchemas && typeof node.dependentSchemas === 'object') for (const x of Object.values(node.dependentSchemas)) if (x && typeof x === 'object') out.push(x)
  if (typeof node.$ref === 'string') { const t = localPointerTarget(root, node.$ref); if (t) out.push(t) }
  return out
}
const _sameInstanceCycleCache = new WeakMap()
function hasSameInstanceRefCycle(root) {
  if (root === null || typeof root !== 'object') return false
  const hit = _sameInstanceCycleCache.get(root)
  if (hit !== undefined) return hit
  let found = false
  if (JSON.stringify(root).includes('"$ref"')) {
    // Only what validation can reach: definitions are entered through the
    // references that name them, so a broken definition nothing uses (a real
    // SchemaStore schema has one that includes itself) does not cost the
    // whole schema its generated code.
    const nodes = []
    const seen = new Set()
    const collect = (n) => {
      if (n === null || typeof n !== 'object' || seen.has(n)) return
      seen.add(n)
      if (Array.isArray(n)) { for (const v of n) collect(v); return }
      nodes.push(n)
      for (const [k, v] of Object.entries(n)) {
        if (k === '$defs' || k === 'definitions' || k === 'enum' || k === 'const' || k === 'default' || k === 'examples') continue
        collect(v)
      }
      if (typeof n.$ref === 'string') collect(localPointerTarget(root, n.$ref))
    }
    collect(root)
    const state = new Map() // 1 on the stack, 2 done
    const visit = (n) => {
      const st = state.get(n)
      if (st === 1) return true
      if (st === 2) return false
      state.set(n, 1)
      for (const m of sameInstanceEdges(root, n)) if (visit(m)) return true
      state.set(n, 2)
      return false
    }
    for (const n of nodes) if (visit(n)) { found = true; break }
  }
  _sameInstanceCycleCache.set(root, found)
  return found
}

// The generators look a definition up by name in one table, `$defs` or else
// `definitions`, whichever container the pointer named. With both at the root,
// `#/definitions/x` read `$defs/x`: a draft 7 schema carrying both, with
// different schemas under one name, rejected what it allowed and accepted
// what it rejected. The interpreter resolves the pointer as written, so a
// schema with both goes there. None of SchemaStore's 980 has both.
function bothDefsContainers(schema) {
  return schema.$defs !== null && typeof schema.$defs === 'object' &&
    schema.definitions !== null && typeof schema.definitions === 'object'
}

// The answer depends on the schema and the map alone, and the three
// generators ask it about the same prepared schema in turn, so the last
// answer is kept: each check walks the whole schema, and the second and third
// asked again what the first had found. One entry, compared by identity,
// because a WeakMap entry per schema cost more than the walk it saved on a
// small schema that only ever gets its verdict generated.
let _gateSchema = null, _gateMap = null, _gateOk = false
function sharedCodegenGate(schema, schemaMap) {
  if (typeof schema !== 'object' || schema === null) return true
  if (schema === _gateSchema && schemaMap === _gateMap) return _gateOk
  const ok = sharedCodegenGateUncached(schema, schemaMap)
  _gateSchema = schema; _gateMap = schemaMap; _gateOk = ok
  return ok
}
function sharedCodegenGateUncached(schema, schemaMap) {
  if (bothDefsContainers(schema)) return false
  if (hasSameInstanceRefCycle(schema)) return false
  if (!codegenSafe(schema, schemaMap)) return false
  if (needsBaseTracking(schema, schemaMap, new Set())) return false
  if (externalDocsNeedInterpreter(schema, schemaMap)) return false
  return true
}

// --- Codegen mode: generates a single Function (NOT CSP-safe) ---
// This matches ajv's approach: one monolithic function, V8 JIT fully inlines it
// `propertyNames` as the generators read it (maxLength, minLength, pattern,
// const, enum): a local $ref, through aliases, becomes what it names, and
// `type: 'string'` and annotations go, on a copy. Anything else is left as
// written and the gate declines. Errors keep the interpreted engine's path.
const PN_SUPPORTED = new Set(['maxLength', 'minLength', 'pattern', 'const', 'enum'])
// Whether the generators can write `propertyNames` as checks on the key in the
// object's own key loop. Any other subschema is applied to each key as a
// value of its own (genPropertyNamesNode and its error and combined
// counterparts), which is what the interpreter does.
function isSimplePN (pn) {
  if (pn === null || typeof pn !== 'object' || Array.isArray(pn)) return false
  for (const k of Object.keys(pn)) if (k !== '$schema' && !PN_SUPPORTED.has(k)) return false
  return true
}
const PN_ANNOTATIONS = new Set(['$schema', '$comment', 'title', 'description', 'examples', 'default', 'deprecated', 'readOnly', 'writeOnly'])
function simplePropertyNames(pn, defs) {
  const seen = new Set()
  while (pn && typeof pn === 'object' && typeof pn.$ref === 'string') {
    if (Object.keys(pn).some((k) => k !== '$ref' && !PN_ANNOTATIONS.has(k) && !k.startsWith('x-'))) return null
    const m = pn.$ref.match(/^#\/(?:\$defs|definitions)\/([^/]+)$/)
    if (!m || !defs) return null
    const name = m[1].replace(/~1/g, '/').replace(/~0/g, '~')
    if (seen.has(name)) return null
    seen.add(name)
    pn = defs[name]
  }
  if (!pn || typeof pn !== 'object' || Array.isArray(pn)) return null
  const out = {}
  for (const [k, val] of Object.entries(pn)) {
    if (PN_ANNOTATIONS.has(k) || k.startsWith('x-')) continue
    if (k === 'type') {
      if (val === 'string' || (Array.isArray(val) && val.includes('string'))) continue
      return null
    }
    if (!PN_SUPPORTED.has(k)) return null
    setOwn(out, k, val)
  }
  return out
}
// The three generators are handed the same schema object for one validator,
// so the rewrite is kept per object and done once. It walks the schema rather
// than serializing it to look for the keyword: on a 7.6 MB schema the
// serialization, three times over, was 3% of the first answer.
const _pnNormalized = new WeakMap()
function normalizePropertyNames(root) {
  if (!root || typeof root !== 'object') return root
  const hit = _pnNormalized.get(root)
  if (hit !== undefined) return hit
  const out = normalizePropertyNamesWalk(root)
  _pnNormalized.set(root, out)
  return out
}
function normalizePropertyNamesWalk(root) {
  const defs = root.$defs || root.definitions || null
  const seen = new Map()
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return node
    if (seen.has(node)) return seen.get(node)
    seen.set(node, node)
    if (Array.isArray(node)) {
      let out = node
      node.forEach((n, i) => { const w = walk(n); if (w !== n) { if (out === node) out = node.slice(); out[i] = w } })
      seen.set(node, out)
      return out
    }
    let out = node
    const set = (k, v) => { if (out === node) out = { ...node }; setOwn(out, k, v) }
    for (const k of SUBSCHEMA_MAPS) {
      const map = node[k]
      if (!map || typeof map !== 'object') continue
      let copy = map
      for (const [name, sub] of Object.entries(map)) {
        const w = walk(sub)
        if (w !== sub) { if (copy === map) copy = { ...map }; setOwn(copy, name, w) }
      }
      if (copy !== map) set(k, copy)
    }
    for (const k of SUBSCHEMA_LISTS) {
      if (!Array.isArray(node[k])) continue
      const w = walk(node[k])
      if (w !== node[k]) set(k, w)
    }
    for (const k of SUBSCHEMA_SINGLES) {
      if (k === 'propertyNames' || node[k] === null || typeof node[k] !== 'object') continue
      const w = walk(node[k])
      if (w !== node[k]) set(k, w)
    }
    if (node.propertyNames && typeof node.propertyNames === 'object') {
      const simple = simplePropertyNames(node.propertyNames, defs)
      if (simple && JSON.stringify(simple) !== JSON.stringify(node.propertyNames)) set('propertyNames', simple)
    }
    seen.set(node, out)
    return out
  }
  return walk(root)
}

// A local `$ref` that is a JSON pointer to anything other than a top-level
// definition (`#/definitions/item/properties/id`, `#/properties/foo`,
// `#/$defs/a/items`) became the generators' own definition reference: the
// pointer is resolved here, at compile time, and its target added as a
// definition under a name of its own, so every path that already handles
// `#/$defs/name` handles it, cycles included. The generators knew only the
// top-level form and declined the rest, which kept 40 of 980 SchemaStore
// schemas, tsconfig.json among them, on the interpreted engine for every
// document. Left alone, as before: a pointer that does not resolve to a
// schema, one that passes through a subschema with its own `$id` (another
// base, whose pointers mean something else), and every `$ref` inside such a
// subschema. Copy on write; errors keep their paths, which name the place of
// the reference, not of its target, and are ordered against the schema as
// the caller wrote it.
const DEF_REF = /^#\/(?:\$defs|definitions)\/[^/]+$/
const _deepRefsNormalized = new WeakMap()
function normalizeDeepRefs(root) {
  if (!root || typeof root !== 'object' || Array.isArray(root)) return root
  const hit = _deepRefsNormalized.get(root)
  if (hit !== undefined) return hit
  const out = normalizeDeepRefsWalk(root)
  _deepRefsNormalized.set(root, out)
  return out
}
function resolveLocalPointer(root, ref) {
  let node = root
  const segs = ref.slice(2).split('/')
  for (let i = 0; i < segs.length; i++) {
    let seg = segs[i].replace(/~1/g, '/').replace(/~0/g, '~')
    // Draft 7 schemas reach the generators with `definitions` renamed to
    // `$defs` (lib/draft7.js) and their references as written, which the
    // top-level form already reads either way; so does this.
    if (i === 0 && (seg === 'definitions' || seg === '$defs') && !Object.prototype.hasOwnProperty.call(node, seg)) seg = seg === 'definitions' ? '$defs' : 'definitions'
    if (node === null || typeof node !== 'object') return undefined
    if (Array.isArray(node)) {
      if (!/^(?:0|[1-9]\d*)$/.test(seg) || +seg >= node.length) return undefined
      node = node[+seg]
    } else {
      if (!Object.prototype.hasOwnProperty.call(node, seg)) return undefined
      node = node[seg]
    }
    if (node !== null && typeof node === 'object' && !Array.isArray(node) && typeof node.$id === 'string') return undefined
  }
  if (typeof node === 'boolean') return node
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return undefined
  return node
}
function normalizeDeepRefsWalk(root) {
  // First pass: the deep pointers used outside any nested `$id`, and their
  // targets.
  const targets = new Map()
  const scan = (node, nested, seen) => {
    if (node === null || typeof node !== 'object') return
    if (seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) { for (const n of node) scan(n, nested, seen); return }
    const inner = nested || (node !== root && typeof node.$id === 'string')
    if (!inner && typeof node.$ref === 'string' && node.$ref.startsWith('#/') && !DEF_REF.test(node.$ref) && !targets.has(node.$ref)) {
      const t = resolveLocalPointer(root, node.$ref)
      if (t !== undefined) targets.set(node.$ref, t)
    }
    for (const k of Object.keys(node)) if (k !== 'enum' && k !== 'const' && k !== 'default' && k !== 'examples') scan(node[k], inner, seen)
  }
  scan(root, false, new Set())
  if (targets.size === 0) return root
  const defsKey = root.$defs && typeof root.$defs === 'object' ? '$defs' : (root.definitions && typeof root.definitions === 'object' ? 'definitions' : '$defs')
  const existing = root[defsKey] && typeof root[defsKey] === 'object' ? root[defsKey] : {}
  const names = new Map()
  let n = 0
  for (const ref of targets.keys()) {
    let name
    do { name = '__ata_ptr_' + n++ } while (Object.prototype.hasOwnProperty.call(existing, name))
    names.set(ref, name)
  }
  // Second pass: the references rewritten, copy on write, sharing one copy
  // per node so a target reached twice stays one object.
  const memo = new Map()
  const walk = (node, nested) => {
    if (node === null || typeof node !== 'object') return node
    const key = nested ? null : node
    if (key !== null && memo.has(key)) return memo.get(key)
    if (Array.isArray(node)) {
      let out = node
      if (key !== null) memo.set(key, out)
      for (let i = 0; i < node.length; i++) {
        const w = walk(node[i], nested)
        if (w !== node[i]) { if (out === node) { out = node.slice(); if (key !== null) memo.set(key, out) } out[i] = w }
      }
      return out
    }
    const inner = nested || (node !== root && typeof node.$id === 'string')
    if (inner) return node
    let out = node
    memo.set(node, out)
    const own = (k, v) => { if (out === node) { out = { ...node }; memo.set(node, out) } setOwn(out, k, v) }
    if (typeof node.$ref === 'string' && names.has(node.$ref)) own('$ref', '#/' + defsKey + '/' + names.get(node.$ref))
    for (const k of Object.keys(node)) {
      if (k === '$ref' || k === 'enum' || k === 'const' || k === 'default' || k === 'examples') continue
      const v = node[k]
      if (v === null || typeof v !== 'object') continue
      const w = walk(v, false)
      if (w !== v) own(k, w)
    }
    return out
  }
  const rewritten = walk(root, false)
  const out = rewritten === root ? { ...root } : rewritten
  const defs = { ...(out[defsKey] && typeof out[defsKey] === 'object' ? out[defsKey] : {}) }
  for (const [ref, name] of names) {
    const t = targets.get(ref)
    defs[name] = typeof t === 'boolean' ? t : walk(t, false)
  }
  out[defsKey] = defs
  return out
}

// Every reference the interpreted engine can resolve becomes a definition
// reference the generators handle: URNs, `$id`-relative and absolute URIs,
// anchors, pointers into a resource with its own `$id`, names with characters
// the generators cannot spell, documents registered through `schemas`. The
// target of each is found by the interpreter's own resolver (indexSchemas and
// resolveRef in lib/interpreter.js), so the two engines cannot resolve a
// reference differently, and is added under a name of its own as with
// normalizeDeepRefs. Once every reference names a definition, nested `$id`s
// no longer change what anything means and are dropped from the copy, which
// is what kept those schemas from compiling. Left to normalizeDeepRefs, as
// before: a schema with dynamic references (their meaning depends on the
// resources at run time), one with an embedded resource in another dialect,
// and one with any reference the resolver cannot resolve.
const _refsNormalized = new WeakMap()
function normalizeRefs(root, schemaMap) {
  if (!root || typeof root !== 'object' || Array.isArray(root)) return root
  let byMap = _refsNormalized.get(root)
  const mapKey = schemaMap || _refsNormalized
  if (byMap !== undefined && byMap.has(mapKey)) return byMap.get(mapKey)
  let out
  try { out = normalizeRefsWalk(root, schemaMap) } catch { out = null }
  if (out === null) out = normalizeDeepRefs(root)
  if (byMap === undefined) { byMap = new Map(); _refsNormalized.set(root, byMap) }
  byMap.set(mapKey, out)
  return out
}
const SKIP_VALUE_KEYS = new Set(['enum', 'const', 'default', 'examples'])
// A schema whose every reference is `#` or a plain `#/$defs/name` (or
// `definitions`), with no `$id` or `$anchor` below the root to move the base
// they resolve against, needs nothing from the resolver: each reference
// already reads as the generators read it. Telling that from the text skips
// loading the interpreted engine and indexing the schema, which was most of
// what preparing a small schema for code generation cost.
const LOCAL_ONLY_REF = /^#(?:\/(?:\$defs|definitions)\/[^/~%]+)?$/
function refsAllPlainLocal (root, text) {
  const ids = text.split('"$id":').length - 1
  if (ids > (typeof root.$id === 'string' ? 1 : 0) || text.includes('"$anchor":')) return false
  const re = /"\$ref":("(?:[^"\\]|\\.)*")/g
  let m
  while ((m = re.exec(text)) !== null) {
    let ref
    try { ref = JSON.parse(m[1]) } catch { return false }
    if (!LOCAL_ONLY_REF.test(ref)) return false
  }
  return true
}

// What the text of a schema prepared for code generation says about its size,
// kept from the stringify normalizeRefsWalk makes anyway: its length when it
// holds no `$ref`, -1 when it does. expandedChars counts at most 8 for each
// character of a schema without references, so a short one is known not to
// reach EXPANDED_SHARE without walking it again at every compile.
const _refFreeLength = new WeakMap()
// `$dynamicRef` resolved at compile time, the way the interpreted engine
// resolves it: the target depends on the dynamic scope, the resources entered
// on the way to the reference, so the schema is unrolled into one copy per
// (node, scope) pair and every reference in a copy becomes a plain local
// reference to the copy its scope selects. Two scopes are the same when every
// dynamic anchor name resolves to the same resource in both, which is what
// the lookup reads; keyed that way, a schema whose anchors all sit at the
// root (the 2020-12 meta-schema) gets one copy per node, not one per path.
// Nested `$id`, `$anchor` and `$dynamicAnchor` are dropped from the copies,
// since nothing refers by them any more. Any reference that does not resolve
// makes the whole rewrite give up (null) and the schema goes to the
// interpreted engine, which reports it where it is reached: an unrolled copy
// must never leave a reference out, because a reference that is not written
// checks nothing. 2020-12 bookending is assumed: the v1 dialect, which drops
// it, is routed to the interpreted engine before code generation is asked.
// Dropped from every copy: identifiers, which nothing refers by any more,
// and definition containers, whose members are reached only through the
// references that name them and are copied where those land. A definition
// nothing uses would otherwise sit in the output and could cost it the
// generated code.
const DYN_DROP = new Set(['$id', '$anchor', '$dynamicAnchor', '$defs', 'definitions'])
const BOOL_TRUE = { bool: true }
const BOOL_FALSE = { bool: false }
function expandDynamicScopes(root, schemaMap) {
  if (root === null || typeof root !== 'object' || Array.isArray(root)) return null
  const { indexSchemas, resolveRef, splitFragment, resolveUri } = require('./interpreter')._refInternals
  let state
  try { state = indexSchemas(root, schemaMap && schemaMap.size ? schemaMap : null) } catch { return null }
  const anchorNames = []
  for (const m of state.dynamicAnchors.values()) for (const name of m.keys()) if (!anchorNames.includes(name)) anchorNames.push(name)
  anchorNames.sort()
  // The scope signature: for each anchor name, the first resource in the
  // chain that declares it.
  const signature = (chain) => {
    let sig = ''
    for (const name of anchorNames) {
      let hit = ''
      for (let i = 0; i < chain.length; i++) { const dyn = state.dynamicAnchors.get(chain[i]); if (dyn && dyn.has(name)) { hit = chain[i]; break } }
      sig += name + '=' + hit + ';'
    }
    return sig
  }
  const resolveDynamic = (ref, base, chain) => {
    let { node, base: refBase } = resolveRef(ref, base, state)
    const [, fragment] = splitFragment(resolveUri(base, ref))
    if (fragment && !fragment.startsWith('/')) {
      const initialDyn = state.dynamicAnchors.get(refBase)
      const bookended = node !== undefined && initialDyn !== undefined && initialDyn.get(fragment) === node
      if (bookended) {
        for (let i = 0; i < chain.length; i++) {
          const dyn = state.dynamicAnchors.get(chain[i])
          if (dyn && dyn.has(fragment)) { node = dyn.get(fragment); refBase = chain[i]; break }
        }
      }
    }
    return { node, base: refBase }
  }
  const copies = new Map() // node (or a boolean sentinel) -> Map(signature -> entry)
  const order = []
  let fail = false
  // The entry for a node in a scope: its copy, made on the first ask, and
  // later its name. A `$ref` slot holds the entry until names are given.
  const entryFor = (node, base, chain) => {
    if (node === true || node === false) {
      const key = node ? BOOL_TRUE : BOOL_FALSE
      let bySig = copies.get(key)
      if (bySig === undefined) { bySig = new Map(); copies.set(key, bySig) }
      let e = bySig.get('')
      if (e === undefined) { e = { copy: node, sig: '', name: null, referenced: false }; bySig.set('', e); order.push(e) }
      return e
    }
    if (node === null || typeof node !== 'object') { fail = true; return { copy: node, sig: '', name: null } }
    if (state.nodeBase.has(node) && state.nodeBase.get(node) !== base) base = state.nodeBase.get(node)
    if (!chain.includes(base)) chain = chain.concat(base)
    const sig = signature(chain)
    let bySig = copies.get(node)
    if (bySig === undefined) { bySig = new Map(); copies.set(node, bySig) }
    const hit = bySig.get(sig)
    if (hit !== undefined) return hit
    const e = { copy: Array.isArray(node) ? [] : {}, sig, name: null, referenced: false }
    bySig.set(sig, e)
    order.push(e)
    if (Array.isArray(node)) { for (const x of node) e.copy.push(copyValue(x, base, chain)); return e }
    const out = e.copy
    // Only a schema node reads `$ref` as a reference and carries an `$id`; in
    // a `properties` map those are property names. The index registers
    // every schema node, so that is the test.
    const isSchema = state.nodeBase.has(node)
    for (const k of Object.keys(node)) {
      if (fail) return e
      const v = node[k]
      if (isSchema && (k === '$ref' || k === '$dynamicRef')) {
        if (typeof v !== 'string') { fail = true; return e }
        const t = k === '$ref' ? resolveRef(v, base, state) : resolveDynamic(v, base, chain)
        if (t.node === undefined || t.node === null || (typeof t.node !== 'object' && typeof t.node !== 'boolean') || Array.isArray(t.node)) { fail = true; return e }
        const target = entryFor(t.node, t.base, chain)
        target.referenced = true
        out.$ref = target
        continue
      }
      if (isSchema && DYN_DROP.has(k) && !(k === '$id' && node === root)) continue
      setOwn(out, k, SKIP_VALUE_KEYS.has(k) ? v : copyValue(v, base, chain))
    }
    return e
  }
  // A value under a keyword: a schema or a list is copied, anything else
  // (a type name, a limit, a required name) is kept as it is.
  const copyValue = (v, base, chain) => (v !== null && typeof v === 'object') || typeof v === 'boolean' ? entryFor(v, base, chain).copy : v
  const rootBase = state.nodeBase.get(root)
  const rootEntry = entryFor(root, rootBase, [rootBase])
  if (fail) return null
  const rootCopy = rootEntry.copy
  const defsKey = root.$defs && typeof root.$defs === 'object' ? '$defs' : (root.definitions && typeof root.definitions === 'object' ? 'definitions' : '$defs')
  const existing = {}
  let n = 0
  // Only a copy something refers to becomes a definition; the rest sit
  // where they were copied.
  for (const e of order) {
    if (e === rootEntry) { e.name = '#'; continue }
    if (!e.referenced) continue
    let name
    do { name = '__ata_dyn_' + n++ } while (Object.prototype.hasOwnProperty.call(existing, name))
    e.name = name
  }
  // Write the names into the `$ref` slots.
  const seen = new Set()
  const fix = (o) => {
    if (o === null || typeof o !== 'object' || seen.has(o)) return
    seen.add(o)
    if (Array.isArray(o)) { for (const x of o) fix(x); return }
    for (const k of Object.keys(o)) {
      const v = o[k]
      if (k === '$ref' && v !== null && typeof v === 'object' && !Array.isArray(v) && typeof v.sig === 'string') {
        o.$ref = v.name === '#' ? '#' : '#/' + defsKey + '/' + v.name
        continue
      }
      if (!SKIP_VALUE_KEYS.has(k)) fix(v)
    }
  }
  fix(rootCopy)
  const defs = {}
  for (const e of order) {
    if (e === rootEntry || !e.referenced) continue
    if (typeof e.copy === 'object') fix(e.copy)
    defs[e.name] = e.copy
  }
  rootCopy[defsKey] = defs
  return rootCopy
}

function normalizeRefsWalk(root, schemaMap) {
  const text = JSON.stringify(root)
  const hasRef = text.includes('"$ref"')
  _refFreeLength.set(root, hasRef ? -1 : text.length)
  if (/"\$(?:recursiveRef|recursiveAnchor)"/.test(text)) return null
  // A schema with dynamic references is unrolled by dynamic scope first; the
  // result holds plain local references only.
  if (/"\$(?:dynamicRef|dynamicAnchor)"/.test(text)) return expandDynamicScopes(root, schemaMap)
  if (!hasRef) return root
  if (refsAllPlainLocal(root, text)) return root
  const { indexSchemas, resolveRef } = require('./interpreter')._refInternals
  const state = indexSchemas(root, schemaMap && schemaMap.size ? schemaMap : null)
  const rootDialect = typeof root.$schema === 'string' ? root.$schema.replace(/#$/, '') : null
  // Resolve every reference reachable from the root, following into targets
  // in other documents.
  const names = new Map() // target node -> synthetic name
  const refTarget = new Map() // reference site node -> target node
  const visited = new Set()
  let fail = false
  let dynamic = false
  const visit = (node) => {
    if (fail || node === null || typeof node !== 'object' || visited.has(node)) return
    visited.add(node)
    if (Array.isArray(node)) { for (const n of node) visit(n); return }
    if (node !== root && typeof node.$schema === 'string' && rootDialect !== null && node.$schema.replace(/#$/, '') !== rootDialect) { fail = true; return }
    // A dynamic reference reached through another document is unrolled by
    // scope the same way one in the root is (expandDynamicScopes, below).
    if (node.$recursiveRef !== undefined || node.$recursiveAnchor !== undefined) { fail = true; return }
    if (node.$dynamicRef !== undefined || node.$dynamicAnchor !== undefined) { dynamic = true; return }
    if (typeof node.$ref === 'string' && state.nodeBase.has(node)) {
      const base = state.nodeBase.get(node)
      const ref = node.$ref
      const local = base === state.rootBase && (ref === '#' || (DEF_REF.test(ref) && !/[~%]/.test(ref)))
      if (!local) {
        const { node: t } = resolveRef(ref, base, state)
        if (t === undefined || (typeof t !== 'boolean' && (t === null || typeof t !== 'object' || Array.isArray(t)))) { fail = true; return }
        refTarget.set(node, t)
        // The root, however it is spelled, is `#`: a copy of it under its own
        // definitions would contain itself.
        if (t === root) { /* named '#' below */ }
        else if (typeof t === 'object' && !names.has(t)) { names.set(t, null); visit(t) }
        if (typeof t === 'boolean' && !names.has(t)) names.set(t, null)
      }
    }
    for (const k of Object.keys(node)) if (!SKIP_VALUE_KEYS.has(k)) visit(node[k])
  }
  visit(root)
  if (fail) return null
  if (dynamic) return expandDynamicScopes(root, schemaMap)
  if (refTarget.size === 0) return root
  const defsKey = root.$defs && typeof root.$defs === 'object' ? '$defs' : (root.definitions && typeof root.definitions === 'object' ? 'definitions' : '$defs')
  const existing = root[defsKey] && typeof root[defsKey] === 'object' ? root[defsKey] : {}
  let n = 0
  for (const t of names.keys()) {
    let name
    do { name = '__ata_ref_' + n++ } while (Object.prototype.hasOwnProperty.call(existing, name))
    names.set(t, name)
  }
  // The copy: references renamed, nested `$id`s dropped.
  const memo = new Map()
  const walk = (node) => {
    if (node === null || typeof node !== 'object') return node
    if (memo.has(node)) return memo.get(node)
    if (Array.isArray(node)) {
      const out = []
      memo.set(node, out)
      for (const x of node) out.push(walk(x))
      return out
    }
    const out = {}
    memo.set(node, out)
    for (const k of Object.keys(node)) {
      if (k === '$id' && node !== root) continue
      if (k === '$ref' && refTarget.has(node)) {
        const t = refTarget.get(node)
        out.$ref = t === root ? '#' : '#/' + defsKey + '/' + names.get(t)
        continue
      }
      setOwn(out, k, SKIP_VALUE_KEYS.has(k) ? node[k] : walk(node[k]))
    }
    return out
  }
  const out = walk(root)
  const defs = { ...(out[defsKey] && typeof out[defsKey] === 'object' ? out[defsKey] : {}) }
  for (const [t, name] of names) defs[name] = typeof t === 'boolean' ? t : walk(t)
  out[defsKey] = defs
  return out
}

// What the three generators compile from: the schema with deep local pointers
// turned into definition references, then propertyNames normalized. The same
// for all three, so they decline and agree on the same schemas.
function prepareForCodegen(schema, schemaMap) {
  return normalizePropertyNames(normalizeRefs(schema, schemaMap))
}

const VERDICT_SPLIT = 64 * 1024
// The schema's size with every local reference followed, each definition
// sized once, annotations left out. A rough measure of the expanded verdict
// source: on SchemaStore that runs about 1.4 times it at the median, and far
// less where allOf merges. Past EXPANDED_SHARE the verdict is generated with
// shared definitions from the start, instead of expanded first and thrown
// away: SARIF comes to 2.1 million, and generating its 2.8 MB of expanded
// source only to discard it was most of a cold first validate() (70 ms of the
// 87 a command line run took to report one error). The bound is set where
// only schemas that split anyway reach it: SARIF 2.1 measures about 706
// thousand, while utcm-monitor (370 thousand) and accelerator (262 thousand)
// stay expanded and keep their speed.
const EXPANDED_SHARE = 400 * 1024
const SIZE_SKIPS = new Set(['$defs', 'definitions', 'description', 'title', 'examples', 'default', '$comment', 'markdownDescription', 'deprecated', 'readOnly', 'writeOnly'])
function expandedChars (root, limit) {
  const defs = (root && (root.$defs || root.definitions)) || {}
  const memo = new Map()
  const size = (n, stack) => {
    if (n === null || typeof n !== 'object') return 8
    let t = 2
    if (Array.isArray(n)) { for (const x of n) { t += size(x, stack) + 1; if (t > limit) return t } return t }
    for (const k of Object.keys(n)) {
      if (SIZE_SKIPS.has(k)) continue
      const v = n[k]
      if (k === '$ref' && typeof v === 'string') {
        const m = /^#\/(?:\$defs|definitions)\/([^/]+)$/.exec(v)
        if (m && defs[m[1]] !== undefined && !stack.has(m[1])) {
          let d = memo.get(m[1])
          if (d === undefined) { stack.add(m[1]); d = size(defs[m[1]], stack); stack.delete(m[1]); memo.set(m[1], d) }
          t += d
          if (t > limit) return t
          continue
        }
      }
      t += k.length + 3 + size(v, stack)
      if (t > limit) return t
    }
    return t
  }
  return size(root, new Set())
}
function sourceSize (lines, ctx) {
  let n = 0
  for (const l of lines) n += l.length
  for (const l of ctx.preamble) n += l.length
  if (ctx.deferredChecks) for (const l of ctx.deferredChecks) n += l.length
  return n
}

function compileToJSCodegen(schema, schemaMap, userFormats, opts) {
  const inputSchema = schema
  schema = prepareForCodegen(schema, schemaMap)
  if (typeof schema === 'boolean') return schema ? () => true : () => false
  if (typeof schema !== 'object' || schema === null) return null
  // removeAdditional: a verdict function that deletes the keys the remover
  // would delete, in the walk the verdict already makes, instead of rejecting
  // them. Only for schemas where that cannot change an answer; see
  // fusedRemovalNodes.
  let removeNodes = null
  if (opts && opts.removeAdditional) {
    removeNodes = fusedRemovalNodes(schema)
    if (removeNodes === null) return null
  }

  if (!sharedCodegenGate(schema, schemaMap)) return null

  // Collect defs for $ref resolution
  const rootDefs = schema.$defs || schema.definitions || null

  // Bail only on truly unsupported features
  // patternProperties: bail only on boolean sub-schemas or unicode property escapes
  if (schema.patternProperties) {
    for (const [pat, sub] of Object.entries(schema.patternProperties)) {
      if (typeof sub === 'object' && sub !== null && !codegenSafe(sub, schemaMap)) return null
    }
  }
  // dependentSchemas: bail on boolean sub-schemas
  if (schema.dependentSchemas) {
    for (const sub of Object.values(schema.dependentSchemas)) {
      if (typeof sub === 'object' && sub !== null && !codegenSafe(sub, schemaMap)) return null
    }
  }
  if (schema.propertyNames && typeof schema.propertyNames === 'object' && !isSimplePN(schema.propertyNames) && !codegenSafe(schema.propertyNames, schemaMap)) return null

  // Build anchors map for $ref/#anchor and $dynamicRef resolution
  const anchors = {}
  // Root schema's own $dynamicAnchor / $anchor
  if (schema.$dynamicAnchor) anchors['#' + schema.$dynamicAnchor] = schema
  if (schema.$anchor) anchors['#' + schema.$anchor] = schema
  // Draft-07 plain-name anchor: declared as `$id: "#name"`.
  if (typeof schema.$id === 'string' && schema.$id.startsWith('#')) anchors[schema.$id] = schema
  // Anchors from $defs
  if (rootDefs) {
    for (const def of Object.values(rootDefs)) {
      if (def && typeof def === 'object') {
        if (def.$dynamicAnchor) anchors['#' + def.$dynamicAnchor] = def
        if (def.$anchor) anchors['#' + def.$anchor] = def
        if (typeof def.$id === 'string' && def.$id.startsWith('#')) anchors[def.$id] = def
      }
    }
  }
  // Anchors from external schemas in schemaMap
  if (schemaMap) {
    for (const ext of schemaMap.values()) {
      if (ext && typeof ext === 'object') {
        if (ext.$dynamicAnchor && !anchors['#' + ext.$dynamicAnchor]) anchors['#' + ext.$dynamicAnchor] = ext
        if (ext.$anchor && !anchors['#' + ext.$anchor]) anchors['#' + ext.$anchor] = ext
        if (typeof ext.$id === 'string' && ext.$id.startsWith('#') && !anchors[ext.$id]) anchors[ext.$id] = ext
      }
    }
  }

  if (hasUnresolvableRef(schema, rootDefs, anchors, schemaMap, new Set())) return null
  if (needsBaseTracking(schema, schemaMap, new Set())) return null

  // Macro keywords expand into a schema of their own, which this generator
  // does not apply; such a schema stays on the interpreted engine.
  if (opts && opts.keywords && usesMacroKeyword(schema, schemaMap, opts.keywords)) return null
  // Every reference is first expanded where it is used, which is the fastest
  // form for the checks. Past VERDICT_SPLIT of source the function is
  // generated again with each definition referenced from several places
  // written once, as a function in the preamble: expanded, SchemaStore's sarif
  // (79 KB of schema) came to 2.8 MB of verdict source, and compiling it was
  // half of the first validate() call.
  let ctx, lines
  const refFree = _refFreeLength.get(inputSchema)
  const shareFirst = refFree !== undefined && refFree >= 0 && refFree * 8 <= EXPANDED_SHARE
    ? false
    : expandedChars(schema, EXPANDED_SHARE) > EXPANDED_SHARE
  for (const share of shareFirst ? [true] : [false, true]) {
    ctx = { varCounter: 0, helpers: [], helperCode: [], preamble: [], shared: [], closureVars: ['_cpLen'], closureVals: [_cpLen], rootDefs, refStack: new Set(), schemaMap: schemaMap || null, anchors, rootSchema: inputSchema, userFormats: userFormats || null, removeNodes,
      keywords: (opts && opts.keywords) || null, kwEmitted: null, shareDefs: share }
    if (ctx.keywords) ctx.kwEmitted = new Set()
    lines = []
    try {
      genCode(schema, 'd', lines, ctx)
    } catch (e) {
      if (e === DECLINE) return null
      throw e
    }
    if (share || sourceSize(lines, ctx) <= VERDICT_SPLIT) break
  }
  // Every schema node that carries a custom keyword must have had its check
  // written. A path that inlined a node without going through genCodeNode
  // would drop the keyword and accept what it should reject, so a node that
  // was not reached declines the whole schema to the interpreted engine
  // instead. Unreferenced definitions decline too: slower, never wrong.
  if (ctx.keywords) {
    for (const node of keywordNodes(schema, schemaMap, ctx.keywords)) {
      if (!ctx.kwEmitted.has(node)) return null
    }
  }

  // Append deferred checks (additionalProperties, unevaluatedProperties) at the end
  if (ctx.deferredChecks) {
    for (const dc of ctx.deferredChecks) lines.push(dc)
  }

  if (lines.length === 0) return () => true

  const checkStr = lines.join('\n  ')

  // Regex and helpers are passed as closure variables (not re-created per call)
  const closureNames = ctx.closureVars
  const closureValues = ctx.closureVals

  // Pre-create regex objects once
  for (const code of ctx.helperCode) {
    const safeMatch = code.match(/^const (_re\d+)=__ataSafeRe\((.+)\)$/)
    if (safeMatch) {
      closureNames.push(safeMatch[1])
      closureValues.push(compileSafe(JSON.parse(safeMatch[2])))
      continue
    }
    const match = code.match(/^const (_re\d+)=new RegExp\((.+?)(?:,'(u)')?\)$/)
    if (match) {
      closureNames.push(match[1])
      closureValues.push(new RegExp(JSON.parse(match[2]), match[3] || ''))
    }
  }

  const defSets = ctx.defFns ? Array.from(ctx.defFns.values()) : []
  const needsGuard = ctx.usesRecursion || defSets.length > 0

  // The hybrid and tail forms are the same checks with different returns. They
  // are built when first asked for, not here: most validators never call
  // validateJSON or get extended, and rewriting and compiling the source twice
  // more on every schema was about a third of what a first call cost.
  let body, hybridThunk, tailThunk, resultThunk
  if (ctx.usesRecursion) {
    // Self-recursive: a named body reached through the cycle guard, so data
    // that points back at itself settles instead of exhausting the stack.
    const decl = emitRootGuard('_validate', 'd', 'true') +
      `function _validate_b(d){\n  ${checkStr}\n  return true\n  }\n  `
    const run = emitGuardedRun('return _validate(d)', '', defSets)
    body = `${decl}function _run(d){\n  ${run}\n  }\n  return _run(d)`
    // Hybrid: keep the boolean answer, wrap only the outer call
    hybridThunk = () => `${decl}function _run(d){\n  ${run}\n  }\n  return _run(d)?R:E(d)`
    resultThunk = () => `${decl}function _run(d){\n  ${run}\n  }\n  return _run(d)?${RESULT_TRUE}:${RESULT_FALSE}`
    tailThunk = () => `${decl}function _run(d){\n  ${run}\n  }\n  return _run(d)&&__ataTail(d)`
  } else if (defSets.length > 0) {
    // No self-reference at the root, but a def on a cycle can still be
    // re-entered with the same value; the guarded functions need their state.
    const run = emitGuardedRun(`return _body(d)`, '', defSets)
    body = `function _body(d){\n  ${checkStr}\n  return true\n  }\n  function _run(d){\n  ${run}\n  }\n  return _run(d)`
    hybridThunk = () => `function _body(d){\n  ${checkStr}\n  return true\n  }\n  function _run(d){\n  ${run}\n  }\n  return _run(d)?R:E(d)`
    resultThunk = () => `function _body(d){\n  ${checkStr}\n  return true\n  }\n  function _run(d){\n  ${run}\n  }\n  return _run(d)?${RESULT_TRUE}:${RESULT_FALSE}`
    tailThunk = () => `function _body(d){\n  ${checkStr}\n  return true\n  }\n  function _run(d){\n  ${run}\n  }\n  return _run(d)&&__ataTail(d)`
  } else {
    body = checkStr + '\n  return true'
    hybridThunk = () => replaceTopLevel(checkStr + '\n  return R')
    resultThunk = () => replaceTopLevel(checkStr + '\n  return true', `return ${RESULT_TRUE}`, `return ${RESULT_FALSE}`)
    // An early accept inside the checks has to reach the tail too, so every
    // top-level `return true` becomes the tail call, by the same rewrite the
    // hybrid above relies on and test_hybrid_agreement holds to the suite.
    tailThunk = () => replaceTopLevel(checkStr + '\n  return true', 'return __ataTail(d)', 'return false')
  }
  let hybridBodyMemo
  const hybridBody = () => (hybridBodyMemo === undefined ? (hybridBodyMemo = hybridThunk()) : hybridBodyMemo)

  const guardStr = needsGuard ? emitGuardState() : ''
  const preambleStr = guardStr +
    (ctx.preamble && ctx.preamble.length ? ctx.preamble.join('\n  ') + '\n  ' : '')

  try {
    let boolFn
    if (closureNames.length > 0) {
      const factory = new Function(...closureNames, `${preambleStr}return function(d){${body}}`)
      boolFn = factory(...closureValues)
    } else if (preambleStr) {
      const factory = new Function(`${preambleStr}return function(d){${body}}`)
      boolFn = factory()
    } else {
      boolFn = new Function('d', body)
    }

    // The hybrid: same body, return R instead of true, return E(d) instead of
    // false. Compiled on first request; null when that compile is refused, and
    // the caller then assembles from the error functions instead.
    let hybridFactory
    boolFn._hybridFactory = (R, E) => {
      if (hybridFactory === undefined) {
        try {
          hybridFactory = new Function(...closureNames, 'R', 'E', `${preambleStr}return function(d){${hybridBody()}}`)
        } catch {
          hybridFactory = null
        }
      }
      return hybridFactory === null ? null : hybridFactory(...closureValues, R, E)
    }

    // validate() itself: the same checks returning the result objects, for a
    // validator past its first calls (see validator-core). One function per
    // schema means the result is built at an allocation site of its own and
    // nothing between the caller and the checks is shared with other schemas.
    // Shared wrappers are what made reading results slow across many schemas:
    // every validator's calls went through the same few call sites. The
    // rejection is the lazy one, built from the arguments.
    let resultFactory
    boolFn._resultFactory = (LR, B, W, EE) => {
      if (resultFactory === undefined) {
        try {
          resultFactory = new Function(...closureNames, '__ataLR', '__ataB', '__ataW', '__ataEE', `${preambleStr}return function(d){${resultThunk()}}`)
        } catch {
          resultFactory = null
        }
      }
      return resultFactory === null ? null : resultFactory(...closureValues, LR, B, W, EE)
    }

    // The same function with one more check where it would return true, for a
    // wrapper that enforces something the schema does not carry (see
    // Validator#_extendVerdict). Calling the check from here rather than from a
    // function around this one is the point: this function is too large for
    // the engine to inline, so a wrapper is a second call on every document,
    // and a rejection never reaches the check at all. Built on first request,
    // since almost no validator is extended. Null when code generation is
    // refused, and the caller composes instead.
    let tailFactory
    boolFn._withTail = (tail) => {
      if (tailFactory === undefined) {
        try {
          tailFactory = new Function(...closureNames, '__ataTail', `${preambleStr}return function(d){${tailThunk()}}`)
        } catch {
          tailFactory = null
        }
      }
      return tailFactory === null ? null : tailFactory(...closureValues, tail)
    }

    // Store source for standalone compilation. Regex declarations are NOT
    // inlined into the body: they are carried by _closures and the emitters
    // declare them once at load scope. Inlining them here put a
    // `const _reN=__ataSafeRe(...)` inside the emitted function, which
    // shadowed the module-scope binding and recompiled the pattern on every
    // call, 25x on a schema with one pattern.
    const emitHelpers = ctx.helperCode.filter((c) => !/^const _re\d+=(?:__ataSafeRe|new RegExp)\(/.test(c))
    const helperStr = emitHelpers.length ? emitHelpers.join('\n  ') + '\n  ' : ''
    boolFn._source = helperStr + body
    boolFn._preambleSource = preambleStr
    boolFn._preambleGuard = guardStr
    boolFn._preambleParts = ctx.preamble ? ctx.preamble.slice() : []
    boolFn._sharedHelpers = ctx.shared ? ctx.shared.slice() : []
    Object.defineProperty(boolFn, '_hybridSource', {
      get: () => helperStr + hybridBody(),
      configurable: true,
      enumerable: false,
    })
    boolFn._usesSafeRe = !!ctx.usesSafeRe
    // Custom-format closure entries that the bundle output needs to recreate.
    // Stored as { name, fn } so consumers can serialize via Function#toString.
    if (ctx.userFormats) {
      const fmtEntries = []
      for (let i = 0; i < closureNames.length; i++) {
        if (closureNames[i].startsWith('_uf_')) {
          // The format's own name, so an emitter can look it up at runtime
          // instead of embedding the function.
          let format = null
          for (const key of Object.keys(ctx.userFormats)) {
            if (ctx.userFormats[key] === closureValues[i]) { format = key; break }
          }
          fmtEntries.push({ name: closureNames[i], fn: closureValues[i], format })
        }
      }
      if (fmtEntries.length) boolFn._formatClosures = fmtEntries
    }
    // Closure variables (regex, sub-validators, sets) referenced in _source that
    // standalone module output must declare. Excludes _cpLen (emitted by _CP_LEN_SOURCE)
    // and _uf_* (emitted via _formatClosures).
    {
      const entries = []
      for (let i = 0; i < closureNames.length; i++) {
        const name = closureNames[i]
        if (name === '_cpLen' || name.startsWith('_uf_')) continue
        entries.push({ name, val: closureValues[i] })
      }
      if (entries.length) boolFn._closures = entries
    }

    return boolFn
  } catch {
    return null
  }
}

// Replace top-level `return false` → `return E(d)` and `return true` → `return R`.
// Tracks function nesting depth to preserve nested function internals.
const RESULT_TRUE = '{valid:true,data:d,errors:__ataEE}'
const RESULT_FALSE = 'new __ataLR(__ataB,d,__ataW)'
// The end of the string literal that starts at `i` (a quote character), or
// the end of the code when it does not close.
function skipString(code, i) {
  const q = code[i]
  let j = i + 1
  while (j < code.length) {
    const c = code[j]
    if (c === '\\') { j += 2; continue }
    if (c === q) return j + 1
    j++
  }
  return code.length
}

function replaceTopLevel(code, onTrue = 'return R', onFalse = 'return E(d)') {
  let fnDepth = 0, result = '', i = 0
  while (i < code.length) {
    // String literals are copied as they are. A property called `function`
    // reads `d["function"]`, and the scan took the word for a nested function
    // and left every return after it alone, so the hybrid returned a bare
    // `false` where a result was due: validateJSON answered `false` instead
    // of a rejection for such schemas. Text such as `return false` or a brace
    // inside a string is not code either.
    const ch = code[i]
    if (ch === '"' || ch === "'" || ch === '`') {
      const j = skipString(code, i)
      result += code.slice(i, j)
      i = j
      continue
    }
    // A nested closure keeps its own returns. Both spellings count: a
    // `function` keyword and an arrow with a block body. The inline pattern
    // compiler emits `(()=>{...return false...return true})()` and rewriting
    // those returns turned the arrow's boolean into an object, which made
    // `!(cond && obj)` false and let the hybrid accept what the boolean
    // program rejected.
    const isFunctionKw = code.startsWith('function', i) && (i === 0 || /[^a-zA-Z_$]/.test(code[i - 1])) && !/[a-zA-Z0-9_$]/.test(code[i + 8] || '')
    const isArrowBlock = code.startsWith('=>{', i)
    if (isFunctionKw || isArrowBlock) {
      // Skip to the opening brace, then track all braces inside the body,
      // strings skipped as above.
      let j = isArrowBlock ? i + 2 : i + 8
      while (j < code.length && code[j] !== '{') j++
      result += code.slice(i, j + 1)
      i = j + 1
      let braceDepth = 1
      while (i < code.length && braceDepth > 0) {
        const c = code[i]
        if (c === '"' || c === "'" || c === '`') {
          const k = skipString(code, i)
          result += code.slice(i, k)
          i = k
          continue
        }
        if (c === '{') braceDepth++
        else if (c === '}') braceDepth--
        result += c
        i++
      }
    } else if (code.startsWith('return false', i) && (i + 12 >= code.length || !/[a-zA-Z0-9_$]/.test(code[i + 12]))) {
      result += onFalse
      i += 12
    } else if (code.startsWith('return true', i) && (i + 11 >= code.length || !/[a-zA-Z0-9_$]/.test(code[i + 11]))) {
      result += onTrue
      i += 11
    } else {
      result += ch
      i++
    }
  }
  return result
}

// Returns true if a property sub-schema will generate 2+ lines that each access v,
// meaning a local variable hoist is worthwhile.
// A required object or array whose checks read it many times: into a local,
// once. Reading \`d["customer"]\` afresh on every line cost a plain order
// verdict 42 percent, since a helper call between two reads (a prototype
// check, a length count) keeps V8 from reusing the first. Composition keeps
// the direct access, the same line needsLocal draws.
function isPlainContainer(schema) {
  if (typeof schema !== 'object' || schema === null) return false
  if (schema.$ref || schema.$dynamicRef || schema.allOf || schema.anyOf || schema.oneOf || schema.if || schema.not) return false
  return !!(schema.properties || schema.items || schema.prefixItems)
}

function needsLocal(schema) {
  if (typeof schema !== 'object' || schema === null) return false
  // If it has $ref, allOf, anyOf etc., genCode handles it — don't hoist
  if (schema.$ref || schema.allOf || schema.anyOf || schema.oneOf || schema.if) return false
  if (schema.properties || schema.items || schema.prefixItems) return false
  const types = schema.type ? (Array.isArray(schema.type) ? schema.type : [schema.type]) : null
  if (!types || types.length !== 1) return false
  const t = types[0]
  let checkCount = 1 // type check itself
  if (t === 'string') {
    if (schema.minLength !== undefined) checkCount++
    if (schema.maxLength !== undefined) checkCount++
    if (schema.pattern) checkCount++
    if (schema.format) checkCount++
  } else if (t === 'integer' || t === 'number') {
    if (schema.minimum !== undefined) checkCount++
    if (schema.maximum !== undefined) checkCount++
    if (schema.exclusiveMinimum !== undefined) checkCount++
    if (schema.exclusiveMaximum !== undefined) checkCount++
    if (schema.multipleOf !== undefined) checkCount++
  }
  return checkCount >= 2
}

// Try to generate a single combined check for simple leaf schemas.
// Returns a string like "{const _v=d["x"];if(typeof _v!=='string'||_v.length<1||_v.length>100)return false}"
// or null if the schema is too complex.
function tryGenCombined(schema, access, ctx) {
  if (typeof schema !== 'object' || schema === null) return null
  // Only handle simple leaf schemas with a single type and basic constraints
  if (schema.$ref || schema.allOf || schema.anyOf || schema.oneOf || schema.if) return null
  if (schema.properties || schema.items || schema.prefixItems || schema.patternProperties) return null
  if (schema.enum || schema.const !== undefined) return null
  if (schema.not || schema.dependentRequired || schema.dependentSchemas) return null
  const types = schema.type ? (Array.isArray(schema.type) ? schema.type : [schema.type]) : null
  if (!types || types.length !== 1) return null
  const t = types[0]

  // If access is already a simple identifier (optional-property hoist, a `_o0`
  // or similar), skip the `{const _v = access}` wrapping and use it directly.
  const isIdent = /^_[a-zA-Z]\w*$/.test(access)
  const bind = (conds) => isIdent
    ? `if(${conds.join('||').replace(/\b_v\b/g, access)})return false`
    : `{const _v=${access};if(${conds.join('||')})return false}`

  if (t === 'string') {
    if (schema.pattern || schema.format) return null
    // s.length is an upper bound on cpLen and at least cpLen / 2 (worst case
    // all-surrogate). Use s.length fast paths and only call _cpLen in the
    // uncertain band; ASCII strings (>99% of real data) skip _cpLen entirely.
    if (schema.minLength !== undefined && schema.maxLength !== undefined) {
      const M = schema.minLength
      const X = schema.maxLength
      const v2 = isIdent ? access : '_v'
      const prelude = isIdent ? '' : `const _v=${access};`
      return `{${prelude}if(typeof ${v2}!=='string')return false;const _lv=${v2}.length;if(_lv<${M}||_lv>${X * 2})return false;if(_lv<${M * 2}||_lv>${X}){const _cp=_cpLen(${v2});if(_cp<${M}||_cp>${X})return false}}`
    }
    const conds = [`typeof _v!=='string'`]
    if (schema.minLength !== undefined && schema.minLength > 0) {
      const M = schema.minLength
      conds.push(`_v.length<${M}`)
      // For M=1, length<1 already catches all failures (any non-empty string has cpLen>=1).
      if (M > 1) conds.push(`_v.length<${M * 2}&&_cpLen(_v)<${M}`)
    }
    if (schema.maxLength !== undefined) {
      const X = schema.maxLength
      // For X=0, only empty string passes, length>0 fails — no cpLen needed.
      if (X === 0) {
        conds.push(`_v.length>0`)
      } else {
        conds.push(`_v.length>${X * 2}`)
        conds.push(`_v.length>${X}&&_cpLen(_v)>${X}`)
      }
    }
    if (conds.length < 2) return null
    return bind(conds)
  }

  if (t === 'integer') {
    const conds = [`!Number.isInteger(_v)`]
    if (schema.minimum !== undefined) conds.push(`_v<${schema.minimum}`)
    if (schema.maximum !== undefined) conds.push(`_v>${schema.maximum}`)
    if (schema.exclusiveMinimum !== undefined) conds.push(`_v<=${schema.exclusiveMinimum}`)
    if (schema.exclusiveMaximum !== undefined) conds.push(`_v>=${schema.exclusiveMaximum}`)
    if (schema.multipleOf !== undefined) conds.push(`(${multipleOfBad('_v', schema.multipleOf)})`)
    if (conds.length < 2) return null
    return bind(conds)
  }

  if (t === 'number') {
    const conds = [`!Number.isFinite(_v)`]
    if (schema.minimum !== undefined) conds.push(`_v<${schema.minimum}`)
    if (schema.maximum !== undefined) conds.push(`_v>${schema.maximum}`)
    if (schema.exclusiveMinimum !== undefined) conds.push(`_v<=${schema.exclusiveMinimum}`)
    if (schema.exclusiveMaximum !== undefined) conds.push(`_v>=${schema.exclusiveMaximum}`)
    if (schema.multipleOf !== undefined) conds.push(`(${multipleOfBad('_v', schema.multipleOf)})`)
    if (conds.length < 2) return null
    return bind(conds)
  }

  return null
}

// Deferred checks (additionalProperties, unevaluatedProperties, ...) reference
// the current node variable (`${v}`). Deferring them to the end of the root
// function is only safe when we're at the root (`v === 'd'`). For nested
// nodes, emit inline so block-scoped variables like `_o0` stay in scope.
function _deferOrInline(ctx, lines, v, check) {
  // Deferring is only sound at the top level of the root function. Inside a
  // conditional applicator (dependentSchemas) the check must stay in its block.
  // Nor inside a verdict generated for a subschema (nestedGenCode, the inline
  // annotation verdicts of run-time unevaluatedProperties): those lines go
  // into a block or a function of their own and nothing flushes the deferred
  // list for them, so a deferred check was dropped. A branch of an anyOf with
  // `additionalProperties: { const: true }` at the root then read as holding
  // for every object, and unevaluatedProperties accepted what it evaluated.
  if (v === 'd' && !ctx.condDepth && !ctx.nestedBoolean) {
    if (!ctx.deferredChecks) ctx.deferredChecks = []
    ctx.deferredChecks.push(check)
  } else {
    lines.push(check)
  }
}

// knownType: if parent already verified the type, skip redundant guards.
// 'object' = we know v is a non-null non-array object
// 'array'  = we know v is an array
// 'string' / 'number' / 'integer' = we know the primitive type
// Custom keywords (the `keywords` option, normalized by lib/keywords.js) as
// calls into the caller's functions, threaded in as closure variables the way
// user formats are. Each check is built here with the interpreter's own
// semantics, so the two engines cannot disagree on one: the keyword is skipped
// for data outside its declared types (the interpreter's type bits), the
// compile form is built once per schema node, and any errors the function
// leaves on itself are cleared after the call, as runCustomV does. Written
// first in the node, before anything that could return early.
// The interpreter's type bits (lib/interpreter.js typeBit and dataBits),
// copied rather than required: loading the interpreter added about a
// millisecond to the first call of a schema that never needs it.
// tests/test_custom_keyword_codegen.js holds the copies equal to the originals.
const KW_T_ANY = 127
function kwTypeBit (name) {
  switch (name) {
    case 'string': return 1
    case 'number': return 2
    case 'integer': return 4
    case 'boolean': return 8
    case 'null': return 16
    case 'object': return 32
    case 'array': return 64
    default: return KW_T_ANY
  }
}
function kwDataBits (d) {
  switch (typeof d) {
    case 'string': return 1
    case 'number':
      if (!isFinite(d)) return 0
      return Number.isInteger(d) ? 2 | 4 : 2
    case 'boolean': return 8
    case 'object':
      if (d === null) return 16
      return Array.isArray(d) ? 64 : 32
    default: return 0
  }
}
function genCustomKeywords (schema, v, lines, ctx) {
  for (const key of Object.keys(schema)) {
    const def = ctx.keywords[key]
    if (def === undefined || def.macro !== null) continue
    const value = schema[key]
    const dataBits = kwDataBits
    const T_ANY = KW_T_ANY
    let mask = T_ANY
    if (def.types !== null) {
      mask = 0
      for (const t of def.types) mask |= kwTypeBit(t)
    }
    let fn
    if (def.compile !== null) {
      fn = def.compile(value, schema)
      if (typeof fn !== 'function') throw new Error(`keyword "${key}": compile must return a function`)
    } else {
      const validate = def.validate
      fn = (data) => validate(value, data, schema)
      fn.source = validate
    }
    const holder = () => fn.source || fn
    const check = mask === T_ANY
      ? (data) => { const ok = fn(data); const h = holder(); if (h.errors) h.errors = null; return !!ok }
      : (data) => {
          if ((dataBits(data) & mask) === 0) return true
          const ok = fn(data); const h = holder(); if (h.errors) h.errors = null; return !!ok
        }
    const name = '_kwc' + ctx.closureVars.length
    ctx.closureVars.push(name)
    ctx.closureVals.push(check)
    lines.push(`if(!${name}(${v}))return false`)
  }
  ctx.kwEmitted.add(schema)
}

// Map keys under these are names, not keywords (lib/keywords.js NAME_MAPS).
const KW_NAME_MAPS = new Set([
  'properties', 'patternProperties', '$defs', 'definitions',
  'dependentSchemas', 'dependentRequired', 'dependencies', 'propertyDependencies',
])
function forEachKeywordNode (schema, schemaMap, keywords, visit) {
  const seen = new Set()
  const walk = (node, keysAreNames) => {
    if (node === null || typeof node !== 'object' || seen.has(node)) return
    seen.add(node)
    if (Array.isArray(node)) { for (const item of node) walk(item, false); return }
    let has = false
    for (const key of Object.keys(node)) {
      if (!keysAreNames && keywords[key] !== undefined) has = true
      const val = node[key]
      if (val !== null && typeof val === 'object') walk(val, !keysAreNames && KW_NAME_MAPS.has(key))
    }
    if (has) visit(node)
  }
  walk(schema, false)
  if (schemaMap) for (const s of schemaMap.values()) walk(s, false)
}
function keywordNodes (schema, schemaMap, keywords) {
  const out = []
  forEachKeywordNode(schema, schemaMap, keywords, (n) => out.push(n))
  return out
}
function usesMacroKeyword (schema, schemaMap, keywords) {
  let macro = false
  forEachKeywordNode(schema, schemaMap, keywords, (n) => {
    for (const key of Object.keys(n)) if (keywords[key] !== undefined && keywords[key].macro !== null) macro = true
  })
  return macro
}

function genCode(schema, v, lines, ctx, knownType) {
  return withPlain(schema, v, lines, ctx, () => genCodeNode(schema, v, lines, ctx, knownType))
}
function genCodeNode(schema, v, lines, ctx, knownType) {
  // A boolean schema is a constant. false rejects whatever reached it; true
  // constrains nothing and emits nothing, which is correct only because the
  // caller's own checks still stand around this call.
  if (schema === false) { lines.push('return false'); return }
  if (schema === true) return
  if (typeof schema !== 'object' || schema === null) return
  if (ctx.keywords) genCustomKeywords(schema, v, lines, ctx)
  if (!ctx.regExpMap) {
    ctx.regExpMap = new Map();
  }

  // Bookkeeping about THIS node, so it stays in this call. On `ctx` it outlived
  // the node: a sibling that set one made the next node skip a check it owed,
  // and `propertyNames` then vanished from the emitted program. Same class as
  // the deferred additionalProperties bug, so same answer, a local.
  let ppHandledPropertyNames = false
  let earlyKeyCount = false

  // $ref — guard against circular references
  // In 2020-12 with unevaluated*, $ref can coexist with siblings — don't early return
  // Only when THIS schema has unevaluated keywords directly (not via $ref target)
  // Any keyword beside $ref that validates is compiled after the reference
  // (2020-12 applies both; draft 7 drops such siblings when it is read).
  const hasSiblings = !!schema.$ref && Object.keys(schema).some((k) => !REF_NEUTRAL_SIBLINGS.has(k) && !k.startsWith('x-'))
  if (schema.$ref) {
    if (genRefNode(schema, v, lines, ctx, knownType, hasSiblings)) return
  }

  // $dynamicRef — resolve via anchors map
  if (schema.$dynamicRef) genDynamicRefNode(schema, v, lines, ctx, knownType)

  // Determine the single known type after this schema's type check
  const types = schema.type ? (Array.isArray(schema.type) ? schema.type : [schema.type]) : null
  let effectiveType = knownType
  if (types) {
    if (!knownType) {
      // Emit the type check — use direct negation for single types (avoids !() wrapper)
      if (types.length === 1) {
        switch (types[0]) {
          case 'object': lines.push(`if(typeof ${v}!=='object'||${v}===null||Array.isArray(${v}))return false`); break
          case 'array': lines.push(`if(!Array.isArray(${v}))return false`); break
          case 'string': lines.push(`if(typeof ${v}!=='string')return false`); break
          case 'number': lines.push(`if(!Number.isFinite(${v}))return false`); break
          case 'integer': lines.push(`if(!Number.isInteger(${v}))return false`); break
          case 'boolean': lines.push(`if(typeof ${v}!=='boolean')return false`); break
          case 'null': lines.push(`if(${v}!==null)return false`); break
        }
      } else {
        const conds = types.map(t => {
          switch (t) {
            case 'object': return `(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v}))`
            case 'array': return `Array.isArray(${v})`
            case 'string': return `typeof ${v}==='string'`
            case 'number': return `Number.isFinite(${v})`
            case 'integer': return `Number.isInteger(${v})`
            case 'boolean': return `typeof ${v}==='boolean'`
            case 'null': return `${v}===null`
            default: return 'true'
          }
        })
        lines.push(`if(!(${conds.join('||')}))return false`)
      }
    }
    // If single type, downstream checks can skip guards
    if (types.length === 1) effectiveType = types[0]
  }

  const isObj = effectiveType === 'object'
  const isArr = effectiveType === 'array'
  const isStr = effectiveType === 'string'
  const isNum = effectiveType === 'number' || effectiveType === 'integer'
  const objGuard = isObj ? '' : `typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})&&`
  const objCheck = isObj ? '' : `if(typeof ${v}!=='object'||${v}===null)return false;`

  // enum
  if (schema.enum) {
    lines.push(`if(!(${enumCondition(ctx, schema.enum, v)}))return false`)
  }

  // const
  if (schema.const !== undefined) {
    const cv = schema.const
    if (cv === null || typeof cv !== 'object') {
      lines.push(`if(${v}!==${JSON.stringify(cv)})return false`)
    } else {
      // Structural comparison against a value parsed once, so the hot path
      // neither builds a closure nor serializes the instance.
      lines.push(`if(!${emitDeq(ctx)}(${v},${emitConstant(ctx, cv)}))return false`)
    }
  }

  // Collect required keys so property checks can skip 'in' guard
  const requiredSet = new Set(schema.required || [])

  // required: skip explicit check if property has a type constraint
  // (type check on undefined returns false anyway: Number.isInteger(undefined) === false)
  const hoisted = {} // key -> access expression
  if (schema.required && schema.properties && isObj) {
    const reqChecks = []
    const typed = []
    for (const key of schema.required) {
      hoisted[key] = `${v}[${JSON.stringify(key)}]`
      const prop = schema.properties[key]
      const hasTypeCheck = prop && (prop.type || prop.enum || prop.const !== undefined)
      // A typed property needs no separate presence check on an ordinary
      // object: its type check fails on undefined. A name on Object.prototype
      // is never absent that way, and it is checked explicitly.
      if (!hasTypeCheck || PROTO_NAMES.has(key)) {
        reqChecks.push(`!${ownKeyExpr(ctx, v, key)}`)
      } else {
        typed.push(key)
      }
    }
    if (reqChecks.length > 0) {
      lines.push(`if(${reqChecks.join('||')})return false`)
    }
    // On an object with another prototype the typed ones may be inherited.
    if (typed.length > 0) {
      useOwnHelper(ctx, '_hall')
      // Read directly: the object type is already established here, and a
      // flag declared for this alone costs more than it saves. The list is
      // built only on that path, which an ordinary object never takes.
      // When withPlain already holds the answer for this object in a flag,
      // read the flag: the prototype test is an accessor call, and making it
      // twice per object was a tenth of a plain order's verdict.
      const pk = plainFlag(ctx, v)
      lines.push(`if(!${pk || protoIs(ctx, v)}&&!_hall(${v},${JSON.stringify(typed)}))return false`)
    }
  } else if (schema.required && schema.required.length > 0) {
    const checks = schema.required.map(key => `!${ownKeyExpr(ctx, v, key)}`)
    if (isObj) {
      lines.push(`if(${checks.join('||')})return false`)
    } else {
      // required applies to objects only; other types are ignored.
      lines.push(`if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})&&(${checks.join('||')}))return false`)
    }
  }

  // Early key count for unevaluatedProperties: false (before properties, 10% faster)
  // V8 branch prediction benefits from for-in iteration before property access
  if (schema.unevaluatedProperties === false && schema.properties && schema.required && isObj) {
    const evalResult = collectEvaluated(schema, ctx.schemaMap, ctx.rootDefs)
    if (!evalResult.dynamic && !evalResult.allProps) {
      const knownKeys = evalResult.props
      const propCount = knownKeys.length
      const allRequired = schema.required.length >= propCount &&
        knownKeys.every(k => schema.required.includes(k))
      if (allRequired && propCount > 0) {
        // Adaptive: for-in for <=15 keys (V8 fast path), Object.keys for >15
        if (propCount <= 15) {
          lines.push(`var _n=0;for(var _k in ${v})_n++;if(_n!==${propCount})return false`)
        } else {
          lines.push(`if(Object.keys(${v}).length!==${propCount})return false`)
        }
        earlyKeyCount = true // this node emitted its key count already
      }
    }
  }

  // numeric — skip type guard if known numeric
  // Without `type: number` beside it, a numeric keyword has to let a
  // non-finite value through: it carries no type, an empty schema accepts it,
  // and the interpreted engine reads it the same way. With `type: number` the
  // type check has already turned it away, so the guard is only needed here.
  const numGuard = isNum ? '' : `Number.isFinite(${v})&&`
  if (schema.minimum !== undefined) lines.push(`if(${numGuard}${v}<${schema.minimum})return false`)
  if (schema.maximum !== undefined) lines.push(`if(${numGuard}${v}>${schema.maximum})return false`)
  if (schema.exclusiveMinimum !== undefined) lines.push(`if(${numGuard}${v}<=${schema.exclusiveMinimum})return false`)
  if (schema.exclusiveMaximum !== undefined) lines.push(`if(${numGuard}${v}>=${schema.exclusiveMaximum})return false`)
  if (schema.multipleOf !== undefined) {
    const m = schema.multipleOf
    const bad = `(${multipleOfBad(v, m)})`
    lines.push(`if(${numGuard}${bad})return false`)
  }

  // string length — skip type guard if known string.
  // s.length (UTF-16 code units) is an upper bound on cpLen, and at least cpLen
  // (worst case all surrogate pairs gives s.length = 2 * cpLen). So:
  //   length < M           → certain fail minLength
  //   length > 2*X         → certain fail maxLength
  //   2*M <= length <= X   → certain pass both
  // Only call _cpLen in the uncertain band. ASCII strings (>99% of real data)
  // never enter the band.
  if (schema.minLength !== undefined && schema.maxLength !== undefined) {
    const M = schema.minLength
    const X = schema.maxLength
    const li = ctx.varCounter++
    const lv = `_l${li}`
    const body = `{const ${lv}=${v}.length;if(${lv}<${M}||${lv}>${X * 2})return false;if(${lv}<${M * 2}||${lv}>${X}){const _cp=_cpLen(${v});if(_cp<${M}||_cp>${X})return false}}`
    lines.push(isStr ? body : `if(typeof ${v}==='string')${body}`)
  } else {
    if (schema.minLength !== undefined && schema.minLength > 0) {
      const M = schema.minLength
      // M==1: length<1 already catches empty strings (any non-empty string has cpLen>=1).
      const body = M === 1
        ? `if(${v}.length<1)return false`
        : `if(${v}.length<${M})return false;if(${v}.length<${M * 2}&&_cpLen(${v})<${M})return false`
      lines.push(isStr ? body : `if(typeof ${v}==='string'){${body}}`)
    }
    if (schema.maxLength !== undefined) {
      const X = schema.maxLength
      // X==0: only empty string passes, no cpLen needed.
      const body = X === 0
        ? `if(${v}.length>0)return false`
        : `if(${v}.length>${X * 2})return false;if(${v}.length>${X}&&_cpLen(${v})>${X})return false`
      lines.push(isStr ? body : `if(typeof ${v}==='string'){${body}}`)
    }
  }

  // array size — skip guard if known array
  if (schema.minItems !== undefined) lines.push(isArr ? `if(${v}.length<${schema.minItems})return false` : `if(Array.isArray(${v})&&${v}.length<${schema.minItems})return false`)
  if (schema.maxItems !== undefined) lines.push(isArr ? `if(${v}.length>${schema.maxItems})return false` : `if(Array.isArray(${v})&&${v}.length>${schema.maxItems})return false`)

  // object size
  if (schema.minProperties !== undefined) lines.push(`if(${objGuard}Object.keys(${v}).length<${schema.minProperties})return false`)
  if (schema.maxProperties !== undefined) lines.push(`if(${objGuard}Object.keys(${v}).length>${schema.maxProperties})return false`)

  if (schema.pattern) {
    // Try inline charCode compilation for simple patterns (avoids RegExp engine)
    const inlineCheck = compilePatternInline(schema.pattern, v)
    if (inlineCheck) {
      lines.push(isStr ? `if(!(${inlineCheck}))return false` : `if(typeof ${v}==='string'&&!(${inlineCheck}))return false`)
    } else {
      const pattern = JSON.stringify(schema.pattern);
      if (!ctx.regExpMap.has(pattern)) {
        const ri = ctx.varCounter++
        ctx.regExpMap.set(pattern, ri)
        if (useSafeEngine(schema.pattern)) {
          ctx.helperCode.push(`const _re${ri}=__ataSafeRe(${pattern})`);
          ctx.usesSafeRe = true
        } else {
          ctx.helperCode.push(`const _re${ri}=new RegExp(${pattern}${reFlagArg(pattern)})`);
        }
      }
      const ri = ctx.regExpMap.get(pattern);
      lines.push(isStr ? `if(!_re${ri}.test(${v}))return false` : `if(typeof ${v}==='string'&&!_re${ri}.test(${v}))return false`)
    }
  }

  if (schema.format) {
    const fc = FORMAT_CODEGEN[schema.format]
    if (fc) {
      lines.push(fc(v, isStr, ctx))
    } else if (ctx.userFormats && typeof ctx.userFormats[schema.format] === 'function') {
      // User-supplied format checker: thread the function via closure and call at runtime.
      const safeName = schema.format.replace(/[^a-zA-Z0-9_]/g, '_')
      const closureName = `_uf_${safeName}`
      if (!ctx.closureVars.includes(closureName)) {
        ctx.closureVars.push(closureName)
        ctx.closureVals.push(ctx.userFormats[schema.format])
      }
      const guard = isStr ? '' : `typeof ${v}==='string'&&`
      lines.push(`if(${guard}!${closureName}(${v}))return false`)
    }
  }

  // uniqueItems — tiered strategy based on expected array size
  if (schema.uniqueItems) genUniqueItemsNode(schema, v, lines, ctx, knownType, hoisted, isArr, types)

  // additionalProperties -- deferred to end of function for better V8 optimization
  // (type checks run first in hot path, expensive prop count check last)
  // Skip if patternProperties is present — it will handle additionalProperties in a unified loop
  if (schema.additionalProperties === false && schema.properties && !schema.patternProperties && ctx.removeNodes && ctx.removeNodes.has(schema)) {
    const kv = `_rk${ctx.varCounter++}`
    const declared = Object.keys(schema.properties)
    let loop = `for(var ${kv} in ${v})if(${declared.map((k) => `${kv}!==${JSON.stringify(k)}`).join('&&')})delete ${v}[${kv}]`
    // When every declared property is required, the verdict has already
    // established they are all there, so a key count equal to the declared
    // count means nothing is extra and the deleting walk, which compares every
    // key against the declared names, need not run.
    const req = new Set(schema.required || [])
    if (declared.length <= 15 && declared.every((k) => req.has(k))) {
      const n = `_rn${ctx.varCounter++}`
      loop = `{var ${n}=0;for(var ${kv} in ${v})${n}++;if(${n}!==${declared.length}){${loop}}}`
    }
    _deferOrInline(ctx, lines, v, isObj ? loop : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){${loop}}`)
  } else if (schema.additionalProperties === false && !schema.patternProperties) {
    // No `properties` means nothing is declared, so every key is additional.
    // The generators used to emit nothing for that shape, and the safety gate
    // declined it everywhere; at any depth it now compiles.
    const declaredKeys = Object.keys(schema.properties || {})
    const propCount = declaredKeys.length
    // Counting keys proves there is no extra key only when every declared
    // name is required. Comparing the list lengths was not that: with
    // `properties: {c}` and `required: ['b']` the counts matched, and `{b: 1}`
    // was accepted although `b` is an additional property.
    const req = new Set(schema.required || [])
    const allRequired = !!schema.required && declaredKeys.every((k) => req.has(k))
    const inner = allRequired
      ? (propCount <= 15
          ? `var _n=0;for(var _k in ${v})_n++;if(_n!==${propCount})return false`
          : `if(Object.keys(${v}).length!==${propCount})return false`)
      : apMembershipCheck(ctx, Object.keys(schema.properties || {}), v)
        _deferOrInline(ctx, lines, v, isObj ? inner : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){${inner}}`)
  }

  // additionalProperties as a schema: validate every non-declared property
  // against that sub-schema. Skip if patternProperties is present (handled by
  // the unified loop). Composition cases are filtered out by codegenSafe.
  if (typeof schema.additionalProperties === 'object' && schema.additionalProperties !== null && !schema.patternProperties) genAdditionalSchemaNode(schema, v, lines, ctx, knownType, isObj)

  // dependentRequired
  if (schema.dependentRequired) {
    for (const [key, deps] of Object.entries(schema.dependentRequired)) {
      const depChecks = deps.map(d => `!${ownKeyExpr(ctx, v, d)}`).join('||')
      lines.push(`if(${objGuard}${ownKeyExpr(ctx, v, key)}&&(${depChecks}))return false`)
    }
  }

  // patternProperties + propertyNames + additionalProperties — unified key iteration
  // Merges up to 3 separate for..in loops into one pass.
  if (schema.patternProperties) {
    if (genPatternPropertiesNode(schema, v, lines, ctx, knownType, isObj)) ppHandledPropertyNames = true
  }

  // dependentSchemas
  if (schema.dependentSchemas) genDependentSchemasNode(schema, v, lines, ctx, knownType, effectiveType, isObj)

  // propertyNames: false rejects any key at all; true constrains nothing.
  if (schema.propertyNames === false) {
    lines.push(isObj
      ? `for(const _k in ${v})return false`
      : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){for(const _k in ${v})return false}`)
  }

  // propertyNames — only emit if not already merged into patternProperties loop
  if (schema.propertyNames && typeof schema.propertyNames === 'object' && !ppHandledPropertyNames) genPropertyNamesNode(schema, v, lines, ctx, knownType, isObj)

  // properties — use hoisted vars for required props, hoist optional to locals too
  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      if (requiredSet.has(key) && isObj) {
        // Required + type:object — hoist to local to reduce repeated property lookups
        const access = hoisted[key] || `${v}[${JSON.stringify(key)}]`
        const combined = tryGenCombined(prop, access, ctx)
        if (combined) {
          lines.push(combined)
        } else if (needsLocal(prop) || isPlainContainer(prop)) {
          const oi = ctx.varCounter++
          const local = `_r${oi}`
          lines.push(`{const ${local}=${access}`)
          genCode(prop, local, lines, ctx)
          lines.push(`}`)
        } else {
          genCode(prop, access, lines, ctx)
        }
      } else if (isObj) {
        // Optional — hoist to local, check undefined
        const oi = ctx.varCounter++
        const local = `_o${oi}`
        lines.push(`{const ${local}=${v}[${JSON.stringify(key)}];if(${local}!==undefined&&${ownGuard(ctx, v, key)}){`)
        const combined = tryGenCombined(prop, local, ctx)
        if (combined) {
          lines.push(combined)
        } else {
          genCode(prop, local, lines, ctx)
        }
        lines.push(`}}`)
      } else {
        lines.push(`if(typeof ${v}==='object'&&${v}!==null&&${ownKeyExpr(ctx, v, key)}){`)
        genCode(prop, `${v}[${JSON.stringify(key)}]`, lines, ctx)
        lines.push(`}`)
      }
    }
  }

  // items — pass known type info to children
  if (schema.items !== undefined && schema.items !== true) {
    const idx = `_j${ctx.varCounter}`
    const elem = `_e${ctx.varCounter}`
    ctx.varCounter++
    // items applies after the prefixItems positions (Draft 2020-12).
    const start = Array.isArray(schema.prefixItems) ? schema.prefixItems.length : 0
    lines.push(isArr
      ? `for(let ${idx}=${start};${idx}<${v}.length;${idx}++){const ${elem}=${v}[${idx}]`
      : `if(Array.isArray(${v})){for(let ${idx}=${start};${idx}<${v}.length;${idx}++){const ${elem}=${v}[${idx}]`)
    genCode(schema.items, elem, lines, ctx)
    lines.push(isArr ? `}` : `}}`)
  }

  // prefixItems
  if (schema.prefixItems) genPrefixItemsNode(schema, v, lines, ctx, knownType, isArr)

  // contains — use helper function to avoid try/catch overhead
  if (schema.contains !== undefined) genContainsNode(schema, v, lines, ctx, knownType, isArr)

  // allOf — pass known type through
  if (schema.allOf) {
    for (const sub of schema.allOf) {
      genCode(sub, v, lines, ctx, effectiveType)
    }
  }

  // anyOf — branch fns hoisted when safe, inline fallback when recursive.
  // The anyOf model in genUnevaluatedPropertiesNode checks that a branch
  // passes while it records what the branches evaluate, so anyOf is emitted
  // once, there. Only that model does: with unevaluatedProperties true or a
  // schema, skipping it here left anyOf unchecked and accepted a document no
  // branch matched.
  // Where unevaluatedProperties builds its evaluated set at run time, the
  // annotation pass already decides each anyOf and oneOf branch, so the
  // keywords' own blocks would decide them a second time: on a schema of
  // nested references that doubled the cost of accepting a document. Their
  // blocks go to the `else` of that pass instead, for a value that is not an
  // object, which the pass does not look at and which they must still judge.
  const nonObjApplicators = schema.unevaluatedProperties !== undefined && schema.additionalProperties === undefined &&
    (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf)) && unevalBuiltAtRuntime(schema, ctx) ? [] : null
  const applicatorLines = nonObjApplicators || lines
  if (schema.anyOf && !unevalChecksAnyOf(schema, ctx)) genAnyOfNode(schema, v, applicatorLines, ctx, knownType)

  // oneOf — branch fns hoisted to factory scope when safe (no recursion/ref).
  // Falls back to inline closures if any branch touches recursive validation.
  if (schema.oneOf) genOneOfNode(schema, v, applicatorLines, ctx, knownType)

  // not
  if (schema.not !== undefined) genNotNode(schema, v, lines, ctx, knownType)

  // if/then/else
  if (schema.if !== undefined) genIfNode(schema, v, lines, ctx, knownType)

  // unevaluatedProperties
  if (schema.unevaluatedProperties !== undefined) genUnevaluatedPropertiesNode(schema, v, lines, ctx, knownType, isObj, hoisted, earlyKeyCount, nonObjApplicators)

  // unevaluatedItems
  if (schema.unevaluatedItems !== undefined) genUnevaluatedItemsNode(schema, v, lines, ctx, knownType, isArr)
}

// The rarely used keyword families live outside genCodeNode, so a schema that
// never uses them does not pay V8 to compile them on its first check. Each is
// called with the locals it reads; genRefNode returns true when the node is done.

function genDynamicRefNode(schema, v, lines, ctx, knownType) {
  const anchorKey = schema.$dynamicRef.startsWith('#') ? schema.$dynamicRef : '#' + schema.$dynamicRef
  if (ctx.anchors && ctx.anchors[anchorKey]) {
    const target = ctx.anchors[anchorKey]
    if (target === ctx.rootSchema) {
      // Self-recursive: generate _validate(v) call
      if (ctx.nestedBoolean) throw DECLINE
      ctx.usesRecursion = true
      lines.push(`if(!_validate(${v}))return false`)
    } else {
      // Different schema: inline the target validation
      const refKey = '$dynamicRef:' + anchorKey
      if (ctx.refStack.has(refKey) && ctx.nestedBoolean) throw DECLINE
      if (!ctx.refStack.has(refKey)) {
        ctx.refStack.add(refKey)
        genCode(target, v, lines, ctx, knownType)
        ctx.refStack.delete(refKey)
      }
    }
  }
}

function genUniqueItemsNode(schema, v, lines, ctx, knownType, hoisted, isArr, types) {
  const si = ctx.varCounter++
  const itemType = schema.items && typeof schema.items === 'object' && schema.items.type
  const isPrimItems = itemType === 'string' || itemType === 'number' || itemType === 'integer'
  const maxItems = schema.maxItems
  // Small primitive arrays (maxItems <= 16): nested loop is 6x faster than Set
  // No allocation, no hash computation — just direct === comparison
  let inner
  if (isPrimItems && maxItems && maxItems <= 16) {
    inner = `for(let _i=1;_i<${v}.length;_i++){for(let _k=0;_k<_i;_k++){if(${v}[_i]===${v}[_k])return false}}`
  } else if (isPrimItems) {
    inner = `const _s${si}=new Set();for(let _i=0;_i<${v}.length;_i++){if(_s${si}.has(${v}[_i]))return false;_s${si}.add(${v}[_i])}`
  } else if (ctx.preamble) {
    // Unknown item types: one hoisted helper per compiled function. Short
    // arrays compare pairwise with a structural equality that ignores key
    // order and allocates nothing; longer ones fall back to a Set of
    // primitives, or to sorted-key canonical strings once an object shows
    // up. The previous form built the canonical closure and a Set on
    // every call, even for [1, 2, 3].
    inner = `if(!${emitUq(ctx)}(${v}))return false`
  } else if (ctx.helperCode) {
    // Inside the error or combined function, whose helper code is emitted
    // into its source, the same hoisted helper.
    inner = `if(!${emitUq(ctx)}(${v}))return false`
  } else {
    inner = `const _cn${si}=function(x){if(x===null||typeof x!=='object')return typeof x+':'+x;if(Array.isArray(x))return'['+x.map(_cn${si}).join(',')+']';return'{'+Object.keys(x).sort().map(function(k){return JSON.stringify(k)+':'+_cn${si}(x[k])}).join(',')+'}'};const _s${si}=new Set();for(let _i=0;_i<${v}.length;_i++){const _k=_cn${si}(${v}[_i]);if(_s${si}.has(_k))return false;_s${si}.add(_k)}`
  }
  lines.push(isArr ? `{${inner}}` : `if(Array.isArray(${v})){${inner}}`)
}

function genAdditionalSchemaNode(schema, v, lines, ctx, knownType, isObj) {
  // The loop variables carry a unique suffix: a record whose values are
  // themselves records nests this loop inside itself, and a fixed `_av`
  // made the inner `const _av=_av[_k]` a self-reference that threw at
  // validation time.
  const apId = ctx._apLoopId = (ctx._apLoopId || 0) + 1
  const kVar = `_k${apId}`
  const avVar = `_av${apId}`
  const declared = schema.properties ? Object.keys(schema.properties) : []
  const skipCheck = declared.length === 0
    ? null
    : declared.map(k => `${kVar}===${JSON.stringify(k)}`).join('||')
  const subLines = []
  genCode(schema.additionalProperties, avVar, subLines, ctx)
  if (subLines.length > 0) {
    const body = subLines.join(';')
    const loop = skipCheck
      ? `for(var ${kVar} in ${v}){if(${skipCheck})continue;const ${avVar}=${v}[${kVar}];${body}}`
      : `for(var ${kVar} in ${v}){const ${avVar}=${v}[${kVar}];${body}}`
    _deferOrInline(ctx, lines, v, isObj ? loop : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){${loop}}`)
  }
}

function genDependentSchemasNode(schema, v, lines, ctx, knownType, effectiveType, isObj) {
  for (const [key, depSchema] of Object.entries(schema.dependentSchemas)) {
    const guard = isObj ? '' : `typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})&&`
    lines.push(`if(${guard}${ownKeyExpr(ctx, v, key)}){`)
    ctx.condDepth = (ctx.condDepth || 0) + 1
    genCode(depSchema, v, lines, ctx, effectiveType)
    ctx.condDepth--
    lines.push(`}`)
  }
}

function genPropertyNamesNode(schema, v, lines, ctx, knownType, isObj) {
  const pn = schema.propertyNames
  const ki = ctx.varCounter++
  const guard = isObj ? '' : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v}))`
  if (!isSimplePN(pn)) {
    const sub = []
    genCode(pn, '_pv', sub, ctx)
    if (sub.length === 0) return
    lines.push(`${guard}{const _pnf${ki}=function(_pv){${sub.join(';')};return true};for(const _k${ki} in ${v}){if(!_pnf${ki}(_k${ki}))return false}}`)
    return
  }
  lines.push(`${guard}{for(const _k${ki} in ${v}){`)
  if (pn.minLength !== undefined) lines.push(`if(_k${ki}.length<${pn.minLength})return false`)
  if (pn.maxLength !== undefined) lines.push(`if(_k${ki}.length>${pn.maxLength})return false`)
  if (pn.pattern) {
    const fast = fastPrefixCheck(pn.pattern, `_k${ki}`)
    if (fast) {
      lines.push(`if(!(${fast}))return false`)
    } else {
      const ri = ctx.varCounter++
      ctx.closureVars.push(`_re${ri}`)
      ctx.closureVals.push(safeReClosure(ctx, pn.pattern))
      lines.push(`if(!_re${ri}.test(_k${ki}))return false`)
    }
  }
  if (pn.const !== undefined) lines.push(`if(_k${ki}!==${JSON.stringify(pn.const)})return false`)
  if (pn.enum) {
    const ei = ctx.varCounter++
    ctx.closureVars.push(`_es${ei}`)
    ctx.closureVals.push(new Set(pn.enum))
    lines.push(`if(!_es${ei}.has(_k${ki}))return false`)
  }
  lines.push(`}}`)
}

function genPrefixItemsNode(schema, v, lines, ctx, knownType, isArr) {
  const pfxVar = ctx.varCounter++
  for (let i = 0; i < schema.prefixItems.length; i++) {
    const elem = `_p${pfxVar}_${i}`
    lines.push(isArr
      ? `if(${v}.length>${i}){const ${elem}=${v}[${i}]`
      : `if(Array.isArray(${v})&&${v}.length>${i}){const ${elem}=${v}[${i}]`)
    genCode(schema.prefixItems[i], elem, lines, ctx)
    lines.push(`}`)
  }
}

function genContainsNode(schema, v, lines, ctx, knownType, isArr) {
  const ci = ctx.varCounter++
  const minC = schema.minContains !== undefined ? schema.minContains : 1
  const maxC = schema.maxContains !== undefined ? schema.maxContains : Infinity
  const subLines = []
  genCode(schema.contains, `_cv`, subLines, ctx)
  const fnBody = subLines.length === 0 ? `return true` : `${subLines.join(';')};return true`
  const guard = isArr ? '' : `if(!Array.isArray(${v})){}else `
  lines.push(`${guard}{const _cf${ci}=function(_cv){${fnBody}};let _cc${ci}=0`)
  lines.push(`for(let _ci${ci}=0;_ci${ci}<${v}.length;_ci${ci}++){if(_cf${ci}(${v}[_ci${ci}]))_cc${ci}++}`)
  if (maxC === Infinity) {
    lines.push(`if(_cc${ci}<${minC})return false}`)
  } else {
    lines.push(`if(_cc${ci}<${minC}||_cc${ci}>${maxC})return false}`)
  }
}

function genAnyOfNode(schema, v, lines, ctx, knownType) {
  const fi = ctx.varCounter++
  const branchBodies = []
  const reused = []
  let canHoist = !!ctx.preamble
  // Branch reuse as in genOneOfNode; anyOf branches take `_av`, so they keep
  // their own map.
  if (canHoist && !ctx.hoistedAny) ctx.hoistedAny = new Map()
  for (let i = 0; i < schema.anyOf.length; i++) {
    const sub = schema.anyOf[i]
    const key = canHoist ? branchKey(sub, ctx) : undefined
    const known = key !== undefined ? ctx.hoistedAny.get(key) : undefined
    if (known !== undefined) {
      reused[i] = known.name
      branchBodies.push(known.body)
      continue
    }
    const subLines = []
    genCode(sub, '_av', subLines, ctx)
    const body = subLines.length === 0 ? 'return true' : `${subLines.join(';')};return true`
    if (/\b_validate\b/.test(body)) canHoist = false
    branchBodies.push(body)
  }
  if (canHoist) {
    const names = branchBodies.map((body, i) => {
      if (reused[i] !== undefined) return reused[i]
      const name = `_af${fi}_b${i}`
      hoist(ctx, `function ${name}(_av){${body}}`)
      const key = branchKey(schema.anyOf[i], ctx)
      if (key !== undefined) ctx.hoistedAny.set(key, { name, body })
      return name
    })
    const checks = names.map(n => `${n}(${v})`).join('||')
    lines.push(`if(!(${checks}))return false`)
  } else {
    const fns = branchBodies.map(body => `function(_av){${body}}`)
    lines.push(`{const _af${fi}=[${fns.join(',')}];let _am${fi}=false;for(let _ai=0;_ai<_af${fi}.length;_ai++){if(_af${fi}[_ai](${v})){_am${fi}=true;break}}if(!_am${fi})return false}`)
  }
}

// What identifies a oneOf branch for reuse: the schema object, or for a branch
// that is only a local $ref beside annotations, the reference itself, since
// `{ $ref: '#/definitions/X' }` is a new object at every place it is written.
// A reference means the same thing everywhere only when no nested $id opens
// another base URI, so that is checked once per compilation.
const SCOPE_KEYS = new Set(['$id', '$defs', 'definitions', '$schema', '$anchor', '$dynamicAnchor'])
function branchKey (sub, ctx) {
  if (typeof sub !== 'object' || sub === null) return undefined
  if (typeof sub.$ref === 'string' && sub.$ref.startsWith('#') &&
      Object.keys(sub).every(k => (REF_NEUTRAL_SIBLINGS.has(k) && !SCOPE_KEYS.has(k)) || k.startsWith('x-'))) {
    if (ctx.refKeysSafe === undefined) ctx.refKeysSafe = !hasNestedIdScope(ctx.rootSchema)
    if (ctx.refKeysSafe) return 'ref:' + sub.$ref
  }
  return sub
}

function genOneOfNode(schema, v, lines, ctx, knownType) {
  const fi = ctx.varCounter++
  const branchBodies = []
  const reused = []
  let canHoist = !!ctx.preamble
  // A branch schema object already emitted as a hoisted function is called
  // again rather than generated again. The same oneOf reached through many
  // $refs was expanded at every one: SchemaStore's Kestra schema, a oneOf of
  // several hundred task types referenced from each task list, produced
  // 86919 branch functions and 197 MB of source, and took seconds to build.
  // A hoisted branch takes its input as a parameter and reads only
  // module-level names, so the same schema object gives the same function.
  if (canHoist && !ctx.hoistedBranch) ctx.hoistedBranch = new Map()
  for (let i = 0; i < schema.oneOf.length; i++) {
    const sub = schema.oneOf[i]
    const key = canHoist ? branchKey(sub, ctx) : undefined
    const known = key !== undefined ? ctx.hoistedBranch.get(key) : undefined
    if (known !== undefined) {
      reused[i] = known.name
      branchBodies.push(known.body)
      continue
    }
    const subLines = []
    genCode(sub, '_ov', subLines, ctx)
    const body = subLines.length === 0 ? 'return true' : `${subLines.join(';')};return true`
    // _validate is the recursive entry — hoisting branches above it breaks scope.
    if (/\b_validate\b/.test(body)) canHoist = false
    branchBodies.push(body)
  }
  if (canHoist) {
    const names = branchBodies.map((body, i) => {
      if (reused[i] !== undefined) return reused[i]
      const name = `_of${fi}_b${i}`
      hoist(ctx, `function ${name}(_ov){${body}}`)
      const key = branchKey(schema.oneOf[i], ctx)
      if (key !== undefined) ctx.hoistedBranch.set(key, { name, body })
      return name
    })
    const calls = names.map(n => `if(${n}(${v})){_oc${fi}++;if(_oc${fi}>1)return false}`).join(';')
    lines.push(`{let _oc${fi}=0;${calls};if(_oc${fi}!==1)return false}`)
  } else {
    const fns = branchBodies.map(body => `function(_ov){${body}}`)
    lines.push(`{const _of${fi}=[${fns.join(',')}];let _oc${fi}=0;for(let _oi=0;_oi<_of${fi}.length;_oi++){if(_of${fi}[_oi](${v}))_oc${fi}++;if(_oc${fi}>1)return false}if(_oc${fi}!==1)return false}`)
  }
}

function genNotNode(schema, v, lines, ctx, knownType) {
  const subLines = []
  genCode(schema.not, '_nv', subLines, ctx)
  if (subLines.length === 0) {
    lines.push(`return false`) // not:{} means nothing is valid
  } else {
    const fi = ctx.varCounter++
    lines.push(`{const _nf${fi}=(function(_nv){${subLines.join(';')};return true});if(_nf${fi}(${v}))return false}`)
  }
}

function genIfNode(schema, v, lines, ctx, knownType) {
  const ifLines = []
  genCode(schema.if, '_iv', ifLines, ctx)
  const fi = ctx.varCounter++
  const ifFn = ifLines.length === 0
    ? `function(_iv){return true}`
    : `function(_iv){${ifLines.join(';')};return true}`

  let thenFn = 'null', elseFn = 'null'
  if (schema.then !== undefined) {
    const thenLines = []
    genCode(schema.then, '_tv', thenLines, ctx)
    thenFn = thenLines.length === 0
      ? `function(_tv){return true}`
      : `function(_tv){${thenLines.join(';')};return true}`
  }
  if (schema.else !== undefined) {
    const elseLines = []
    genCode(schema.else, '_ev', elseLines, ctx)
    elseFn = elseLines.length === 0
      ? `function(_ev){return true}`
      : `function(_ev){${elseLines.join(';')};return true}`
  }
  lines.push(`{const _if${fi}=${ifFn};const _th${fi}=${thenFn};const _el${fi}=${elseFn}`)
  lines.push(`if(_if${fi}(${v})){if(_th${fi}&&!_th${fi}(${v}))return false}else{if(_el${fi}&&!_el${fi}(${v}))return false}}`)
}

function genRefNode(schema, v, lines, ctx, knownType, hasSiblings) {
  // Self-reference "#" — recursive call to root validator
  if (schema.$ref === '#') {
    if (ctx.nestedBoolean) throw DECLINE
    ctx.usesRecursion = true
    lines.push(`if(!_validate(${v}))return false`)
    if (!hasSiblings) return true
  }
  // 1. Local ref
  const m = schema.$ref !== '#' && schema.$ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/)
  if (m && ctx.rootDefs && ctx.rootDefs[m[1]]) {
    const defName = m[1]
    if (!ctx.cyclicDefs) ctx.cyclicDefs = cyclicDefNames(ctx.rootDefs)
    if (ctx.cyclicDefs.has(defName) && ctx.preamble) {
      // A def on a cycle is a named function in the preamble, emitted once
      // and called by name, so recursion terminates the way `$ref: "#"`
      // does at the root. The name is registered before the body is
      // generated so a self-reference inside it becomes a call.
      if (!ctx.defFns) ctx.defFns = new Map()
      let fnName = ctx.defFns.get(defName)
      if (!fnName) {
        fnName = '_def' + ctx.defFns.size + '_' + defName.replace(/[^A-Za-z0-9_]/g, '_')
        ctx.defFns.set(defName, fnName)
        const bodyLines = []
        // The def is compiled as its own function over its own `d`, so the
        // checks _deferOrInline holds back belong at the end of this body.
        // The list hangs off ctx, so without the swap they are flushed into
        // whatever function is compiling, carrying this def's key set.
        const outerDeferred = ctx.deferredChecks
        ctx.deferredChecks = null
        const outerReuse = ctx.plainReuse
        ctx.plainReuse = undefined
        try { genCode(ctx.rootDefs[defName], 'd', bodyLines, ctx) } finally { ctx.plainReuse = outerReuse }
        if (ctx.deferredChecks) for (const dc of ctx.deferredChecks) bodyLines.push(dc)
        ctx.deferredChecks = outerDeferred
        // The def is hoisted above the entry function, where the recursive
        // entry `_validate` is not in scope; a body that calls it (a `$ref: '#'`
        // inside the def) threw a ReferenceError at the first document that
        // reached it. SchemaStore's jsone schema is such a case. Decline, as
        // oneOf and anyOf do not hoist such a branch.
        if (bodyLines.some((l) => /\b_validate\b/.test(l))) throw DECLINE
        // Entered through the cycle guard: see emitGuardState. In the fast
        // pass the wrapper only counts depth; the set is used by the second,
        // guarded pass that runs when data turns out to point back at
        // itself.
        hoist(ctx,
          `const ${fnName}_s=new Set()\n  function ${fnName}(d){\n  ` +
            `if(_sg){if(typeof d!=='object'||d===null)return ${fnName}_b(d);if(${fnName}_s.has(d))return true;${fnName}_s.add(d);try{return ${fnName}_b(d)}finally{${fnName}_s.delete(d)}}\n  ` +
            `if(++_sd>${CYCLE_DEPTH})throw _CYC\n  const _r=${fnName}_b(d)\n  _sd--\n  return _r\n  }\n  ` +
            `function ${fnName}_b(d){${bodyLines.join('\n  ')}\n  return true}`,
        )
      }
      lines.push(`if(!${fnName}(${v}))return false`)
      if (!hasSiblings) return true
    } else if (ctx.shareDefs && !ctx.refStack.has(schema.$ref) && (ctx.sharedDefs || (ctx.sharedDefs = sharedDefNames(ctx.rootSchema, ctx.rootDefs))).has(defName)) {
      // A shared definition off any cycle, as a plain function in the
      // preamble (see compileToJSCodegen): no guard, since it cannot re-enter
      // itself. Generated over its own `d` like the cyclic ones above.
      if (!ctx.sharedDefFns) ctx.sharedDefFns = new Map()
      let fnName = ctx.sharedDefFns.get(defName)
      if (!fnName) {
        fnName = '_dv' + ctx.sharedDefFns.size + '_' + defName.replace(/[^A-Za-z0-9_]/g, '_')
        ctx.sharedDefFns.set(defName, fnName)
        const bodyLines = []
        const outerDeferred = ctx.deferredChecks
        ctx.deferredChecks = null
        ctx.refStack.add(schema.$ref)
        const outerReuse = ctx.plainReuse
        ctx.plainReuse = undefined
        try {
          genCode(ctx.rootDefs[defName], 'd', bodyLines, ctx)
        } finally {
          ctx.refStack.delete(schema.$ref)
          ctx.plainReuse = outerReuse
        }
        if (ctx.deferredChecks) for (const dc of ctx.deferredChecks) bodyLines.push(dc)
        ctx.deferredChecks = outerDeferred
        if (bodyLines.some((l) => /\b_validate\b/.test(l))) throw DECLINE
        hoist(ctx, `function ${fnName}(d){${bodyLines.join('\n  ')}\n  return true}`)
      }
      lines.push(`if(!${fnName}(${v}))return false`)
      if (!hasSiblings) return true
    } else if (ctx.refStack.has(schema.$ref)) { if (ctx.nestedBoolean) throw DECLINE; if (!hasSiblings) return true }
    else {
      ctx.refStack.add(schema.$ref)
      genCode(ctx.rootDefs[defName], v, lines, ctx, knownType)
      ctx.refStack.delete(schema.$ref)
      if (!hasSiblings) return true
    }
  } else if (schema.$ref !== '#' && !m && schema.$ref.startsWith('#') && !schema.$ref.startsWith('#/')) {
    // Anchor ref: "#foo" — resolve via rootDefs or anchors map
    const entry = ctx.rootDefs && ctx.rootDefs[schema.$ref]
    const anchorTarget = entry && entry.raw ? entry.raw : (ctx.anchors && ctx.anchors[schema.$ref])
    if (anchorTarget) {
      if (ctx.refStack.has(schema.$ref)) { if (ctx.nestedBoolean) throw DECLINE; if (!hasSiblings) return true }
      else {
        ctx.refStack.add(schema.$ref)
        genCode(anchorTarget, v, lines, ctx, knownType)
        ctx.refStack.delete(schema.$ref)
        if (!hasSiblings) return true
      }
    }
  } else if (schema.$ref !== '#' && ctx.schemaMap) {
    // 2. Cross-schema ref (exact match, relative URI, or JSON pointer fragment)
    let resolved = ctx.schemaMap.get(schema.$ref)
    if (!resolved && !schema.$ref.includes('://') && !schema.$ref.startsWith('#')) {
      for (const [id, s] of ctx.schemaMap) {
        if (id.endsWith('/' + schema.$ref)) { resolved = s; break }
      }
    }
    if (!resolved && schema.$ref.includes('#') && !schema.$ref.startsWith('#')) {
      const r = resolveCrossSchemaRef(schema.$ref, ctx.schemaMap)
      if (r) resolved = r.schema
    }
    if (resolved) {
      if (ctx.refStack.has(schema.$ref)) { if (!hasSiblings) return true }
      else {
        ctx.refStack.add(schema.$ref)
        genCode(resolved, v, lines, ctx, knownType)
        ctx.refStack.delete(schema.$ref)
        if (!hasSiblings) return true
      }
    } else {
      if (!hasSiblings) return true
    }
  } else {
    if (!hasSiblings) return true
  }
  return false
}

function genPatternPropertiesNode(schema, v, lines, ctx, knownType, isObj) {
  let handledPropertyNames = false
  const ppEntries = Object.entries(schema.patternProperties)
  const pn = isSimplePN(schema.propertyNames) ? schema.propertyNames : null
  const pi = ctx.varCounter++
  const kVar = `_ppk${pi}`

  // Build pattern matchers: prefer charCodeAt for simple prefixes, fall back to regex
  const matchers = []
  for (const [pat] of ppEntries) {
    const fast = fastPrefixCheck(pat, kVar)
    if (fast) {
      matchers.push({ check: fast })
    } else {
      const ri = ctx.varCounter++
      ctx.closureVars.push(`_re${ri}`)
      ctx.closureVals.push(safeReClosure(ctx, pat))
      matchers.push({ check: `_re${ri}.test(${kVar})` })
    }
  }

  // Build sub-schema checks inline so they share the parent helper scope.
  const subChecks = []
  for (let i = 0; i < ppEntries.length; i++) {
    const [, sub] = ppEntries[i]
    const subLines = []
    genCode(sub, `_ppv${pi}`, subLines, ctx)
    subChecks.push(subLines.join(';'))
  }

  const guard = isObj ? '' : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v}))`

  const apSchema = typeof schema.additionalProperties === 'object' && schema.additionalProperties !== null ? schema.additionalProperties : null
  if (schema.additionalProperties === false || apSchema) {
    // Unified loop: properties + patterns + propertyNames + additionalProperties.
    // A key that is neither declared nor matched by any pattern is
    // additional: rejected outright, or run through the additionalProperties
    // schema when there is one.
    handledPropertyNames = !!pn
    const propKeys = Object.keys(schema.properties || {})
    let apCheck = null
    if (apSchema) {
      const apLines = []
      genCode(apSchema, `_apv${pi}`, apLines, ctx)
      apCheck = apLines.join(';')
    }
    lines.push(`${guard}{for(const ${kVar} in ${v}){`)
    // propertyNames checks (merged into same loop)
    if (pn) {
      if (pn.minLength !== undefined) lines.push(`if(${kVar}.length<${pn.minLength})return false`)
      if (pn.maxLength !== undefined) lines.push(`if(${kVar}.length>${pn.maxLength})return false`)
      if (pn.pattern) {
        const fast = fastPrefixCheck(pn.pattern, kVar)
        if (fast) {
          lines.push(`if(!(${fast}))return false`)
        } else {
          const ri = ctx.varCounter++
          ctx.closureVars.push(`_re${ri}`)
          ctx.closureVals.push(safeReClosure(ctx, pn.pattern))
          lines.push(`if(!_re${ri}.test(${kVar}))return false`)
        }
      }
      if (pn.const !== undefined) lines.push(`if(${kVar}!==${JSON.stringify(pn.const)})return false`)
      if (pn.enum) {
        const ei = ctx.varCounter++
        ctx.closureVars.push(`_es${ei}`)
        ctx.closureVals.push(new Set(pn.enum))
        lines.push(`if(!_es${ei}.has(${kVar}))return false`)
      }
    }
    // Every matching pattern applies to every key, declared or not: a
    // declared key that also matches a pattern is validated by both (the
    // properties emitter handles its own subschema). A flag rather than an
    // if/else chain, because a chain returned false at the first pattern
    // that missed and wrongly rejected a key only a later pattern matched.
    if (ppEntries.length > 0) {
      lines.push(`let _pm${pi}=false`)
      for (let i = 0; i < ppEntries.length; i++) {
        lines.push(`if(${matchers[i].check}){_pm${pi}=true;const _ppv${pi}=${v}[${kVar}];${subChecks[i]}}`)
      }
    }
    // A key that is neither declared nor matched is additional. switch on
    // the declared names (V8 compiles string cases to a jump table); no
    // switch at all when nothing is declared, since a switch with no case
    // clause is a syntax error.
    const additional = apCheck !== null ? `const _apv${pi}=${v}[${kVar}];${apCheck}` : `return false`
    const notMatched = ppEntries.length > 0 ? `if(!_pm${pi}){${additional}}` : additional
    if (propKeys.length) {
      const switchCases = propKeys.map(k => `case ${JSON.stringify(k)}:`).join('')
      lines.push(`switch(${kVar}){${switchCases}break;default:{${notMatched}}}`)
    } else {
      lines.push(notMatched)
    }
    lines.push(`}}`)
  } else {
    // No additionalProperties: validate matching keys + propertyNames
    handledPropertyNames = !!pn
    lines.push(`${guard}{for(const ${kVar} in ${v}){`)
    // propertyNames checks (merged)
    if (pn) {
      if (pn.minLength !== undefined) lines.push(`if(${kVar}.length<${pn.minLength})return false`)
      if (pn.maxLength !== undefined) lines.push(`if(${kVar}.length>${pn.maxLength})return false`)
      if (pn.pattern) {
        const fast = fastPrefixCheck(pn.pattern, kVar)
        if (fast) {
          lines.push(`if(!(${fast}))return false`)
        } else {
          const ri = ctx.varCounter++
          ctx.closureVars.push(`_re${ri}`)
          ctx.closureVals.push(safeReClosure(ctx, pn.pattern))
          lines.push(`if(!_re${ri}.test(${kVar}))return false`)
        }
      }
      if (pn.const !== undefined) lines.push(`if(${kVar}!==${JSON.stringify(pn.const)})return false`)
      if (pn.enum) {
        const ei = ctx.varCounter++
        ctx.closureVars.push(`_es${ei}`)
        ctx.closureVals.push(new Set(pn.enum))
        lines.push(`if(!_es${ei}.has(${kVar}))return false`)
      }
    }
    for (let i = 0; i < ppEntries.length; i++) {
      lines.push(`if(${matchers[i].check}){const _ppv${pi}=${v}[${kVar}];${subChecks[i]}}`)
    }
    lines.push(`}}`)
  }
  return handledPropertyNames
}

// Whether the static unevaluatedProperties model checks the anyOf itself, so
// genCodeNode leaves it out. Not when the set is built at run time
// (unevalBuiltAtRuntime): that form only collects, and dropping the anyOf
// there accepted a document no branch matched.
function unevalChecksAnyOf(schema, ctx) {
  if (schema.unevaluatedProperties !== false) return false
  const r = collectEvaluated(schema, ctx.schemaMap, ctx.rootDefs)
  return r.dynamic && !r.allProps && !unevalBuiltAtRuntime(schema, ctx, r)
}

// The unevaluatedProperties forms the static model cannot represent; those
// build the evaluated set at run time (genUnevalDynamicVerdict). Decided in
// one place so genCodeNode and genUnevaluatedPropertiesNode cannot disagree
// about which of them checks the node's anyOf.
function unevalBuiltAtRuntime(schema, ctx, r) {
  if (schema.unevaluatedProperties === true || schema.unevaluatedProperties === undefined) return false
  if (r === undefined) r = collectEvaluated(schema, ctx.schemaMap, ctx.rootDefs)
  return r.dynamic && (r.allProps || !unevalPropsModeled(schema, ctx.schemaMap))
}

function genUnevaluatedPropertiesNode(schema, v, lines, ctx, knownType, isObj, hoisted, earlyKeyCount, nonObjApplicators) {
  const evalResult = collectEvaluated(schema, ctx.schemaMap, ctx.rootDefs)
  if (unevalBuiltAtRuntime(schema, ctx, evalResult)) {
    genUnevalDynamicVerdict(schema, v, lines, ctx, isObj, nonObjApplicators)
    return
  }
  // genCodeNode moved the anyOf and oneOf blocks here only for the run-time
  // form; any other outcome would leave them unwritten.
  if (nonObjApplicators !== null && nonObjApplicators !== undefined) throw DECLINE

  if (evalResult.allProps || schema.unevaluatedProperties === true) {
    // All props evaluated or unevaluatedProperties:true — no-op
  } else if (!evalResult.dynamic) {
    // Tier 1-2: all evaluated props known at compile-time — ZERO COST
    const knownKeys = evalResult.props
    const propCount = knownKeys.length

    if (schema.unevaluatedProperties === false) {
      const allRequired = schema.required && schema.required.length >= propCount &&
        knownKeys.every(k => schema.required.includes(k))

      let inner
      if (allRequired && propCount > 0) {
        // TRICK 1: required covers all — key count check only
        if (!earlyKeyCount) {
          // Adaptive: for-in for <=15 keys, Object.keys for >15
          inner = propCount <= 15
            ? `var _n=0;for(var _k in ${v})_n++;if(_n!==${propCount})return false`
            : `if(Object.keys(${v}).length!==${propCount})return false`
                      _deferOrInline(ctx, lines, v, isObj ? inner : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){${inner}}`)
        }
        // else: already emitted early (before properties)
      } else if (propCount > 0) {
        // TRICK 3: charCodeAt switch tree. Above the lookup threshold it is
        // the additionalProperties quadratic wearing a disguise: keys that
        // share a first character, ENV_0 through ENV_999 say, all land in
        // one case whose body is a chain of every name, per key of the
        // document. The hoisted name lookup is the same cure it was there.
        inner = propCount >= AP_LOOKUP_MIN
          ? apMembershipCheck(ctx, knownKeys, v)
          : genCharCodeSwitch(knownKeys, v)
                  _deferOrInline(ctx, lines, v, isObj ? inner : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){${inner}}`)
      } else {
        inner = `for(var _k in ${v})return false`
                  _deferOrInline(ctx, lines, v, isObj ? inner : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){${inner}}`)
      }
    } else if (typeof schema.unevaluatedProperties === 'object') {
      // unevaluatedProperties: {schema} — validate unknown keys
      const ui = ctx.varCounter++
      const ukVar = `_uk${ui}`
      const subLines = []
      genCode(schema.unevaluatedProperties, `${v}[${ukVar}]`, subLines, ctx)
      if (subLines.length > 0) {
        const check = subLines.join(';')
        let skipKnown = ''
        if (knownKeys.length >= AP_LOOKUP_MIN) {
          const id = emitNameLookup(ctx, knownKeys)
          skipKnown = id !== null ? `if(${id}[${ukVar}]!==undefined)continue;` : `if(${knownKeys.map(k => `${ukVar}===${JSON.stringify(k)}`).join('||')})continue;`
        } else if (knownKeys.length > 0) {
          skipKnown = `if(${knownKeys.map(k => `${ukVar}===${JSON.stringify(k)}`).join('||')})continue;`
        }
        const inner = `for(var ${ukVar} in ${v}){${skipKnown}${check}}`
                  _deferOrInline(ctx, lines, v, isObj ? inner : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){${inner}}`)
      }
    }
  } else {
    // Tier 2.5 / Tier 3: dynamic — runtime tracking needed
    // Compute base props: only unconditionally evaluated (properties, allOf-static, $ref)
    const baseResult = { props: [], items: null, allProps: false, allItems: false, dynamic: false }
    if (schema.properties) {
      for (const k of Object.keys(schema.properties)) {
        if (!baseResult.props.includes(k)) baseResult.props.push(k)
      }
    }
    if (schema.allOf) {
      for (const sub of schema.allOf) {
        const subR = collectEvaluated(sub, ctx.schemaMap, ctx.rootDefs)
        if (!subR.dynamic && subR.props) {
          for (const k of subR.props) {
            if (!baseResult.props.includes(k)) baseResult.props.push(k)
          }
        }
      }
    }
    const baseProps = baseResult.props
    const branchKeyword = schema.anyOf ? 'anyOf' : schema.oneOf ? 'oneOf' : null

    if (schema.unevaluatedProperties === false) {
      if (schema.if && (schema.then || schema.else) && !branchKeyword && !schema.patternProperties && !schema.dependentSchemas) {
        // Tier 2.5: if/then/else — re-emit if function + branch-inline duplication
        // Can't reuse _if from above (block-scoped), so regenerate
        const ifLines2 = []
        genCode(schema.if, '_iv2', ifLines2, ctx)
        const ufi = ctx.varCounter++
        const ifFn2 = ifLines2.length === 0
          ? `function(_iv2){return true}`
          : `function(_iv2){${ifLines2.join(';')};return true}`

        // if props are only evaluated when if matches (spec: failed applicators produce no annotations)
        const ifProps = []
        if (schema.if && schema.if.properties) ifProps.push(...Object.keys(schema.if.properties))
        const thenEval = schema.then ? collectEvaluated(schema.then, ctx.schemaMap, ctx.rootDefs) : { props: [] }
        const elseEval = schema.else ? collectEvaluated(schema.else, ctx.schemaMap, ctx.rootDefs) : { props: [] }
        const uniqueThen = [...new Set([...baseProps, ...ifProps, ...(thenEval.props || [])])]
        const uniqueElse = [...new Set([...baseProps, ...(elseEval.props || [])])]

        const thenCheck = genCharCodeSwitch(uniqueThen, v)
        const elseCheck = genCharCodeSwitch(uniqueElse, v)
        const guard = isObj ? '' : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v}))`
        lines.push(`${guard}{const _uif${ufi}=${ifFn2};if(_uif${ufi}(${v})){${thenCheck}}else{${elseCheck}}}`)
      } else if (branchKeyword) {
        // Tier 3: anyOf/oneOf — runtime tracking
        const branches = schema[branchKeyword]
        const branchProps = []
        for (const sub of branches) {
          const subResult = collectEvaluated(sub, ctx.schemaMap, ctx.rootDefs)
          branchProps.push(subResult.props || [])
        }
        const allDynamicKeys = [...new Set(branchProps.flat())]
        const dynamicOnly = allDynamicKeys.filter(k => !baseProps.includes(k))

        if (dynamicOnly.length > 0 && dynamicOnly.length <= 32) {
          // TRICK 5: bit-packed evaluated set — SINGLE PASS (validation + tracking combined)
          const ei = ctx.varCounter++
          const evVar = `_ev${ei}`
          const bitMap = new Map()
          dynamicOnly.forEach((k, i) => bitMap.set(k, i))
          const branchMasks = branchProps.map(props => {
            let mask = 0
            for (const p of props) {
              if (bitMap.has(p)) mask |= (1 << bitMap.get(p))
            }
            return mask
          })

          // TRICK 4: Direct function calls — no array, no loop, V8 can inline
          const bfi = ctx.varCounter++
          lines.push(`{let ${evVar}=0`)
          const fnVars = []
          for (let i = 0; i < branches.length; i++) {
            const subLines2 = []
            genCode(branches[i], '_bv', subLines2, ctx)
            const fnVar = `_bf${bfi}_${i}`
            fnVars.push(fnVar)
            const fnBody = subLines2.length === 0 ? `function(_bv){return true}` : `function(_bv){${subLines2.join(';')};return true}`
            lines.push(`const ${fnVar}=${fnBody}`)
          }
          if (branchKeyword === 'oneOf') {
            // oneOf: exactly one must match — direct calls
            lines.push(`let _oc${bfi}=0`)
            for (let i = 0; i < branches.length; i++) {
              lines.push(`if(${fnVars[i]}(${v})){_oc${bfi}++;${evVar}=${branchMasks[i]};if(_oc${bfi}>1)return false}`)
            }
            lines.push(`if(_oc${bfi}!==1)return false`)
          } else {
            // anyOf: at least one must match — direct calls, collect all
            lines.push(`let _am${bfi}=false`)
            for (let i = 0; i < branches.length; i++) {
              lines.push(`if(${fnVars[i]}(${v})){_am${bfi}=true;${evVar}|=${branchMasks[i]}}`)
            }
            lines.push(`if(!_am${bfi})return false`)
          }

          // Final check: static keys inline + dynamic keys via bitmask
          const staticCheck = baseProps.length > 0 ? baseProps.map(k => `_k===${JSON.stringify(k)}`).join('||') : ''
          const groups = new Map()
          for (const k of dynamicOnly) {
            const cc = k.charCodeAt(0)
            if (!groups.has(cc)) groups.set(cc, [])
            groups.get(cc).push(k)
          }
          let switchCases = ''
          for (const [cc, groupKeys] of groups) {
            const cond = groupKeys.map(k => `_k===${JSON.stringify(k)}&&(${evVar}&${1 << bitMap.get(k)})`).join('||')
            switchCases += `case ${cc}:if(${cond})continue;break;`
          }
          const dynamicCheck = `switch(_k.charCodeAt(0)){${switchCases}default:break}`
          const inner = staticCheck
            ? `for(var _k in ${v}){if(${staticCheck})continue;${dynamicCheck}return false}`
            : `for(var _k in ${v}){${dynamicCheck}return false}`
                      _deferOrInline(ctx, lines, v, isObj ? inner + '}' : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){${inner}}}`)
        } else {
          // Fallback: plain object tracking
          const ei = ctx.varCounter++
          const evVar = `_ev${ei}`
          const fns = []
          for (let i = 0; i < branches.length; i++) {
            const subLines2 = []
            genCode(branches[i], '_bv', subLines2, ctx)
            fns.push(subLines2.length === 0 ? `function(_bv){return true}` : `function(_bv){${subLines2.join(';')};return true}`)
          }
          const bfi = ctx.varCounter++
          ctx.closureVars.push(`_bk${bfi}`)
          ctx.closureVals.push(branchProps)
          lines.push(`{const ${evVar}={}`)
          for (const k of baseProps) lines.push(`${evVar}[${JSON.stringify(k)}]=1`)
          lines.push(`const _bf${bfi}=[${fns.join(',')}]`)
          if (branchKeyword === 'oneOf') {
            // Single pass: validate oneOf (exactly one) + track evaluated
            lines.push(`let _oc${bfi}=0;for(let _bi=0;_bi<_bf${bfi}.length;_bi++){if(_bf${bfi}[_bi](${v})){_oc${bfi}++;for(const _p of _bk${bfi}[_bi])${evVar}[_p]=1;if(_oc${bfi}>1)return false}}if(_oc${bfi}!==1)return false`)
          } else {
            // Single pass: validate anyOf (at least one) + track all matching
            lines.push(`let _am${bfi}=false;for(let _bi=0;_bi<_bf${bfi}.length;_bi++){if(_bf${bfi}[_bi](${v})){_am${bfi}=true;for(const _p of _bk${bfi}[_bi])${evVar}[_p]=1}}if(!_am${bfi})return false`)
          }
          const inner = `for(var _k in ${v}){if(!${evVar}[_k])return false}`
                      _deferOrInline(ctx, lines, v, isObj ? inner + '}' : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){${inner}}}`)
        }
      } else if (schema.dependentSchemas) {
        // dependentSchemas: conditional merge at runtime
        const ei = ctx.varCounter++
        const evVar = `_ev${ei}`
        lines.push(`{const ${evVar}={}`)
        for (const k of baseProps) lines.push(`${evVar}[${JSON.stringify(k)}]=1`)
        for (const [trigger, depSchema] of Object.entries(schema.dependentSchemas)) {
          const depResult = collectEvaluated(depSchema, ctx.schemaMap, ctx.rootDefs)
          if (depResult.props && depResult.props.length > 0) {
            lines.push(`if(${ownKeyExpr(ctx, v, trigger)}){${depResult.props.map(k => `${evVar}[${JSON.stringify(k)}]=1`).join(';')}}`)
          }
        }
        const inner = `for(var _k in ${v}){if(!${evVar}[_k])return false}`
                  _deferOrInline(ctx, lines, v, isObj ? inner + '}' : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){${inner}}}`)
      } else {
        // General fallback: collect all patternProperties from root + allOf sub-schemas + if
        // and use runtime regex matching
        const allPatterns = []
        if (schema.patternProperties) {
          allPatterns.push(...Object.keys(schema.patternProperties))
        }
        if (schema.allOf) {
          for (const sub of schema.allOf) {
            if (sub && sub.patternProperties) {
              allPatterns.push(...Object.keys(sub.patternProperties))
            }
          }
        }
        // lone if (no then/else) still contributes annotations when it passes
        if (schema.if && !schema.then && !schema.else && schema.if.patternProperties) {
          allPatterns.push(...Object.keys(schema.if.patternProperties))
        }
        if (allPatterns.length > 0) {
          const ei = ctx.varCounter++
          const evVar = `_ev${ei}`
          lines.push(`{const ${evVar}={}`)
          for (const k of baseProps) lines.push(`${evVar}[${JSON.stringify(k)}]=1`)
          const reVars = []
          for (const pat of allPatterns) {
            const ri = ctx.varCounter++
            ctx.closureVars.push(`_ure${ri}`)
            ctx.closureVals.push(safeReClosure(ctx, pat))
            reVars.push(`_ure${ri}`)
          }
          if (schema.if && !schema.then && !schema.else) {
            // Lone if: run the if check first; if it passes, its patternProperties contribute
            const ifLines2 = []
            genCode(schema.if, '_iv2', ifLines2, ctx)
            const ufi = ctx.varCounter++
            const ifFn = ifLines2.length === 0
              ? `function(_iv2){return true}`
              : `function(_iv2){${ifLines2.join(';')};return true}`
            // Mark keys matching if's patterns as evaluated only when if passes
            const ifPatterns = schema.if.patternProperties ? Object.keys(schema.if.patternProperties) : []
            const ifReVars = []
            for (const pat of ifPatterns) {
              const ri = ctx.varCounter++
              ctx.closureVars.push(`_ure${ri}`)
              ctx.closureVals.push(safeReClosure(ctx, pat))
              ifReVars.push(`_ure${ri}`)
            }
            const rootReVars = []
            if (schema.patternProperties) {
              for (const pat of Object.keys(schema.patternProperties)) {
                const ri = ctx.varCounter++
                ctx.closureVars.push(`_ure${ri}`)
                ctx.closureVals.push(safeReClosure(ctx, pat))
                rootReVars.push(`_ure${ri}`)
              }
            }
            const rootPatCheck = rootReVars.map(rv => `if(${rv}.test(_k))continue;`).join('')
            const ifPatCheck = ifReVars.map(rv => `if(${rv}.test(_k))continue;`).join('')
            const inner = `const _uif${ufi}=${ifFn};if(_uif${ufi}(${v})){for(var _k in ${v}){if(${evVar}[_k])continue;${rootPatCheck}${ifPatCheck}return false}}else{for(var _k in ${v}){if(${evVar}[_k])continue;${rootPatCheck}return false}}`
                          _deferOrInline(ctx, lines, v, isObj ? inner + '}' : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){${inner}}}`)
          } else {
            const inner = `for(var _k in ${v}){if(${evVar}[_k])continue;${reVars.map(rv => `if(${rv}.test(_k)){${evVar}[_k]=1;continue}`).join('')}return false}`
                          _deferOrInline(ctx, lines, v, isObj ? inner + '}' : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){${inner}}}`)
          }
        } else {
          // Nothing dynamic contributes a name (a lone if with no properties
          // or patterns, say): only the fixed names are evaluated. This branch
          // used to emit nothing, and nothing read as valid.
          const ei = ctx.varCounter++
          const evVar = `_ev${ei}`
          lines.push(`{const ${evVar}={}`)
          for (const k of baseProps) lines.push(`${evVar}[${JSON.stringify(k)}]=1`)
          const inner = `for(var _k in ${v}){if(!${evVar}[_k])return false}`
          _deferOrInline(ctx, lines, v, isObj ? inner + '}' : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){${inner}}}`)
        }
      }
    } else if (typeof schema.unevaluatedProperties === 'object') {
      // Tier 3 with schema: validate unknown keys against sub-schema
      const ei = ctx.varCounter++
      const evVar = `_ev${ei}`
      const ukVar = `_uk${ei}`
      lines.push(`{const ${evVar}={}`)
      for (const k of baseProps) lines.push(`${evVar}[${JSON.stringify(k)}]=1`)

      if (branchKeyword) {
        const branches = schema[branchKeyword]
        const branchProps = []
        for (const sub of branches) {
          const subResult = collectEvaluated(sub, ctx.schemaMap, ctx.rootDefs)
          branchProps.push(subResult.props || [])
        }
        const fns = []
        for (let i = 0; i < branches.length; i++) {
          const subLines2 = []
          genCode(branches[i], '_bv', subLines2, ctx)
          fns.push(subLines2.length === 0 ? `function(_bv){return true}` : `function(_bv){${subLines2.join(';')};return true}`)
        }
        const bfi = ctx.varCounter++
        ctx.closureVars.push(`_bk${bfi}`)
        ctx.closureVals.push(branchProps)
        lines.push(`const _bf${bfi}=[${fns.join(',')}]`)
        if (branchKeyword === 'oneOf') {
          lines.push(`for(let _bi=0;_bi<_bf${bfi}.length;_bi++){if(_bf${bfi}[_bi](${v})){for(const _p of _bk${bfi}[_bi])${evVar}[_p]=1;break}}`)
        } else {
          lines.push(`for(let _bi=0;_bi<_bf${bfi}.length;_bi++){if(_bf${bfi}[_bi](${v})){for(const _p of _bk${bfi}[_bi])${evVar}[_p]=1}}`)
        }
      }

      const subLines2 = []
      genCode(schema.unevaluatedProperties, `${v}[${ukVar}]`, subLines2, ctx)
      if (subLines2.length > 0) {
        const check = subLines2.join(';')
        const inner = `for(var ${ukVar} in ${v}){if(${evVar}[${ukVar}])continue;${check}}`
                  _deferOrInline(ctx, lines, v, isObj ? inner + '}' : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){${inner}}}`)
      } else {
        lines.push('}')
      }
    }
  }
}

function genUnevaluatedItemsNode(schema, v, lines, ctx, knownType, isArr) {
  const evalResult = collectEvaluated(schema, ctx.schemaMap, ctx.rootDefs)

  // Check if allItems from anyOf/oneOf branches with `items` keyword needs dynamic tracking
  const branchKw = schema.anyOf ? 'anyOf' : schema.oneOf ? 'oneOf' : null
  const hasConditionalItems = evalResult.allItems && evalResult.dynamic && branchKw &&
    schema[branchKw].some(sub => sub && typeof sub === 'object' && ((sub.items && typeof sub.items === 'object') || sub.items === true))

  if (schema.unevaluatedItems === true || (evalResult.allItems && !hasConditionalItems)) {
    // All items evaluated or unevaluatedItems:true — no-op
  } else if (!evalResult.dynamic) {
    // Static: all evaluated items known at compile-time
    if (schema.unevaluatedItems === false) {
      // TRICK 6: Array.length comparison only
      const maxIdx = evalResult.items || 0
      const inner = `if(${v}.length>${maxIdx})return false`
              _deferOrInline(ctx, lines, v, isArr ? inner : `if(Array.isArray(${v})){${inner}}`)
    } else if (typeof schema.unevaluatedItems === 'object') {
      const maxIdx = evalResult.items || 0
      const ui = ctx.varCounter++
      const elemVar = `_ue${ui}`
      const idxVar = `_ui${ui}`
      const subLines = []
      genCode(schema.unevaluatedItems, elemVar, subLines, ctx)
      if (subLines.length > 0) {
        const check = subLines.join(';')
        const inner = `for(let ${idxVar}=${maxIdx};${idxVar}<${v}.length;${idxVar}++){const ${elemVar}=${v}[${idxVar}];${check}}`
                  _deferOrInline(ctx, lines, v, isArr ? inner : `if(Array.isArray(${v})){${inner}}`)
      }
    }
  } else {
    // Dynamic: runtime tracking of max evaluated index
    // Compute baseIdx from unconditional sources only (root prefixItems/items, allOf)
    let baseIdx = 0
    if (schema.prefixItems) baseIdx = Math.max(baseIdx, schema.prefixItems.length)
    if (schema.items && typeof schema.items === 'object') baseIdx = Infinity // items: schema → all evaluated
    if (schema.allOf) {
      for (const sub of schema.allOf) {
        const subR = collectEvaluated(sub, ctx.schemaMap, ctx.rootDefs)
        if (subR.items !== null) baseIdx = Math.max(baseIdx, subR.items)
        if (subR.allItems) baseIdx = Infinity
      }
    }
    if (baseIdx === Infinity) baseIdx = 0 // allItems already handled above
    const branchKeyword = schema.anyOf ? 'anyOf' : schema.oneOf ? 'oneOf' : null

    if (branchKeyword && (schema.unevaluatedItems === false || typeof schema.unevaluatedItems === 'object')) {
      // anyOf/oneOf: each branch may evaluate different number of items
      const branches = schema[branchKeyword]
      const branchMaxIdx = []
      const branchAllItems = []
      for (const sub of branches) {
        const subR = collectEvaluated(sub, ctx.schemaMap, ctx.rootDefs)
        branchMaxIdx.push(subR.items || 0)
        branchAllItems.push(subR.allItems)
      }
      // Runtime: find max evaluated index across all matching branches
      const fns = []
      for (let i = 0; i < branches.length; i++) {
        const subLines2 = []
        genCode(branches[i], '_bv', subLines2, ctx)
        fns.push(subLines2.length === 0 ? `function(_bv){return true}` : `function(_bv){${subLines2.join(';')};return true}`)
      }
      const bfi = ctx.varCounter++
      const ei = ctx.varCounter++
      const evVar = `_eidx${ei}`
      lines.push(`{let ${evVar}=${baseIdx}`)
      lines.push(`const _bf${bfi}=[${fns.join(',')}]`)
      const maxExprs = branchMaxIdx.map((m, i) => {
        if (branchAllItems[i]) return `_bi===${i}?${v}.length`
        return `_bi===${i}?${Math.max(m, baseIdx)}`
      }).join(':') + `:${baseIdx}`
      if (branchKeyword === 'oneOf') {
        lines.push(`for(let _bi=0;_bi<_bf${bfi}.length;_bi++){if(_bf${bfi}[_bi](${v})){${evVar}=${maxExprs};break}}`)
      } else {
        lines.push(`for(let _bi=0;_bi<_bf${bfi}.length;_bi++){if(_bf${bfi}[_bi](${v})){const _m=${maxExprs};if(_m>${evVar})${evVar}=_m}}`)
      }
      if (schema.unevaluatedItems === false) {
        const inner = `if(${v}.length>${evVar})return false`
                  _deferOrInline(ctx, lines, v, isArr ? inner + '}' : `if(Array.isArray(${v})){${inner}}}`)
      } else {
        const ui = ctx.varCounter++
        const elemVar = `_ue${ui}`
        const idxVar = `_ui${ui}`
        const subLines = []
        genCode(schema.unevaluatedItems, elemVar, subLines, ctx)
        if (subLines.length > 0) {
          const check = subLines.join(';')
          const inner = `for(let ${idxVar}=${evVar};${idxVar}<${v}.length;${idxVar}++){const ${elemVar}=${v}[${idxVar}];${check}}`
                      _deferOrInline(ctx, lines, v, isArr ? inner + '}' : `if(Array.isArray(${v})){${inner}}}`)
        } else {
          lines.push('}')
        }
      }
    } else if (schema.if && (schema.unevaluatedItems === false || typeof schema.unevaluatedItems === 'object')) {
      // if/then/else (or lone if): branch-specific max index
      const ifEval = collectEvaluated(schema.if, ctx.schemaMap, ctx.rootDefs)
      const thenEval = schema.then ? collectEvaluated(schema.then, ctx.schemaMap, ctx.rootDefs) : { items: null }
      const elseEval = schema.else ? collectEvaluated(schema.else, ctx.schemaMap, ctx.rootDefs) : { items: null }
      const ifIdx = ifEval.items || 0
      const thenIdx = Math.max(baseIdx, ifIdx, thenEval.items || 0)
      const elseIdx = Math.max(baseIdx, elseEval.items || 0)

      const ifLines2 = []
      genCode(schema.if, '_iv3', ifLines2, ctx)
      const ufi = ctx.varCounter++
      const ifFn3 = ifLines2.length === 0
        ? `function(_iv3){return true}`
        : `function(_iv3){${ifLines2.join(';')};return true}`

      if (schema.unevaluatedItems === false) {
        const guard = isArr ? '' : `if(Array.isArray(${v}))`
        lines.push(`${guard}{const _uif${ufi}=${ifFn3};if(_uif${ufi}(${v})){if(${v}.length>${thenIdx})return false}else{if(${v}.length>${elseIdx})return false}}`)
      }
    } else if ((schema.contains || (schema.allOf && schema.allOf.some(s => s && s.contains))) && (schema.unevaluatedItems === false || typeof schema.unevaluatedItems === 'object')) {
      // contains + unevaluatedItems: per-item tracking of which items are matched by contains
      // Collect contains from root and allOf sub-schemas
      const allContains = []
      if (schema.contains) allContains.push(schema.contains)
      if (schema.allOf) {
        for (const sub of schema.allOf) {
          if (sub && sub.contains) allContains.push(sub.contains)
        }
      }
      const ci = ctx.varCounter++
      const evArr = `_cev${ci}`
      const containsFns = []
      for (const c of allContains) {
        const cLines = []
        genCode(c, '_cv', cLines, ctx)
        containsFns.push(cLines.length === 0
          ? `function(_cv){return true}`
          : `function(_cv){${cLines.join(';')};return true}`)
      }
      const cfnArr = `_cfn${ci}`
      lines.push(`{const ${cfnArr}=[${containsFns.join(',')}]`)
      // Mark items evaluated by prefixItems
      lines.push(`const ${evArr}=[]`)
      if (baseIdx > 0) {
        lines.push(`for(let _i=0;_i<${Math.min(baseIdx, 1000)};_i++)${evArr}[_i]=true`)
      }
      // Mark items matched by each contains function
      lines.push(`if(Array.isArray(${v})){for(let _ci=0;_ci<${v}.length;_ci++){for(let _cj=0;_cj<${cfnArr}.length;_cj++){if(${cfnArr}[_cj](${v}[_ci])){${evArr}[_ci]=true;break}}}}`)
      if (schema.unevaluatedItems === false) {
        const inner = `if(Array.isArray(${v})){for(let _ci=0;_ci<${v}.length;_ci++){if(!${evArr}[_ci])return false}}`
                  _deferOrInline(ctx, lines, v, inner + '}')
      } else {
        // unevaluatedItems: {schema}
        const ui = ctx.varCounter++
        const elemVar = `_ue${ui}`
        const subLines = []
        genCode(schema.unevaluatedItems, elemVar, subLines, ctx)
        if (subLines.length > 0) {
          const check = subLines.join(';')
          const inner = `if(Array.isArray(${v})){for(let _ci=0;_ci<${v}.length;_ci++){if(!${evArr}[_ci]){const ${elemVar}=${v}[_ci];${check}}}}`
                      _deferOrInline(ctx, lines, v, inner + '}')
        } else {
          lines.push('}')
        }
      }
    } else if (schema.unevaluatedItems === false) {
      // Fallback: use static base index (may not be fully correct for all dynamic cases)
      const maxIdx = evalResult.items || 0
      const inner = `if(${v}.length>${maxIdx})return false`
              _deferOrInline(ctx, lines, v, isArr ? inner : `if(Array.isArray(${v})){${inner}}`)
    }
  }
}

// Formats whose check is large enough that repeating it at every call site
// costs more than the call. They are hoisted once per compiled function and
// invoked by name: one real schema with four email fields grew by 20 KB when
// the check was inlined at each of them.
const EMAIL_HELPER = `function _em(_s){${_formats.emailSource('_s', true)}return true}`

// `uri` is the most expensive format an ordinary document carries: a schema
// with a handful of URL fields spent more time here than on every structural
// check put together. The walk reads its character classes out of hoisted
// tables, so it is declared once per compiled function rather than inlined at
// each call site, where the tables would have to be rebuilt.
const URI_HELPER = _formats.uriHelperSource('_uri')

const FORMAT_CODEGEN = {
  email: (v, isStr, ctx) => {
    if (!ctx) return _formats.emailSource(v, isStr)
    hoistOnce(ctx, '_emHoisted', EMAIL_HELPER)
    return isStr ? `if(!_em(${v}))return false` : `if(typeof ${v}==='string'&&!_em(${v}))return false`
  },
  'json-pointer': _formats.jsonPointerSource,
  'relative-json-pointer': _formats.relativeJsonPointerSource,
  'uri-template': _formats.uriTemplateSource,
  iri: _formats.iriSource,
  'iri-reference': _formats.iriReferenceSource,
  'idn-email': _formats.idnEmailSource,
  regex: (v, isStr) => {
    const inner = `try{new RegExp(${v},'u')}catch(_er){return false}`
    return isStr ? `{${inner}}` : `if(typeof ${v}==='string'){${inner}}`
  },
  date: _formats.dateSource,
  uuid: _formats.uuidSource,
  'date-time': _formats.dateTimeSource,
  time: _formats.timeSource,
  duration: _formats.durationSource,
  uri: (v, isStr, ctx) => {
    if (!ctx) return _formats.uriSource(v, isStr)
    hoistOnce(ctx, '_uriHoisted', URI_HELPER)
    return isStr ? `if(!_uri(${v}))return false` : `if(typeof ${v}==='string'&&!_uri(${v}))return false`
  },
  'uri-reference': (v, isStr) => isStr
    ? `{${_formats.uriCharsSource(v, '0')}}`
    : `if(typeof ${v}==='string'){${_formats.uriCharsSource(v, '0')}}`,
  ipv4: (v, isStr, ctx) => {
    if (!ctx) return _formats.ipv4Source(v, isStr)
    // Hoisted: a regex literal in the body would build a new RegExp per call.
    hoistOnce(ctx, '_ip4Hoisted', 'const _ip4=/' + _formats.IPV4.source + '/')
    return isStr ? `if(!_ip4.test(${v}))return false` : `if(typeof ${v}==='string'&&!_ip4.test(${v}))return false`
  },
  ipv6: (v, isStr, ctx) => {
    if (!ctx) return _formats.ipv6Source(v, isStr)
    hoistOnce(ctx, '_ip6Hoisted', 'const _ip6f=/' + _formats.IPV6_FULL.source + '/')
    // The fast accept jumps past the walk; the walk's `return false`s are what
    // the error generators rewrite, so they stay as they are.
    const body = `_ip6:{if(${v}.length>=15&&_ip6f.test(${v}))break _ip6;${_formats.ipv6Source(v, true).replace(/^\{|\}$/g, '')}}`
    return isStr ? body : `if(typeof ${v}==='string'){${body}}`
  },
  hostname: _formats.hostnameSource,
}

// Safe key escaping: use JSON.stringify to handle all special chars (newlines, null bytes, etc.)
// A schema string as the body of a JavaScript string literal, single- or
// double-quoted. JSON.stringify escapes the double quote and the backslash;
// the single quote needs its own escape, because the error emitters put these
// in '...' literals. Without it a property name holding a quote closed the
// literal, and the rest of the name ran as code in the generated validator.
function esc(s) { return JSON.stringify(s).slice(1, -1).replace(/'/g, "\\'") }
// A schema pointer segment for a pattern: JSON Pointer escaping, then made
// safe for the single-quoted literal the error emitters use.
// A pointer segment as text for a single-quoted literal. Control characters
// and the two line separators go in as \u escapes: written raw, a property
// named "foo\nbar" broke the literal, the combined function failed to compile
// and every schema with such a name lost it.
function ptrSeg(s) { return s.replace(/~/g, '~0').replace(/\//g, '~1').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/[\u0000-\u001f\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0')) }

// Resolve child path at codegen time when parent is a static string literal.
// This enables frozen pre-allocation for ALL nested error objects.
function childPathExpr(parentExpr, suffix) {
  if (!parentExpr) return `'/${suffix}'`
  if (parentExpr.startsWith("'") && !parentExpr.includes('+')) {
    // Static parent: resolve at codegen time → '/parent/child' (single literal)
    return `'${parentExpr.slice(1, -1)}/${suffix}'`
  }
  // Dynamic parent: keep as concat expression
  return `${parentExpr}+'/${suffix}'`
}

// Compile simple regex patterns to inline charCode checks — avoids RegExp engine overhead.
// Returns null if pattern is too complex for inline compilation.
// Handles: ^[charclass]{n}$, ^[charclass]+$, ^[charclass]*$, ^[charclass]{m,n}$
function compilePatternInline(pattern, varName) {
  // Match: ^[chars]{exact}$ — e.g., ^[0-9]{5}$
  let m = pattern.match(/^\^(\[[\w\-]+\])\{(\d+)\}\$$/)
  if (m) {
    const len = parseInt(m[2])
    // For small fixed-length patterns, fully unroll: avoids the per-call closure
    // allocation of the IIFE form. Cap at 16 chars to keep emitted code small.
    if (len <= 16) {
      const checks = []
      for (let i = 0; i < len; i++) {
        const ck = charClassToCheck(m[1], `${varName}.charCodeAt(${i})`)
        if (!ck) return null
        checks.push(ck)
      }
      return `${varName}.length===${len}&&${checks.join('&&')}`
    }
    const rangeCheck = charClassToCheck(m[1], `${varName}.charCodeAt(_pi)`)
    if (!rangeCheck) return null
    return `${varName}.length===${len}&&(()=>{for(let _pi=0;_pi<${len};_pi++){if(!(${rangeCheck}))return false}return true})()`
  }
  // Match: ^[chars]+$ — e.g., ^[a-z]+$
  m = pattern.match(/^\^(\[[\w\-]+\])\+\$$/)
  if (m) {
    const rangeCheck = charClassToCheck(m[1], `${varName}.charCodeAt(_pi)`)
    if (!rangeCheck) return null
    return `${varName}.length>0&&(()=>{for(let _pi=0;_pi<${varName}.length;_pi++){if(!(${rangeCheck}))return false}return true})()`
  }
  // Match: ^[chars]{m,n}$ — e.g., ^[a-zA-Z]{2,50}$
  m = pattern.match(/^\^(\[[\w\-]+\])\{(\d+),(\d+)\}\$$/)
  if (m) {
    const rangeCheck = charClassToCheck(m[1], `${varName}.charCodeAt(_pi)`)
    if (!rangeCheck) return null
    const min = parseInt(m[2]), max = parseInt(m[3])
    return `${varName}.length>=${min}&&${varName}.length<=${max}&&(()=>{for(let _pi=0;_pi<${varName}.length;_pi++){if(!(${rangeCheck}))return false}return true})()`
  }
  return fixedSequenceInline(pattern, varName)
}

// A pattern that matches exactly one fixed-length sequence of single
// characters, such as `^[A-Z]{3}-\d{4}$` for a SKU or `^\d{3}-\d{4}$` for a
// code, unrolled into one character test per position. Each piece is a class
// of letters, digits, `_` and `-`, a `\d`, or a literal character, repeated a
// fixed number of times; anything else, including every variable-length
// quantifier and any negated or escaped class, returns null and keeps the
// regular path. Each piece matches exactly one UTF-16 unit in the ASCII range,
// so comparing the length and each code unit is the same test the regex
// makes. Such patterns went through the safe-regex matcher, which is
// linear but slower than both this and the native engine: a quarter of the
// time of an order body with one SKU per line item.
const FIXED_LITERAL = /[A-Za-z0-9 _\-:@#%&=,;'"<>!~`\/]/
function fixedSequenceInline(pattern, varName) {
  if (pattern.length < 3 || pattern[0] !== '^' || pattern[pattern.length - 1] !== '$' || pattern[pattern.length - 2] === '\\') return null
  const end = pattern.length - 1
  const pieces = []
  let i = 1
  while (i < end) {
    let piece
    const c = pattern[i]
    if (c === '[') {
      const j = pattern.indexOf(']', i)
      if (j < 0 || j >= end) return null
      const cls = pattern.slice(i, j + 1)
      if (!/^\[[\w-]+\]$/.test(cls)) return null
      piece = { cls }
      i = j + 1
    } else if (c === '\\') {
      const e = pattern[i + 1]
      if (e === 'd') piece = { cls: '[0-9]' }
      // Only the escapes that stay valid under the u flag: an escaped `-`
      // outside a class is a syntax error there, and the regex path is the
      // one that decides what to do about it.
      else if (e !== undefined && './()[]{}+*?^$|\\'.includes(e)) piece = { lit: e }
      else return null
      i += 2
    } else if (FIXED_LITERAL.test(c)) {
      piece = { lit: c }
      i += 1
    } else {
      return null
    }
    let count = 1
    if (pattern[i] === '{') {
      const q = /^\{(\d+)\}/.exec(pattern.slice(i))
      if (!q) return null
      count = Number(q[1])
      i += q[0].length
    } else if (i < end && '*+?'.includes(pattern[i])) {
      return null
    }
    for (let k = 0; k < count; k++) pieces.push(piece)
    if (pieces.length > 32) return null
  }
  if (pieces.length === 0) return null
  const checks = []
  for (let k = 0; k < pieces.length; k++) {
    const at = `${varName}.charCodeAt(${k})`
    if (pieces[k].lit !== undefined) checks.push(`${at}===${pieces[k].lit.charCodeAt(0)}`)
    else {
      const ck = charClassToCheck(pieces[k].cls, at)
      if (!ck) return null
      checks.push(`(${ck})`)
    }
  }
  return `${varName}.length===${pieces.length}&&${checks.join('&&')}`
}

// Convert [charclass] to charCode range check expression.
// Supports: [0-9], [a-z], [A-Z], [a-zA-Z], [a-zA-Z0-9], [0-9a-f], etc.
function charClassToCheck(charClass, codeExpr) {
  // Strip brackets
  const inner = charClass.slice(1, -1)
  // Parse ranges
  const ranges = []
  let i = 0
  while (i < inner.length) {
    if (i + 2 < inner.length && inner[i + 1] === '-') {
      ranges.push([inner.charCodeAt(i), inner.charCodeAt(i + 2)])
      i += 3
    } else {
      ranges.push([inner.charCodeAt(i), inner.charCodeAt(i)])
      i++
    }
  }
  if (ranges.length === 0) return null
  // Generate check: (c >= 48 && c <= 57) || (c >= 65 && c <= 90)
  const checks = ranges.map(([lo, hi]) =>
    lo === hi ? `${codeExpr}===${lo}` : `(${codeExpr}>=${lo}&&${codeExpr}<=${hi})`
  )
  // Parenthesised as a whole: the unrolled form joins one of these per
  // position with &&, and a bare a||b there bound as (len&&a)||(b&&...), so
  // ^[A-Za-z]{2}$ accepted "xyz" and "1a" from 0.12.1 on.
  return `(${checks.join('||')})`
}

// Same but for dynamic segments (array indices)
function childPathDynExpr(parentExpr, indexExpr) {
  if (!parentExpr) return `'/'+${indexExpr}`
  return `${parentExpr}+'/'+${indexExpr}`
}

// unevaluated* differs from additionalProperties/items only through
// annotations contributed by in-place applicators at the same schema object.
// When every applicator subschema is provably free of the annotating keywords
// for that kind, the keyword is exactly its plain counterpart, and the error
// generators can emit real detail for it instead of declining. `required`
// inside a then-branch annotates nothing, which is precisely the shape a
// config schema has; a then-branch carrying `properties` does, and stays
// declined. `not` never keeps its annotations, so it is skipped. A reference
// or dependency keyword makes the node ineligible outright: resolving what
// they might contribute is not this function's job.
// Collects what an in-place applicator subschema can contribute: property
// names into `names`, and the deepest tuple prefix it may evaluate into
// `state.prefix`. Returns false when the contribution cannot be bounded
// (patternProperties, additionalProperties, a reference, item schemas, and so
// on), which makes the node ineligible outright.
function unevalContributions (sub, kind, names, state, depth) {
  if (depth > 24) return false
  if (sub === true || sub === false) return true
  if (typeof sub !== 'object' || sub === null) return false
  if (kind === 'props') {
    if (sub.patternProperties !== undefined || sub.additionalProperties !== undefined || sub.unevaluatedProperties !== undefined) return false
    if (sub.properties !== undefined) {
      if (typeof sub.properties !== 'object' || sub.properties === null) return false
      for (const k of Object.keys(sub.properties)) names.add(k)
    }
  } else {
    if (sub.items !== undefined || sub.additionalItems !== undefined || sub.contains !== undefined || sub.unevaluatedItems !== undefined) return false
    if (sub.prefixItems !== undefined) {
      if (!Array.isArray(sub.prefixItems)) return false
      if (sub.prefixItems.length > state.prefix) state.prefix = sub.prefixItems.length
    }
  }
  if (sub.$ref !== undefined || sub.$dynamicRef !== undefined || sub.$recursiveRef !== undefined) return false
  if (sub.dependentSchemas !== undefined || sub.dependencies !== undefined) return false
  for (const k of ['allOf', 'anyOf', 'oneOf']) {
    if (sub[k] !== undefined) {
      if (!Array.isArray(sub[k])) return false
      for (const b of sub[k]) if (!unevalContributions(b, kind, names, state, depth + 1)) return false
    }
  }
  for (const k of ['if', 'then', 'else']) {
    if (sub[k] !== undefined && !unevalContributions(sub[k], kind, names, state, depth + 1)) return false
  }
  return true
}

// A contribution that names only what the node's own adjacent keywords
// already evaluate unconditionally changes nothing: a key in the node's own
// `properties` is evaluated whether or not the branch that also names it
// passes, and a branch prefix no longer than the node's own is covered
// position for position. Anything beyond those bounds is conditional
// evaluation the plain counterpart cannot express, and the node stays with
// the interpreted engine.
function unevalLocalOk (node, key) {
  if (node[key] !== false) return false
  if (node.$ref !== undefined || node.$dynamicRef !== undefined || node.$recursiveRef !== undefined) return false
  if (node.dependentSchemas !== undefined || node.dependencies !== undefined) return false
  const kind = key === 'unevaluatedProperties' ? 'props' : 'items'
  if (kind === 'props' && node.patternProperties !== undefined) return false
  if (kind === 'items' && node.contains !== undefined) return false
  const names = new Set()
  const state = { prefix: 0 }
  for (const k of ['allOf', 'anyOf', 'oneOf']) {
    if (node[k] !== undefined) {
      if (!Array.isArray(node[k])) return false
      for (const b of node[k]) if (!unevalContributions(b, kind, names, state, 0)) return false
    }
  }
  for (const k of ['if', 'then', 'else']) {
    if (node[k] !== undefined && !unevalContributions(node[k], kind, names, state, 0)) return false
  }
  if (kind === 'props') {
    const own = node.properties && typeof node.properties === 'object' ? node.properties : {}
    for (const n of names) if (!Object.prototype.hasOwnProperty.call(own, n)) return false
  } else {
    const ownPrefix = Array.isArray(node.prefixItems) ? node.prefixItems.length
      : (Array.isArray(node.items) ? node.items.length : 0)
    if (node.items !== undefined && !Array.isArray(node.items)) { /* all evaluated; any prefix is covered */ }
    else if (state.prefix > ownPrefix) return false
  }
  return true
}

// Every occurrence in the document must qualify or the generator declines the
// whole schema, exactly as the string scan it replaces did. The walk is
// generic and may visit data positions (an enum value, say); judging those is
// harmless, since a data node that fails the test only makes the answer more
// conservative and the generators never read data positions as schemas.
function unevalAllProvablyLocal (root, only) {
  const seen = new Set()
  const stack = [root]
  while (stack.length) {
    const n = stack.pop()
    if (n === null || typeof n !== 'object' || seen.has(n)) continue
    seen.add(n)
    if (!Array.isArray(n)) {
      if (only !== 'items' && n.unevaluatedProperties !== undefined && !unevalLocalOk(n, 'unevaluatedProperties')) return false
      if (n.unevaluatedItems !== undefined && !unevalLocalOk(n, 'unevaluatedItems')) return false
    }
    for (const k of Array.isArray(n) ? n : Object.values(n)) stack.push(k)
  }
  return true
}

// Detect simple prefix patterns like "^x-", "^_", "^prefix" and generate fast charCodeAt checks
// Returns a JS expression string or null if pattern is too complex
function fastPrefixCheck(pattern, keyVar) {
  // Match patterns like ^literal (no regex metacharacters after ^)
  const m = pattern.match(/^\^([a-zA-Z0-9_\-./]+)$/)
  if (!m) return null
  const prefix = m[1]
  if (prefix.length === 0 || prefix.length > 8) return null // too long = diminishing returns
  if (prefix.length === 1) {
    return `${keyVar}.charCodeAt(0)===${prefix.charCodeAt(0)}`
  }
  if (prefix.length === 2) {
    return `${keyVar}.charCodeAt(0)===${prefix.charCodeAt(0)}&&${keyVar}.charCodeAt(1)===${prefix.charCodeAt(1)}`
  }
  // For longer prefixes, startsWith is cleaner and still faster than regex
  return `${keyVar}.startsWith(${JSON.stringify(prefix)})`
}

// Generate a charCodeAt(0)-based switch tree for fast key validation.
// V8 compiles switch to jump tables — O(1) dispatch vs O(n) chain.
function genCharCodeSwitch(keys, v) {
  if (keys.length === 0) return `for(var _k in ${v})return false`
  if (keys.length <= 3) {
    // Small set: simple chain is faster than switch overhead
    return `for(var _k in ${v})if(${keys.map(k => `_k!==${JSON.stringify(k)}`).join('&&')})return false`
  }

  // Group keys by first charCode
  const groups = new Map()
  for (const k of keys) {
    const cc = k.charCodeAt(0)
    if (!groups.has(cc)) groups.set(cc, [])
    groups.get(cc).push(k)
  }

  let cases = ''
  for (const [cc, groupKeys] of groups) {
    const cond = groupKeys.map(k => `_k===${JSON.stringify(k)}`).join('||')
    cases += `case ${cc}:if(${cond})continue;break;`
  }

  return `for(var _k in ${v}){switch(_k.charCodeAt(0)){${cases}default:break}return false}`
}

// --- Error-collecting codegen: same checks, but pushes errors instead of returning false ---
// Returns a function: (data, allErrors) => { valid, errors }
// Valid path is still fast — only error path does extra work.
function compileToJSCodegenWithErrors(schema, schemaMap, userFormats, sourceOpts) {
  const inputSchema = schema
  schema = prepareForCodegen(schema, schemaMap)
  // unevaluated* is generated only where it is provably its plain counterpart
  // (see unevalLocalOk); any occurrence that is not keeps the whole schema on
  // the interpreted engine's error path, exactly as before.
  if (typeof schema === 'object' && schema !== null) {
    const s = JSON.stringify(schema)
    if ((s.includes('unevaluatedProperties') || s.includes('unevaluatedItems')) && !unevalAllProvablyLocal(schema)) return null
  }
  if (typeof schema === 'boolean') {
    return schema
      ? () => ({ valid: true, errors: [] })
      : () => ({ valid: false, errors: [{ keyword: 'not', instancePath: '', schemaPath: '#', params: {}, message: 'boolean schema is false' }] })
  }
  if (typeof schema !== 'object' || schema === null) return null
  if (!sharedCodegenGate(schema, schemaMap)) return null
  if (schema.patternProperties) {
    for (const [pat, sub] of Object.entries(schema.patternProperties)) {
      if (typeof sub === 'object' && sub !== null && !codegenSafe(sub, schemaMap)) return null
    }
  }
  if (schema.dependentSchemas) {
    for (const sub of Object.values(schema.dependentSchemas)) {
      if (typeof sub === 'object' && sub !== null && !codegenSafe(sub, schemaMap)) return null
    }
  }
  if (schema.propertyNames && typeof schema.propertyNames === 'object' && !isSimplePN(schema.propertyNames) && !codegenSafe(schema.propertyNames, schemaMap)) return null

  // Build anchors map for $ref/#anchor and $dynamicRef resolution
  const eRootDefs = schema.$defs || schema.definitions || null
  const eAnchors = {}
  if (schema.$dynamicAnchor) eAnchors['#' + schema.$dynamicAnchor] = schema
  if (schema.$anchor) eAnchors['#' + schema.$anchor] = schema
  if (typeof schema.$id === 'string' && schema.$id.startsWith('#')) eAnchors[schema.$id] = schema
  if (eRootDefs) {
    for (const def of Object.values(eRootDefs)) {
      if (def && typeof def === 'object') {
        if (def.$dynamicAnchor) eAnchors['#' + def.$dynamicAnchor] = def
        if (def.$anchor) eAnchors['#' + def.$anchor] = def
        if (typeof def.$id === 'string' && def.$id.startsWith('#')) eAnchors[def.$id] = def
      }
    }
  }
  if (schemaMap) {
    for (const ext of schemaMap.values()) {
      if (ext && typeof ext === 'object') {
        if (ext.$dynamicAnchor && !eAnchors['#' + ext.$dynamicAnchor]) eAnchors['#' + ext.$dynamicAnchor] = ext
        if (ext.$anchor && !eAnchors['#' + ext.$anchor]) eAnchors['#' + ext.$anchor] = ext
        if (typeof ext.$id === 'string' && ext.$id.startsWith('#') && !eAnchors[ext.$id]) eAnchors[ext.$id] = ext
      }
    }
  }

  // As in the boolean generator: a reference this path cannot resolve or follow
  // emits no lines, and an empty program is returned below as always-valid.
  if (hasUnresolvableRef(schema, eRootDefs, eAnchors, schemaMap, new Set())) return null
  if (needsBaseTracking(schema, schemaMap, new Set())) return null

  const ctx = { varCounter: 0, helperCode: [], rootDefs: eRootDefs, shared: [], refStack: new Set(), schemaMap: schemaMap || null, anchors: eAnchors, rootE: schema, rootSchema: inputSchema, userFormats: userFormats || null,
                // Custom format checkers referenced by the body, bound as
                // closure parameters below the way the other entry points do.
                closureVars: [], closureVals: [],
                sourceMap: (sourceOpts && sourceOpts.sourceMap && sourceOpts.schemaFile)
                  ? { file: sourceOpts.schemaFile, map: sourceOpts.sourceMap, frames: sourceOpts.frames || null }
                  : null }
  ctx.helperCode.push('const _cpLen=s=>{let n=0;for(const _ of s)n++;return n}')
  const lines = []
  try {
    genCodeE(schema, 'd', '', lines, ctx, '#')
  } catch (e) {
    if (e === DECLINE) return null
    throw e
  }
  // Inline branch-collapse helper only when the schema actually used a
  // oneOf/anyOf branch path (tracked via ctx.usesBranchCollapse). Keeps the
  // AOT output small for schemas that don't compose. Standalone modules can't
  // require('./branch-collapse'), so the helper body is embedded verbatim.
  if (ctx.usesBranchCollapse) {
        ctx.helperCode.push(require('./branch-collapse').embedSource())
  }
  if (lines.length === 0) return (d) => ({ valid: true, errors: [] })

  const checkStr = lines.join('\n  ')
  const defSetsE = ctx.defFns ? Array.from(ctx.defFns.values()) : []
  const needsGuardE = ctx.usesRecursion || defSetsE.length > 0
  const guardStrE = needsGuardE ? emitGuardState() : ''
  const helpersE = ctx.helperCode.length ? ctx.helperCode.join('\n  ') + '\n  ' : ''

  let body
  if (ctx.usesRecursion) {
    // The abandoned first pass may have pushed errors, so the retry starts
    // from an empty list and the reported errors come from the guarded run
    // alone.
    body = `const _e=[];\n  ` + guardStrE + helpersE +
      emitRootGuard('_validateE', 'd,_all,_e', '') +
      `function _validateE_b(d,_all,_e){\n  ${checkStr}\n  }\n  ` +
      emitGuardedRun('_validateE(d,_all,_e)', '_e.length=0;', defSetsE) +
      `return{valid:_e.length===0,errors:_e}`
  } else if (defSetsE.length > 0) {
    body = `const _e=[];\n  ` + guardStrE + helpersE +
      `function _bodyE(d,_all,_e){\n  ${checkStr}\n  }\n  ` +
      emitGuardedRun('_bodyE(d,_all,_e)', '_e.length=0;', defSetsE) +
      `return{valid:_e.length===0,errors:_e}`
  } else {
    body = `const _e=[];\n  ` + helpersE + checkStr +
      `\n  return{valid:_e.length===0,errors:_e}`
  }
  try {
    let fn
    // Custom format checkers come in as leading parameters, bound once here,
    // so the body's `_uf_<name>(...)` calls resolve. Without a binding the
    // first invalid document threw a ReferenceError instead of reporting.
    const cvars = ctx.closureVars
    const cvals = ctx.closureVals
    // The helpers are constants: the uri tables, the compiled patterns, the
    // branch-collapse functions, the name sets. In `body` they sit inside the
    // function and were rebuilt on every call, which on a product schema with
    // six URLs and one anyOf cost about 450 ns before a single check ran, more
    // than every check and every error together. Here they run once, in a
    // factory, as the verdict function's preamble does; with $defs or
    // recursion too, below. `_errSource` stays `body` either way, for the
    // emitters.
    // The factory builds the helpers once and returns the error function.
    // With $defs or recursion the helpers are the definitions' functions and
    // the cycle guard's state lives beside them; the guarded run resets that
    // state at its start, and a call made while one is running (a custom
    // keyword validating with the same validator) gets a function from a fresh
    // factory call instead of sharing it. `_errFactory` carries the same text
    // to the standalone emitter.
    let factoryBody
    if (needsGuardE) {
      const attempt = ctx.usesRecursion ? '_validateE(d,_all,_e)' : '_bodyE(d,_all,_e)'
      const runner = ctx.usesRecursion
        ? emitRootGuard('_validateE', 'd,_all,_e', '') + `function _validateE_b(d,_all,_e){\n  ${checkStr}\n  }\n  `
        : `function _bodyE(d,_all,_e){\n  ${checkStr}\n  }\n  `
      factoryBody = guardStrE + helpersE + runner + `return function(d,_all){const _e=[];\n  ` +
        emitGuardedRun(attempt, '_e.length=0;', defSetsE) + `return{valid:_e.length===0,errors:_e}}`
    } else {
      factoryBody = helpersE + 'return function(d,_all){const _e=[];\n  ' + checkStr +
        '\n  return{valid:_e.length===0,errors:_e}}'
    }
    // For the runtime, the literals take the legacy shape directly. `code` and
    // `docUrl` are there for standalone modules, which return errors as they
    // are; the runtime derives both from the keyword when it enriches, and
    // orders errors by schemaPath, so the literals carried three fields that
    // every read then copied the error to remove. The patterns are this
    // generator's own spelling; the collapse helper writes its fields with a
    // space and keeps them.
    if (sourceOpts && sourceOpts.runtimeShape) {
      const shape = (src) => src.replace(/code:'ATA\d{4}',/g, '').replace(/,docUrl:'https:\/\/ata-validator\.com\/e\/ATA\d{4}'/g, '').replace(/,_o:\d+/g, '')
      body = shape(body)
      factoryBody = shape(factoryBody)
    }
    const hoistable = !ctx.usesRecursion && defSetsE.length === 0 && helpersE !== ''
    if (hoistable || needsGuardE) {
      const params = [...cvars, '__ataSafeRe']
      const args = [...cvals, compileSafe]
      const make = new Function(...params, factoryBody)
      const main = make(...args)
      if (needsGuardE) {
        let busy = false
        fn = (d, _all) => {
          if (busy) return make(...args)(d, _all)
          busy = true
          try { return main(d, _all) } finally { busy = false }
        }
      } else {
        fn = main
      }
    } else if (ctx.usesSafeRe) {
      // Inlined helperCode references __ataSafeRe; bind the safe-regex factory.
      // Standalone keeps the inline _errSource — the embed defines __ataSafeRe.
      const built = new Function(...cvars, '__ataSafeRe', 'd', '_all', body)
      fn = cvars.length
        ? (d, _all) => built(...cvals, compileSafe, d, _all)
        : (d, _all) => built(compileSafe, d, _all)
    } else if (cvars.length) {
      const built = new Function(...cvars, 'd', '_all', body)
      fn = (d, _all) => built(...cvals, d, _all)
    } else {
      fn = new Function('d', '_all', body)
    }
    fn._errSource = body
    fn._errFactory = factoryBody
    fn._errGuarded = needsGuardE
    fn._sharedHelpers = ctx.shared ? ctx.shared.slice() : []
    fn._usesSafeRe = !!ctx.usesSafeRe
    if (cvars.length) {
      fn._formatClosures = cvars.map((name, i) => {
        let format = null
        for (const key of Object.keys(ctx.userFormats)) {
          if (ctx.userFormats[key] === cvals[i]) { format = key; break }
        }
        return { name, fn: cvals[i], format }
      })
    }
    return fn
  } catch (e) {
    // Declining here is safe (the interpreter takes over) but silent, which
    // is how every past regression in this file hid. The env hook makes the
    // decline visible without changing behavior.
    if (process.env.ATA_DEBUG_ERRGEN) console.error('error codegen declined:', e.message)
    return null
  }
}

// Emit codegen for oneOf/anyOf that runs each branch with error collection,
// aggregates results, and uses __ataCollapse to surface a single best-branch
// error. Wraps the existing per-branch evaluation; does not replace it.
const BRANCH_VERDICT_MAX = 4096

// What undoing a trial emission needs: during one, the context's arrays only
// grow and its maps and sets only gain keys (a reference pushed onto refStack
// by a declined branch is such a key), so their lengths and sizes are enough,
// and what was added is cut off the end, in insertion order. Copying them
// instead made the trial quadratic: 297 oneOf and anyOf on apollo-router,
// each copying a helper list thousands long.
function snapshotCtx (ctx) {
  const out = new Map()
  for (const k of Object.keys(ctx)) {
    const x = ctx[k]
    if (Array.isArray(x)) out.set(k, { kind: 'a', ref: x, n: x.length })
    else if (x instanceof Map || x instanceof Set) out.set(k, { kind: 'c', ref: x, n: x.size })
    else out.set(k, { kind: 'v', ref: x })
  }
  return out
}
function restoreCtx (ctx, saved) {
  for (const k of Object.keys(ctx)) if (!saved.has(k)) delete ctx[k]
  for (const [k, e] of saved) {
    if (e.kind === 'a') { e.ref.length = Math.min(e.ref.length, e.n); ctx[k] = e.ref }
    else if (e.kind === 'c') {
      const extra = e.ref.size - e.n
      if (extra > 0) {
        const added = []
        let i = 0
        for (const key of e.ref.keys()) if (i++ >= e.n) added.push(key)
        for (const key of added) e.ref.delete(key)
      }
      ctx[k] = e.ref
    } else ctx[k] = e.ref
  }
}

// Whether a node holds a reference anywhere below it.
function holdsRef (node, seen = new Set()) {
  if (node === null || typeof node !== 'object' || seen.has(node)) return false
  seen.add(node)
  if (typeof node.$ref === 'string' || typeof node.$dynamicRef === 'string') return true
  for (const k of Object.keys(node)) if (holdsRef(node[k], seen)) return true
  return false
}

// Every `$ref` under `node`, outside the values of enum, const, default and
// examples. Null when one is not a plain pointer into the root's definitions
// (after prepareForCodegen those are what remain, besides `#` itself) or
// when the node carries a scope keyword of its own, which would not mean the
// same thing under a wrapper.
const BRANCH_SCOPE_KEYS = new Set(['$id', '$anchor', '$dynamicAnchor', '$dynamicRef', '$defs', 'definitions', '$schema'])
function branchRefsLocal (node, defsKey, seen) {
  if (node === null || typeof node !== 'object') return true
  if (seen.has(node)) return true
  seen.add(node)
  if (Array.isArray(node)) { for (const x of node) if (!branchRefsLocal(x, defsKey, seen)) return false; return true }
  for (const k of Object.keys(node)) {
    if (SKIP_VALUE_KEYS.has(k)) continue
    if (BRANCH_SCOPE_KEYS.has(k)) return false
    const v = node[k]
    if (k === '$ref') { if (typeof v !== 'string' || !v.startsWith('#/' + defsKey + '/')) return false; continue }
    if (!branchRefsLocal(v, defsKey, seen)) return false
  }
  return true
}
// One verdict function per branch, compiled on its own with the root's
// definitions under it, or null when a branch cannot be wrapped that way
// (then the site keeps its error functions for the decision). The
// definitions themselves are checked once per root.
const _defsLocal = new WeakMap()
function compileBranchVerdicts (branches, ctx) {
  const root = ctx.rootC
  if (root === null || typeof root !== 'object') return null
  const defsKey = root.$defs && typeof root.$defs === 'object' ? '$defs' : (root.definitions && typeof root.definitions === 'object' ? 'definitions' : null)
  if (defsKey !== null) {
    let ok = _defsLocal.get(root)
    if (ok === undefined) { ok = branchRefsLocal(root[defsKey], defsKey, new Set()); _defsLocal.set(root, ok) }
    if (!ok) return null
  }
  const out = []
  for (const sub of branches) {
    if (sub === true) { out.push(() => true); continue }
    if (sub === false) { out.push(() => false); continue }
    if (sub === null || typeof sub !== 'object' || Array.isArray(sub)) return null
    if (!branchRefsLocal(sub, defsKey === null ? '$defs' : defsKey, new Set())) return null
    const wrapped = Object.assign({}, sub)
    if (defsKey !== null) wrapped[defsKey] = root[defsKey]
    if (typeof ctx.rootSchema === 'object' && ctx.rootSchema !== null && typeof ctx.rootSchema.$schema === 'string') wrapped.$schema = ctx.rootSchema.$schema
    let fn = null
    try { fn = compileToJSCodegen(wrapped, ctx.schemaMap, ctx.userFormats) } catch (e) { if (e !== DECLINE) throw e }
    if (typeof fn !== 'function') return null
    out.push(fn)
  }
  return out
}

// A verdict for one subtree of the combined function, as a function in the
// preamble, so the collecting code of that subtree runs only for a value the
// verdict rejects. The collecting code is slower than the verdict on an
// accepted value (it keeps paths, builds nothing it can avoid but tests more
// than the verdict's cheapest-first order), so without this the whole
// function was put behind one verdict of the whole document (`_VF`), and a
// rejected document was validated twice in full. With a guard at every
// array element and every object-valued property, an accepted value costs
// its verdict and a rejected one costs its verdict plus the collection of
// the subtree that failed. Only in the combined function, the runtime path;
// null for a subtree whose verdict declines, is a leaf, or is too large.
const GUARD_KEYS = ['oneOf', 'anyOf', 'allOf', '$ref', 'items', 'prefixItems', 'properties', 'patternProperties', 'additionalProperties', 'not', 'if', 'contains', 'dependentSchemas', 'dependencies', 'propertyNames', 'unevaluatedProperties', 'unevaluatedItems']
const GUARD_MAX = 16 * 1024
const GUARD_BUDGET = 512 * 1024
// Whether a schema node is worth a guard of its own: it applies something
// beyond leaf checks. A node whose children are themselves worth guarding is
// not guarded; the guards go on the children. Guarding both ran the parent's
// verdict in full and then, when it failed, every child's verdict again: on a
// list of 1000 users with one bad one that was two verdicts of the list
// before the one user was collected.
const weighty = (n) => n !== null && typeof n === 'object' && !Array.isArray(n) && GUARD_KEYS.some((k) => n[k] !== undefined)
function childrenWeighty (sub) {
  if (weighty(sub.items)) return true
  if (Array.isArray(sub.prefixItems) && sub.prefixItems.some(weighty)) return true
  if (weighty(sub.additionalProperties)) return true
  if (sub.properties && typeof sub.properties === 'object') for (const k of Object.keys(sub.properties)) if (weighty(sub.properties[k])) return true
  if (sub.patternProperties && typeof sub.patternProperties === 'object') for (const k of Object.keys(sub.patternProperties)) if (weighty(sub.patternProperties[k])) return true
  return false
}
// Below this much verdict source the guard is written into the function
// itself as a labelled block (`gN:{...break gN...}`), not as a function it
// calls: in the first thousands of calls of a process, before the optimizing
// compiler has inlined anything, each call is paid in full, and a schema
// with six small guards paid six. Above it the guard stays a function, so
// one large subtree does not swell the function around it.
const GUARD_INLINE_MAX = 2048
function subtreeGuard (sub, ctx, gv) {
  if (!ctx.inCombined || !weighty(sub) || childrenWeighty(sub)) return null
  if ((ctx.guardChars || 0) >= GUARD_BUDGET) return null
  // The verdict generator registers the definition functions it writes under
  // `defFns`, and so does the error generator for the branch functions of
  // this same program: shared, the verdict found the error generator's
  // `_defE` function under the definition's name and called it with one
  // argument. The guards keep a registry of their own.
  if (!ctx.guardDefFns) ctx.guardDefFns = new Map()
  const saved = snapshotCtx(ctx)
  const outerDefFns = ctx.defFns
  const outerShare = ctx.shareDefs
  ctx.defFns = ctx.guardDefFns
  // Definitions referenced from several places are written once, as
  // functions in the preamble (the verdict generator's shared mode), not
  // expanded into every guard that reaches them: expanded, the guards of a
  // 25-definition API schema came to 55 KB of source in a 133 KB function,
  // and a function that size reaches the optimizing compiler late.
  ctx.shareDefs = true
  try {
    const bl = []
    try { nestedGenCode(sub, gv, bl, ctx) } finally { ctx.defFns = outerDefFns; ctx.shareDefs = outerShare }
    if (bl.length === 0) { restoreCtx(ctx, saved); return null }
    const body = bl.join(';')
    // The verdict generator's recursion names (`_validate`, the cycle guard
    // state) are not this function's; a subtree that reaches them stays
    // unguarded.
    const added = ctx.preamble.slice(saved.get('preamble').n).join(';')
    if (body.length > GUARD_MAX || body.includes(SP_PLACEHOLDER) || /\b(?:_validate|_stk|_sd|_sg|_CYC)\b/.test(body + added)) { restoreCtx(ctx, saved); return null }
    ctx.guardChars = (ctx.guardChars || 0) + body.length
    if (body.length <= GUARD_INLINE_MAX) return { body }
    const name = `_vg${ctx.varCounter++}`
    ctx.helperCode.push(`const ${name}=function(${gv}){${body};return true}`)
    return { name }
  } catch (e) {
    if (e !== DECLINE) throw e
    restoreCtx(ctx, saved)
    return null
  }
}
// The collecting code for `sub` at `v`, behind its guard when there is one.
function genGuardedC (sub, v, pathExpr, lines, ctx, schemaPrefix) {
  const gi = ctx.varCounter++
  const gv = `_gv${gi}`
  const g = subtreeGuard(sub, ctx, gv)
  if (g === null) { genCodeC(sub, v, pathExpr, lines, ctx, schemaPrefix); return }
  if (g.name !== undefined) lines.push(`if(!${g.name}(${v})){`)
  else {
    // The verdict's exits become jumps out of the block: a failure leaves
    // the flag set, success clears it. replaceTopLevel keeps nested
    // closures' returns as they are (see the hybrid rewrite).
    lines.push(`{const ${gv}=${v};let _g${gi}=1;g${gi}:{${replaceTopLevel(g.body, `{_g${gi}=0;break g${gi}}`, `break g${gi}`)};_g${gi}=0}if(_g${gi}){`)
  }
  ctx.guardDepth = (ctx.guardDepth || 0) + 1
  try { genCodeC(sub, v, pathExpr, lines, ctx, schemaPrefix) } finally { ctx.guardDepth-- }
  lines.push(g.name !== undefined ? '}' : '}}')
}

// A branch's error-collecting body rewritten to count what it would have
// collected: each `_e.push({keyword:'k',...})` becomes a count and a severity
// (lib/branch-collapse.js, __ataScore), and the body returns the score the
// collapse would compute from the errors. When no branch of a oneOf or anyOf
// holds, the collapse reports the closest branch's errors; it used to run
// every branch's error function to score them, building every branch's
// errors to keep one branch's. Now the counting bodies score, and only the
// closest branch's error function runs. Null for a body the rewrite cannot
// follow (a shared definition call, a nested collapse, a push that is not a
// literal); that site keeps the old path.
function countingBody (body) {
  // A nested oneOf or anyOf that does not hold is one collapsed error in the
  // branch's list (keyword oneOf or anyOf, severity 4): its marked section,
  // which would run the inner branches to build it, becomes that count.
  // Two kinds of section: CB is one error whatever the branches would say;
  // CU is a section the copy cannot score (the value is not the one the
  // counts were taken for), so the copy answers -1 and the picker runs the
  // branches as before.
  while (true) {
    const b1 = body.indexOf('/*CB*/'), b2 = body.indexOf('/*CU*/')
    const b = b1 < 0 ? b2 : b2 < 0 ? b1 : Math.min(b1, b2)
    if (b < 0) break
    const unknown = b === b2
    let depth = 1
    let j = b + 6
    while (j < body.length && depth > 0) {
      if (body.startsWith('/*CB*/', j) || body.startsWith('/*CU*/', j)) { depth++; j += 6; continue }
      if (body.startsWith('/*CE*/', j)) { depth--; j += 6; continue }
      j++
    }
    if (depth !== 0) return null
    body = body.slice(0, b) + (unknown ? 'return -1' : '(_n++,_s+=4)') + body.slice(j)
  }
  if (/\b(?:_defE\d|__ataCollapse|__ataMulti|_brf\d|_bsf\d)/.test(body)) return null
  const SEV = require('./branch-collapse').SEVERITY
  let out = ''
  let i = 0
  const head = 'const _e=[];'
  if (!body.startsWith(head)) return null
  out += 'let _n=0,_s=0;'
  i = head.length
  while (i < body.length) {
    const ch = body[i]
    if (ch === '"' || ch === "'" || ch === '`') { const j = skipString(body, i); out += body.slice(i, j); i = j; continue }
    if (body.startsWith('_e.push(', i)) {
      let j = i + 8
      let depth = 1
      while (j < body.length && depth > 0) {
        const c = body[j]
        if (c === '"' || c === "'" || c === '`') { j = skipString(body, j); continue }
        if (c === '(' || c === '{' || c === '[') depth++
        else if (c === ')' || c === '}' || c === ']') depth--
        j++
      }
      if (depth !== 0) return null
      const arg = body.slice(i + 8, j - 1)
      // The literal may still carry its `code` (the shape pass strips it).
      const m = /^\{(?:code:'ATA\d{4}',)?keyword:'([A-Za-z$][\w$]*)',/.exec(arg)
      if (m === null) return null
      out += `(_n++,_s+=${SEV[m[1]] || 4})`
      i = j
      continue
    }
    if (body.startsWith('return{valid:false,errors:_e}', i)) { out += 'return _n*100+_s'; i += 29; continue }
    if (body.startsWith('return{valid:_e.length===0,errors:_e}', i)) { out += 'return _n*100+_s'; i += 37; continue }
    if (body.startsWith('_e.length', i)) { out += '_n'; i += 9; continue }
    out += ch
    i++
  }
  if (/\b_e\b/.test(out.replace(/'[^']*'|"[^"]*"/g, ''))) return null
  return out
}

function emitBranchCollapse (branches, keyword, v, pathExpr, lines, ctx, schemaPrefix) {
  ctx.usesBranchCollapse = true
  const fi = ctx.varCounter++
  const branchKw = keyword
  const branchSp = schemaPrefix + '/' + branchKw
  // Per-branch error-collecting functions, each returning {valid,errors}.
  // They take the value, its instance path, `_all` and, inside a definition
  // written once for all its references, that reference's schema path, so
  // they can be built once per call of the error function rather than each
  // time the keyword is reached: on a list of 1723 tokens that is thousands
  // of closure arrays per validation.
  const fns = []
  const titles = []
  let usesSp = false
  for (let i = 0; i < branches.length; i++) {
    const sub = branches[i]
    const subLines = []
    const subSp = branchSp + '/' + i
    if (typeof sub === 'object' && sub !== null) {
      // A branch is a function of its own with a local `_e`; a collapse
      // inside it reports there, not into the combined function's lists.
      ctx.inBranchFn = (ctx.inBranchFn || 0) + 1
      try {
        genCodeE(sub, '_bv', '_bpth', subLines, ctx, subSp)
      } finally {
        ctx.inBranchFn--
      }
    } else if (sub === false) {
      // A false branch never matches; it reports the same error the
      // interpreter attaches to a false schema.
      subLines.push(`_e.push({keyword:'not',instancePath:_bpth,schemaPath:'${subSp}'${ordinalField(ctx, `${subSp}`)},params:{},message:'boolean schema is false'})`)
    }
    const title = (sub && typeof sub === 'object' && typeof sub.title === 'string') ? sub.title : ''
    titles.push(title)
    let body = subLines.length === 0 ? '' : `const _e=[];${subLines.join(';')};return{valid:_e.length===0,errors:_e}`
    if (body.includes(SP_PLACEHOLDER)) {
      body = body.split(`'${SP_PLACEHOLDER}`).join(`_sp+'`).split(`"${SP_PLACEHOLDER}`).join(`_sp+"`)
      if (body.includes(SP_PLACEHOLDER)) throw DECLINE
      usesSp = true
    }
    fns.push(body)
  }
  const params = usesSp ? '_bv,_bpth,_all,_sp' : '_bv,_bpth,_all'
  const fnArr = `_brf${fi}`
  const resArr = `_brr${fi}`
  const titleArr = JSON.stringify(titles)
  const collapsed = `_brc${fi}`
  const pp = pathExpr || '""'
  ctx.helperCode.push(`const ${fnArr}=[${fns.map((b) => b === '' ? `function(){return{valid:true,errors:[]}}` : `function(${params}){${b}}`).join(',')}];const _bt${fi}=${titleArr}`)
  const call = `${fnArr}[_bi](${v},_pp${fi},_all${usesSp ? ',_sp' : ''})`
  // branchSp is source text for a quoted literal, with backslashes and quotes
  // escaped; the ordinal is looked up by the path itself. Looked up by the
  // text, a path through a pattern such as `^\\d+$` found no node, or the
  // wrong one, and the collapsed error sorted out of place against the other
  // engines.
  // In the runtime shape there is no ordering key (the reader looks the path
  // up), so the collapsed error is in its final shape as it is built.
  const ord = ctx.noOrdinal ? 'null' : (() => { const o = ordinalFor(ctx.rootSchema, unescapeSp(branchSp)); return o === null ? 'null' : o })()
  // In the combined function `_e` is created on the first error and every
  // error is collected (`_all` is true there), so the report only pushes.
  const report = ctx.inCombined && !ctx.inBranchFn
    ? `const ${collapsed}=__ataCollapse('${branchKw}',${resArr},_pp${fi},'${branchSp}',${ord},_bt${fi});if(${collapsed})(_e=_ap(_A,_e,${collapsed},${apOrd(ctx, branchSp)}))`
    : `const ${collapsed}=__ataCollapse('${branchKw}',${resArr},_pp${fi},'${branchSp}',${ord},_bt${fi});if(${collapsed}){_e.push(${collapsed});if(!_all)return{valid:false,errors:_e}}`
  // Score first, collect once (countingBody), in the combined function where
  // the collapsed error is built in its final shape (no ordering key).
  let noneReport = null
  if (ctx.inCombined && (ctx.noOrdinal ? 'null' : '') === 'null') {
    const cbs = fns.map((b) => b === '' ? 'return 0' : countingBody(b))
    if (!cbs.some((c) => c === null)) {
      const sfx = usesSp ? ',_sp' : ''
      const code = branchKw === 'oneOf' ? 'ATA4001' : 'ATA4003'
      // `code: ` with the space: the runtime shape strips this generator's own
      // `code:'ATA....',` from the literals and keeps the collapse's, which
      // the reader expects to carry it (see the shape pass below).
      const lit = `{code: '${code}',keyword:'${branchKw}',instancePath:_pp${fi}||'',path:_pp${fi}||'',schemaPath:'${branchSp}',message:'value matched 0 of ${branches.length} ${branchKw} variants',params:{variants:${branches.length},closest:_bi${fi},closestName:_bt${fi}[_bi${fi}]||('variant '+(_bi${fi}+1))},branchErrors:_br${fi}.errors}`
      // In a branch function the error joins that function's list (the
      // combined function's `_ap` and ordering state are not its).
      const push = ctx.inBranchFn ? `_e.push(${lit});if(!_all)return{valid:false,errors:_e}` : `(_e=_ap(_A,_e,${lit},${apOrd(ctx, branchSp)}))`
      if (cbs.length === 1) {
        // One branch is the closest one: nothing to score, no counting copy.
        // Scoring it ran the branch a third time (verdict, count, errors).
        noneReport = `{let _bi${fi}=0;const _br${fi}=${fnArr}[0](${v},_pp${fi},_all${sfx});${push}}`
      } else {
        ctx.helperCode.push(cbs.map((b, i) => `const _bsf${fi}_${i}=function(${params}){${b}}`).join(';'))
        const picks = cbs.map((_, i) => `{const _s=_bsf${fi}_${i}(${v},_pp${fi},_all${sfx});if(_s<0)_ng${fi}=1;else if(_s<_bs${fi}){_bs${fi}=_s;_bi${fi}=${i}}}`).join('')
        // A copy that could not score (-1): every branch runs, as before.
        const noneOld = branchKw === 'anyOf'
          ? `const ${resArr}=[];for(let _bi=0;_bi<${branches.length};_bi++){const _br=${call};${resArr}.push(_br.valid?{valid:false,errors:_br.errors}:_br)}${report}`
          : `const ${resArr}=[];for(let _bi=0;_bi<${branches.length};_bi++)${resArr}.push(${call});${report}`
        noneReport = `{let _bi${fi}=0,_bs${fi}=Infinity,_ng${fi}=0;${picks}if(_ng${fi}){${noneOld}}else{const _br${fi}=${fnArr}[_bi${fi}](${v},_pp${fi},_all${sfx});${push}}}`
      }
    }
  }
  // The node's runtime unevaluatedProperties already counted how many of
  // these branches pass, through the annotation functions, which answer the
  // same validity. A oneOf with exactly one, an anyOf with any, holds and
  // reports nothing, so its branches are not run a second time to say so.
  // Only in the combined function proper, where that count is in scope.
  // Inside a branch function only a factory-scope count (factoryCount) is
  // in reach; the node's own counts are locals of the combined function.
  const countedRaw = ctx.inCombined && ctx.branchCounts ? ctx.branchCounts.get(branches) : undefined
  const counted = countedRaw !== undefined && (!ctx.inBranchFn || countedRaw.factory) ? countedRaw : undefined
  const same = counted !== undefined ? `${v}!==null&&typeof ${v}==='object'&&${counted.of}===${v}` : ''
  let guard = counted !== undefined
    ? (keyword === 'anyOf' ? `if(!(${same}&&${counted.count}>=1))` : `if(!(${same}&&${counted.count}===1))`)
    : ''
  // More than one oneOf branch passed: the error names them and carries no
  // branch errors, so it is built from the bits the count left.
  if (guard !== '' && keyword === 'oneOf' && counted.mask && ctx.inCombined) {
    const ord0 = ctx.noOrdinal ? 'null' : (() => { const o = ordinalFor(ctx.rootSchema, unescapeSp(branchSp)); return o === null ? 'null' : o })()
    const multiC = `__ataMulti(_pi${fi},${branches.length},${pp},'${branchSp}',${ord0})`
    const pushC = ctx.inBranchFn ? `_e.push(${multiC});if(!_all)return{valid:false,errors:_e}` : `(_e=_ap(_A,_e,${multiC},${apOrd(ctx, branchSp)}))`
    // The marked section is one error in a counting copy (countingBody).
    guard = `if(${same}&&${counted.count}>1){/*CB*/const _pi${fi}=[];for(let _k=0;_k<${branches.length};_k++)if((${counted.mask}>>_k)&1)_pi${fi}.push(_k);${pushC}/*CE*/}else if(!(${same}&&${counted.count}===1))`
  }
  // Without such a count, each branch also gets a verdict function, and the
  // passing branches are counted with those: a oneOf with exactly one and an
  // anyOf with any hold, and a oneOf with more than one is reported from the
  // bits, so the error-collecting branches run only when no branch passes
  // and the collapse needs their errors to pick the closest. Running them to
  // learn the count built a result object and an error list per branch,
  // which made a oneOf matched twice cost 69 ns where counting costs about
  // 12. A branch the verdict generator declines keeps the old path.
  let vfArr = null
  // Branches that hold a reference are left to the error branches: their
  // verdicts would expand every definition again, as a second copy, where the
  // error branches call the shared one.
  if (guard === '' && !branches.some((b) => holdsRef(b))) {
    // A trial: the generators are not exception-safe on the context (a
    // reference left on refStack by a declined branch made the next error
    // function write that branch as nothing, which read as valid), so the
    // context is put back as it was when the verdicts decline.
    const saved = snapshotCtx(ctx)
    try {
      const vfs = branches.map((sub) => {
        if (sub === true) return 'function(){return true}'
        if (sub === false) return 'function(){return false}'
        const bl = []
        nestedGenCode(sub, '_bv', bl, ctx)
        return bl.length === 0 ? 'function(){return true}' : `function(_bv){${bl.join(';')};return true}`
      })
      // Only while the verdicts are small: they are a second copy of the
      // branches, with every reference expanded, and on large branches that
      // copy cost more to compile than counting saves (apollo-router's error
      // function grew from 1.5 to 2.5 MB of source).
      if (!vfs.some((b) => b.includes(SP_PLACEHOLDER)) && vfs.reduce((n, b) => n + b.length, 0) <= BRANCH_VERDICT_MAX) {
        // One constant per branch, called directly: through an array the one
        // call site sees every branch and none of them is inlined.
        vfArr = `_bvf${fi}`
        ctx.helperCode.push(vfs.map((b, i) => `const ${vfArr}_${i}=${b}`).join(';'))
      } else {
        restoreCtx(ctx, saved)
      }
    } catch (e) {
      if (e !== DECLINE) throw e
      restoreCtx(ctx, saved)
    }
  }
  // In the combined function (the runtime path; a standalone module cannot
  // carry a compiled function) a branch that holds a reference, or a site
  // whose inline verdicts were too large, gets a verdict compiled on its own
  // and handed in as a closure value: the branch with the root's definitions
  // under it, through compileToJSCodegen, with its own shared definitions and
  // its own regex engines. Without one, every branch's error function ran on
  // every value the keyword saw, accepted or not: json-patch's six-way oneOf
  // cost 1363 ns on a valid list of patches where its verdict costs 261.
  if (vfArr === null && guard === '' && ctx.inCombined) {
    const compiled = compileBranchVerdicts(branches, ctx)
    if (compiled !== null) {
      vfArr = `_bvf${fi}`
      for (let i = 0; i < compiled.length; i++) { ctx.closureVars.push(`${vfArr}_${i}`); ctx.closureVals.push(compiled[i]) }
    }
  }
  if (vfArr !== null) {
    const L = branches.length
    const top = ctx.inCombined && !ctx.inBranchFn
    // An accepted document is still answered by the verdict first (see the
    // result shape in compileToJSCombined): that is the fastest path to it,
    // and dropping it measured 20 ns slower per accepted oneOf.
    if (top && !ctx.guardDepth) ctx.unguardedCollapse = true
    const tests = branches.map((_, i) => `${vfArr}_${i}(${v})`)
    if (keyword === 'anyOf') {
      const none = noneReport !== null ? noneReport : `const ${resArr}=[];for(let _bi=0;_bi<${L};_bi++){const _br=${call};${resArr}.push(_br.valid?{valid:false,errors:_br.errors}:_br)}${report}`
      // In a branch function the section a counting copy replaces is marked
      // (countingBody): when the keyword does not hold, the error function
      // reports one collapsed error, whatever the branches would say.
      lines.push(`{const _pp${fi}=${pp};if(!(${tests.join('||')})){${top ? '' : '/*CB*/'}if(_all===0){_e.push(null);return{valid:false,errors:_e}}${none}${top ? '' : '/*CE*/'}}}`)
    } else {
      const mk = L <= 30
      const collect = mk
        ? `const _pi${fi}=[];for(let _k=0;_k<${L};_k++)if((_m${fi}>>_k)&1)_pi${fi}.push(_k);`
        : ''
      const multi = `__ataMulti(_pi${fi},${L},_pp${fi},'${branchSp}',${ord})`
      const pushMulti = top ? `(_e=_ap(_A,_e,${multi},${apOrd(ctx, branchSp)}))` : `_e.push(${multi});if(!_all)return{valid:false,errors:_e}`
      const count = tests.map((t, i) => `if(${t}){_n${fi}++;${mk ? `_m${fi}|=${1 << i}` : `_pi${fi}.push(${i})`}}`).join('')
      const none = noneReport !== null ? noneReport : `const ${resArr}=[];for(let _bi=0;_bi<${L};_bi++)${resArr}.push(${call});${report}`
      lines.push(`{const _pp${fi}=${pp};let _n${fi}=0${mk ? `,_m${fi}=0` : `,_pi${fi}=[]`};${count}if(_n${fi}!==1){${top ? '' : '/*CB*/'}if(_all===0){_e.push(null);return{valid:false,errors:_e}}if(_n${fi}>1){${collect}${pushMulti}}else{${none}}${top ? '' : '/*CE*/'}}}`)
    }
    return
  }
  if (guard === '' && ctx.inCombined && !ctx.inBranchFn && !ctx.guardDepth) ctx.unguardedCollapse = true
  if (keyword === 'anyOf') {
    // anyOf reports nothing once a branch passes, so the branches are first
    // only asked whether they pass. They are called with `_all` set to 0, a
    // third value next to true (collect everything) and false (stop at the
    // first error, for abortEarly): every check reads it as `!_all` and stops
    // at its first error, and an anyOf reached that way that fails returns
    // at once instead of collecting its branches and collapsing them, since
    // the caller only wants to know. An object tried against a branch that is
    // an anyOf of primitive types used to collapse that anyOf in full and then
    // pass the next branch, which on a list of 1723 tokens was 2353 collapses
    // no one read. Only when no branch passes do they run again with the
    // caller's `_all`, and the collapse sees them all, as before.
    const probe = `${fnArr}[_bi](${v},_pp${fi},0${usesSp ? ',_sp' : ''})`
    const none = noneReport !== null ? noneReport : `const ${resArr}=[];for(let _bi=0;_bi<${fnArr}.length;_bi++){const _br=${call};${resArr}.push(_br.valid?{valid:false,errors:_br.errors}:_br)}${report}`
    const probeOld = `let _bp${fi}=false;for(let _bi=0;_bi<${fnArr}.length;_bi++){if(${probe}.valid){_bp${fi}=true;break}}if(!_bp${fi}){if(_all===0){_e.push(null);return{valid:false,errors:_e}}${none}}`
    // With a count: on the counted object the guard already said no branch
    // held (CB, one error in a counting copy); on another object the branches
    // are probed as before (CU, a counting copy cannot know).
    if (counted !== undefined) lines.push(`${guard}{const _pp${fi}=${pp};if(${same}){/*CB*/if(_all===0){_e.push(null);return{valid:false,errors:_e}}${none}/*CE*/}else{/*CU*/${probeOld}/*CE*/}}`)
    else lines.push(`${guard}{const _pp${fi}=${pp};${probeOld}}`)
  } else {
    // Asked only whether it passes (`_all` 0, see anyOf above), oneOf counts
    // the passing branches and answers; the branch errors of a probe are not
    // errors anyone reads and are not collapsed.
    // With a count from the node's unevaluatedProperties (`counted`), a count
    // of zero on the counted object means no branch held, which is the case
    // the closest-branch path answers without running every branch.
    const oldO = `const ${resArr}=[];for(let _bi=0;_bi<${fnArr}.length;_bi++)${resArr}.push(${call});if(_all===0){let _n=0;for(const _r of ${resArr})if(_r.valid)_n++;if(_n!==1){_e.push(null);return{valid:false,errors:_e}}}else{${report}}`
    const noneO = noneReport !== null ? noneReport : `const ${resArr}=[];for(let _bi=0;_bi<${fnArr}.length;_bi++)${resArr}.push(${call});${report}`
    if (counted !== undefined) lines.push(`${guard}{const _pp${fi}=${pp};if(${same}){/*CB*/if(_all===0){_e.push(null);return{valid:false,errors:_e}}${noneO}/*CE*/}else{/*CU*/${oldO}/*CE*/}}`)
    else lines.push(`${guard}{const _pp${fi}=${pp};${oldO}}`)
  }
}

// Error-collecting code generator.
// Instead of `return false`, pushes to `_e` array and optionally early-returns.
// `_all` parameter: if falsy, return after first error.
function genCodeE(schema, v, pathExpr, lines, ctx, schemaPrefix) {
  return withPlain(schema, v, lines, ctx, () => genCodeENode(schema, v, pathExpr, lines, ctx, schemaPrefix))
}
function genCodeENode(schema, v, pathExpr, lines, ctx, schemaPrefix) {
  if (!schemaPrefix) schemaPrefix = '#'
  // A false schema reports one error at the value that reached it, with the
  // keyword the interpreter has always used for it, `not` (lib/plan-compiler.js
  // line 58; its `err()` discards the 'false schema' label). Other validators
  // name this keyword `false schema`; changing it here would change output
  // the interpreter path already produces, so both engines say `not`.
  if (schema === false) {
    lines.push(`;_e.push({keyword:'not',instancePath:${pathExpr||'""'},schemaPath:'${schemaPrefix}'${ordinalField(ctx, `${schemaPrefix}`)},params:{},message:'boolean schema is false'});if(!_all)return{valid:false,errors:_e}`)
    return
  }
  if (schema === true) return
  if (typeof schema !== 'object' || schema === null) return
  if (!ctx.regExpMap) {
    ctx.regExpMap = new Map();
  }
  // $ref — resolve local and cross-schema refs
  if (schema.$ref && !schema[REF_DONE]) {
    // A keyword beside $ref that validates applies too (2020-12): the
    // reference is written on its own, then the node again with the
    // reference marked done, on a fresh copy that keeps `$ref` for the
    // annotation readers, as genCodeCNode does. This used to decline, which
    // kept the 2020-12 meta-schema (every vocabulary schema is a reference
    // with siblings once unrolled by scope) off both error generators and on
    // the interpreter for its errors, about 2 microseconds a rejection.
    if (Object.keys(schema).some((k) => !REF_NEUTRAL_SIBLINGS.has(k) && !k.startsWith('x-'))) {
      genCodeENode({ $ref: schema.$ref }, v, pathExpr, lines, ctx, schemaPrefix)
      const rest = { ...schema }
      Object.defineProperty(rest, REF_DONE, { value: true })
      genCodeENode(rest, v, pathExpr, lines, ctx, schemaPrefix)
      return
    }
    // A self-reference is a call to a helper over the root schema that takes
    // the path and the schema path as arguments, as a definition on a cycle
    // does below: the root helper takes no path, so errors raised through it
    // carried the root's path, and this declined, which left a standalone
    // module reporting one stub error for a schema with `$ref: "#"` anywhere
    // in it. This used to fall through as a permissive no-op, which accepted
    // whatever the reference guarded.
    if (schema.$ref === '#') {
      // The body comes from the prepared root (`rootE`), whose references
      // are the resolvable ones; from the schema as given, a reference by
      // `$id` resolved to nothing and the helper for the suite's recursive
      // tree checked no node.
      if (!ctx.rootE || typeof ctx.rootE !== 'object') throw DECLINE
      if (!ctx.defFns) ctx.defFns = new Map()
      let fnName = ctx.defFns.get('#')
      if (!fnName) {
        fnName = '_defE' + ctx.defFns.size + '_root'
        ctx.defFns.set('#', fnName)
        // The helper is its own function, so the references expanded in it
        // start from nothing: inside the expansion of a definition that led
        // here, the definition's own reference would otherwise read as
        // already being expanded.
        const bodyLines = []
        const outerStack = ctx.refStack
        ctx.refStack = new Set()
        try { genCodeE(ctx.rootE, 'd', '_p', bodyLines, ctx, SP_PLACEHOLDER) } finally { ctx.refStack = outerStack }
        let body = bodyLines.join('\n  ')
        body = body.split(`'${SP_PLACEHOLDER}`).join(`_sp+'`).split(`"${SP_PLACEHOLDER}`).join(`_sp+"`)
        if (body.includes(SP_PLACEHOLDER)) throw DECLINE
        ctx.helperCode.push(
          `const ${fnName}_s=new Set()\n  function ${fnName}(d,_p,_all,_e,_sp){\n  ` +
            `if(_sg){if(typeof d!=='object'||d===null)return ${fnName}_b(d,_p,_all,_e,_sp);if(${fnName}_s.has(d))return;${fnName}_s.add(d);try{return ${fnName}_b(d,_p,_all,_e,_sp)}finally{${fnName}_s.delete(d)}}\n  ` +
            `if(++_sd>${CYCLE_DEPTH})throw _CYC\n  const _r=${fnName}_b(d,_p,_all,_e,_sp)\n  _sd--\n  return _r\n  }\n  ` +
            `function ${fnName}_b(d,_p,_all,_e,_sp){${body}}`,
        )
      }
      lines.push(`${fnName}(${v},${pathExpr || '""'},_all,_e,'${schemaPrefix}');if(!_all&&_e.length)return{valid:false,errors:_e}`)
      return
    }
    const m = schema.$ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/)
    if (m && ctx.rootDefs && ctx.rootDefs[m[1]]) {
      const defName = m[1]
      if (!ctx.cyclicDefs) ctx.cyclicDefs = cyclicDefNames(ctx.rootDefs)
      if (!ctx.sharedDefs) ctx.sharedDefs = sharedDefNames(ctx.rootSchema, ctx.rootDefs)
      if (ctx.cyclicDefs.has(defName) || ctx.sharedDefs.has(defName)) {
        // Named helper for a def on a cycle, and for one referenced from
        // several places, which inlined would repeat its whole error code at
        // each: Uniswap's token-list schema has 16 references to 10
        // definitions. The path comes in as an argument because every call
        // site has its own. Only the error path runs these; the verdict
        // function, which answers valid documents, is unchanged.
        if (!ctx.defFns) ctx.defFns = new Map()
        let fnName = ctx.defFns.get(defName)
        if (!fnName) {
          fnName = '_defE' + ctx.defFns.size + '_' + defName.replace(/[^A-Za-z0-9_]/g, '_')
          ctx.defFns.set(defName, fnName)
          // The schema path comes in as an argument too, `_sp`, so an error
          // names the path it was reached by, as it does when the definition
          // is inlined and as the interpreted engine reports it; a fixed
          // `#/$defs/<name>` named the definition instead. The body is
          // generated against a placeholder prefix that becomes `_sp` in every
          // string it starts. One left anywhere else declines, rather than
          // emitting a path the placeholder stands in for.
          const bodyLines = []
          genCodeE(ctx.rootDefs[defName], 'd', '_p', bodyLines, ctx, SP_PLACEHOLDER)
          let body = bodyLines.join('\n  ')
          body = body.split(`'${SP_PLACEHOLDER}`).join(`_sp+'`).split(`"${SP_PLACEHOLDER}`).join(`_sp+"`)
          if (body.includes(SP_PLACEHOLDER)) throw DECLINE
          ctx.helperCode.push(
            `const ${fnName}_s=new Set()\n  function ${fnName}(d,_p,_all,_e,_sp){\n  ` +
              `if(_sg){if(typeof d!=='object'||d===null)return ${fnName}_b(d,_p,_all,_e,_sp);if(${fnName}_s.has(d))return;${fnName}_s.add(d);try{return ${fnName}_b(d,_p,_all,_e,_sp)}finally{${fnName}_s.delete(d)}}\n  ` +
              `if(++_sd>${CYCLE_DEPTH})throw _CYC\n  const _r=${fnName}_b(d,_p,_all,_e,_sp)\n  _sd--\n  return _r\n  }\n  ` +
              `function ${fnName}_b(d,_p,_all,_e,_sp){${body}}`,
          )
        }
        lines.push(`${fnName}(${v},${pathExpr || '""'},_all,_e,'${schemaPrefix}');if(!_all&&_e.length)return{valid:false,errors:_e}`)
        return
      }
      // A reference back into what is being expanded, on a cycle the
      // definitions alone do not show (through the root, or another
      // document): declined. Returning emitted nothing, which read as valid.
      if (ctx.refStack.has(schema.$ref)) throw DECLINE
      ctx.refStack.add(schema.$ref)
      genCodeE(ctx.rootDefs[defName], v, pathExpr, lines, ctx, schemaPrefix)
      ctx.refStack.delete(schema.$ref)
      return
    }
    // Anchor ref: "#foo" — resolve via rootDefs or anchors map
    if (!m && schema.$ref.startsWith('#') && !schema.$ref.startsWith('#/')) {
      const entry = ctx.rootDefs && ctx.rootDefs[schema.$ref]
      const anchorTarget = entry && entry.raw ? entry.raw : (ctx.anchors && ctx.anchors[schema.$ref])
      if (anchorTarget) {
        if (ctx.refStack.has(schema.$ref)) throw DECLINE
        ctx.refStack.add(schema.$ref)
        genCodeE(anchorTarget, v, pathExpr, lines, ctx, schemaPrefix)
        ctx.refStack.delete(schema.$ref)
        return
      }
    }
    if (ctx.schemaMap && ctx.schemaMap.has(schema.$ref)) {
      if (ctx.refStack.has(schema.$ref)) throw DECLINE
      ctx.refStack.add(schema.$ref)
      genCodeE(ctx.schemaMap.get(schema.$ref), v, pathExpr, lines, ctx, schemaPrefix)
      ctx.refStack.delete(schema.$ref)
      return
    }
    // Cross-schema ref with JSON pointer fragment ("<id>#/<path>")
    if (ctx.schemaMap && schema.$ref.includes('#') && !schema.$ref.startsWith('#')) {
      const r = resolveCrossSchemaRef(schema.$ref, ctx.schemaMap)
      if (r) {
        if (ctx.refStack.has(schema.$ref)) throw DECLINE
        ctx.refStack.add(schema.$ref)
        genCodeE(r.schema, v, pathExpr, lines, ctx, schemaPrefix)
        ctx.refStack.delete(schema.$ref)
        return
      }
    }
    // A reference none of the above resolved: declined. Falling through
    // emitted nothing for it, which read as valid.
    throw DECLINE
  }

  // $dynamicRef — resolve via anchors map
  if (schema.$dynamicRef) genDynamicRefE(schema, v, pathExpr, lines, ctx, schemaPrefix)

  const types = schema.type ? (Array.isArray(schema.type) ? schema.type : [schema.type]) : null
  if (types) {
    const conds = types.map(t => {
      switch (t) {
        case 'object': return `(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v}))`
        case 'array': return `Array.isArray(${v})`
        case 'string': return `typeof ${v}==='string'`
        case 'number': return `Number.isFinite(${v})`
        case 'integer': return `Number.isInteger(${v})`
        case 'boolean': return `typeof ${v}==='boolean'`
        case 'null': return `${v}===null`
        default: return 'true'
      }
    })
    const expected = types.join(', ')
    // As written: a one-element array stays an array, as the interpreted engine
    // reports it.
    const expectedParam = !Array.isArray(schema.type) ? `'${types[0]}'` : JSON.stringify(types)
    {
      const typeSp = `${schemaPrefix}/type`
      const lit = buildErrorLiteral({ keyword: 'type', schemaPath: typeSp, sourceMap: ctx.sourceMap })
      lines.push(`if(!(${conds.join('||')})){_e.push({code:'${lit.codeStr}',keyword:'type',instancePath:${pathExpr||'""'},schemaPath:'${typeSp}'${ordinalField(ctx, `${typeSp}`)},params:{type:${expectedParam}},message:'must be ${expected}',docUrl:'${lit.docUrl}'${lit.frame}});if(!_all)return{valid:false,errors:_e}}`)
    }
  }

  // In error mode, never assume type — always guard (data may have failed type check but allErrors continues)
  const isObj = false
  const isArr = false
  const isStr = false
  const isNum = false

  const fail = (keyword, schemaSuffix, paramsCode, msgCode, fmt) => {
    const sp = schemaPrefix + '/' + schemaSuffix
    const lit = buildErrorLiteral({ keyword, format: fmt, schemaPath: sp, sourceMap: ctx.sourceMap })
    return `_e.push({code:'${lit.codeStr}',keyword:'${keyword}',instancePath:${pathExpr||'""'},schemaPath:'${sp}',params:${paramsCode},message:${msgCode},docUrl:'${lit.docUrl}'${lit.frame}${ordinalField(ctx, sp)}});if(!_all)return{valid:false,errors:_e}`
  }

  // enum
  if (schema.enum) {
    lines.push(`if(!(${enumCondition(ctx, schema.enum, v)})){${fail('enum', 'enum', `{allowedValues:${JSON.stringify(schema.enum)}}`, "'must be equal to one of the allowed values'")}}`)
  }

  // const — use canonical (sorted-key) comparison for objects
  if (schema.const !== undefined) {
    const cv = schema.const
    if (cv === null || typeof cv !== 'object') {
      lines.push(`if(${v}!==${JSON.stringify(cv)}){${fail('const', 'const', `{allowedValue:${JSON.stringify(schema.const)}}`, "'must be equal to constant'")}}`)
    } else {
      lines.push(`if(!${emitDeq(ctx)}(${v},${emitConstant(ctx, cv)})){${fail('const', 'const', `{allowedValue:${emitParamConstant(ctx, schema.const)}}`, "'must be equal to constant'")}}`)
    }
  }

  // required — no destructuring in error mode (data might not be an object)
  const requiredSet = new Set(schema.required || [])
  const hoisted = {}
  if (schema.required) {
    const reqSp = `${schemaPrefix}/required`
    const reqLit = buildErrorLiteral({ keyword: 'required', schemaPath: reqSp, sourceMap: ctx.sourceMap })
    for (const key of schema.required) {
      lines.push(`if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})&&!${ownKeyExpr(ctx, v, key)}){_e.push({code:'${reqLit.codeStr}',keyword:'required',instancePath:${pathExpr||'""'},schemaPath:'${reqSp}'${ordinalField(ctx, `${reqSp}`)},params:{missingProperty:'${esc(key)}'},message:"must have required property '${esc(key)}'",docUrl:'${reqLit.docUrl}'${reqLit.frame}});if(!_all)return{valid:false,errors:_e}}`)
    }
  }

  // numeric
  if (schema.minimum !== undefined) {
    const c = isNum ? `${v}<${schema.minimum}` : `typeof ${v}==='number'&&${v}<${schema.minimum}`
    lines.push(`if(${c}){${fail('minimum', 'minimum', `{comparison:'>=',limit:${schema.minimum}}`, `'must be >= ${schema.minimum}'`)}}`)
  }
  if (schema.maximum !== undefined) {
    const c = isNum ? `${v}>${schema.maximum}` : `typeof ${v}==='number'&&${v}>${schema.maximum}`
    lines.push(`if(${c}){${fail('maximum', 'maximum', `{comparison:'<=',limit:${schema.maximum}}`, `'must be <= ${schema.maximum}'`)}}`)
  }
  if (schema.exclusiveMinimum !== undefined) {
    const c = isNum ? `${v}<=${schema.exclusiveMinimum}` : `typeof ${v}==='number'&&${v}<=${schema.exclusiveMinimum}`
    lines.push(`if(${c}){${fail('exclusiveMinimum', 'exclusiveMinimum', `{comparison:'>',limit:${schema.exclusiveMinimum}}`, `'must be > ${schema.exclusiveMinimum}'`)}}`)
  }
  if (schema.exclusiveMaximum !== undefined) {
    const c = isNum ? `${v}>=${schema.exclusiveMaximum}` : `typeof ${v}==='number'&&${v}>=${schema.exclusiveMaximum}`
    lines.push(`if(${c}){${fail('exclusiveMaximum', 'exclusiveMaximum', `{comparison:'<',limit:${schema.exclusiveMaximum}}`, `'must be < ${schema.exclusiveMaximum}'`)}}`)
  }
  if (schema.multipleOf !== undefined) {
    const m = schema.multipleOf
    const ci = ctx.varCounter++
    // Use tolerance-based check for floating point (matches C++ behavior)
    lines.push(`{if(typeof ${v}==='number'&&${multipleOfBad(v, m)}){${fail('multipleOf', 'multipleOf', `{multipleOf:${m}}`, `'must be multiple of ${m}'`)}}}`)
  }

  // string length — same s.length fast paths as the boolean codegen above.
  // length < M → certain fail; length > 2*X → certain fail; sweet spot
  // 2*M <= length <= X passes without scanning. Only call _cpLen in the
  // uncertain band (caches it so it isn't called twice when both bounds are set).
  if (schema.minLength !== undefined) {
    const M = schema.minLength
    const inner = `${v}.length<${M}||(${v}.length<${M * 2}&&_cpLen(${v})<${M})`
    const c = isStr ? inner : `typeof ${v}==='string'&&(${inner})`
    lines.push(`if(${c}){${fail('minLength', 'minLength', `{limit:${M}}`, `'must NOT have fewer than ${M} characters'`)}}`)
  }
  if (schema.maxLength !== undefined) {
    const X = schema.maxLength
    const inner = `${v}.length>${X * 2}||(${v}.length>${X}&&_cpLen(${v})>${X})`
    const c = isStr ? inner : `typeof ${v}==='string'&&(${inner})`
    lines.push(`if(${c}){${fail('maxLength', 'maxLength', `{limit:${X}}`, `'must NOT have more than ${X} characters'`)}}`)
  }
  if (schema.pattern) {
    const inlineCheck = compilePatternInline(schema.pattern, v)
    if (inlineCheck) {
      const c = isStr ? `!(${inlineCheck})` : `typeof ${v}==='string'&&!(${inlineCheck})`
      lines.push(`if(${c}){${fail('pattern', 'pattern', `{pattern:${JSON.stringify(schema.pattern)}}`, JSON.stringify(`must match pattern "${schema.pattern}"`))}}`)
    } else {
      const pattern = JSON.stringify(schema.pattern);
      if (!ctx.regExpMap.has(pattern)) {
        const ri = ctx.varCounter++
        ctx.regExpMap.set(pattern, ri)
        if (useSafeEngine(schema.pattern)) {
          ctx.helperCode.push(`const _re${ri}=__ataSafeRe(${pattern})`)
          ctx.usesSafeRe = true
        } else {
          ctx.helperCode.push(`const _re${ri}=new RegExp(${pattern}${reFlagArg(pattern)})`)
        }
      }
      const ri = ctx.regExpMap.get(pattern);
      const c = isStr ? `!_re${ri}.test(${v})` : `typeof ${v}==='string'&&!_re${ri}.test(${v})`
      lines.push(`if(${c}){${fail('pattern', 'pattern', `{pattern:${JSON.stringify(schema.pattern)}}`, JSON.stringify(`must match pattern "${schema.pattern}"`))}}`)
    }
  }
  if (schema.format) {
    const fc = FORMAT_CODEGEN[schema.format]
    const fmtSp = `${schemaPrefix}/format`
    const fmtLit = buildErrorLiteral({ keyword: 'format', format: schema.format, schemaPath: fmtSp, sourceMap: ctx.sourceMap })
    const failPush = `_e.push({code:'${fmtLit.codeStr}',keyword:'format',instancePath:${pathExpr||'""'},schemaPath:'${fmtSp}'${ordinalField(ctx, `${fmtSp}`)},params:{format:'${esc(schema.format)}'},message:'must match format "${esc(schema.format)}"',docUrl:'${fmtLit.docUrl}'${fmtLit.frame}});if(!_all)return{valid:false,errors:_e}`
    // Format errors use the boolean codegen, each `return false` becoming an
    // error push. One violation reports once: the first failing statement
    // pushes and leaves the labeled block, where it used to fall through and
    // let every later statement of the same check push the same error again.
    if (fc) {
      const ri = ctx.varCounter++
      const fmtCode = fc(v, isStr, ctx).replace(/return false/g, `{${failPush};break _fmt${ri}}`)
      lines.push(`_fmt${ri}:{${fmtCode}}`)
    } else if (ctx.userFormats && typeof ctx.userFormats[schema.format] === 'function') {
      // User-supplied format checker on the error path: the same closure
      // plumbing as the boolean codegen. The function is bound as a parameter
      // of the compiled error function; bundle output serializes it via
      // Function#toString separately.
      const safeName = schema.format.replace(/[^a-zA-Z0-9_]/g, '_')
      const closureName = `_uf_${safeName}`
      if (ctx.closureVars && !ctx.closureVars.includes(closureName)) {
        ctx.closureVars.push(closureName)
        ctx.closureVals.push(ctx.userFormats[schema.format])
      }
      const guard = isStr ? '' : `typeof ${v}==='string'&&`
      lines.push(`if(${guard}!${closureName}(${v})){${failPush}}`)
    }
  }

  // array size
  if (schema.minItems !== undefined) {
    const c = isArr ? `${v}.length<${schema.minItems}` : `Array.isArray(${v})&&${v}.length<${schema.minItems}`
    lines.push(`if(${c}){${fail('minItems', 'minItems', `{limit:${schema.minItems}}`, `'must NOT have fewer than ${schema.minItems} items'`)}}`)
  }
  if (schema.maxItems !== undefined) {
    const c = isArr ? `${v}.length>${schema.maxItems}` : `Array.isArray(${v})&&${v}.length>${schema.maxItems}`
    lines.push(`if(${c}){${fail('maxItems', 'maxItems', `{limit:${schema.maxItems}}`, `'must NOT have more than ${schema.maxItems} items'`)}}`)
  }

  // uniqueItems — tiered: small primitive arrays use nested loop (no allocation)
  if (schema.uniqueItems) genUniqueItemsE(schema, v, pathExpr, lines, ctx, schemaPrefix, fail, isArr)

  // object size
  if (schema.minProperties !== undefined) {
    lines.push(`if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})&&Object.keys(${v}).length<${schema.minProperties}){${fail('minProperties', 'minProperties', `{limit:${schema.minProperties}}`, `'must NOT have fewer than ${schema.minProperties} properties'`)}}`)
  }
  if (schema.maxProperties !== undefined) {
    lines.push(`if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})&&Object.keys(${v}).length>${schema.maxProperties}){${fail('maxProperties', 'maxProperties', `{limit:${schema.maxProperties}}`, `'must NOT have more than ${schema.maxProperties} properties'`)}}`)
  }

  // additionalProperties: false. A key matched by any patternProperties
  // entry is not additional, so those patterns are consulted here as well.
  if (schema.additionalProperties === false) {
    const allowed = Object.keys(schema.properties || {}).map(k => `${JSON.stringify(k)}`).join(',')
    const ci = ctx.varCounter++
    const apSp = `${schemaPrefix}/additionalProperties`
    const apLit = buildErrorLiteral({ keyword: 'additionalProperties', schemaPath: apSp, sourceMap: ctx.sourceMap })
    const patChecks = []
    for (const pat of Object.keys(schema.patternProperties || {})) {
      const pattern = JSON.stringify(pat)
      if (!ctx.regExpMap.has(pattern)) {
        const ri = ctx.varCounter++
        ctx.regExpMap.set(pattern, ri)
        if (useSafeEngine(pat)) {
          ctx.helperCode.push(`const _re${ri}=__ataSafeRe(${pattern})`)
          ctx.usesSafeRe = true
        } else {
          ctx.helperCode.push(`const _re${ri}=new RegExp(${pattern}${reFlagArg(pattern)})`)
        }
      }
      patChecks.push(`_re${ctx.regExpMap.get(pattern)}.test(_k${ci}[_i])`)
    }
    const isAdditional = patChecks.length ? `!_a${ci}.has(_k${ci}[_i])&&!(${patChecks.join('||')})` : `!_a${ci}.has(_k${ci}[_i])`
    // Same shape as the combined generator: a for-in says whether anything is
    // extra without allocating, and the keys are materialised only to name one.
    // This function walks every node of a document that failed anywhere, so on a
    // large array the clean items were each paying for a key array.
    const gateChecks = patChecks.map((c) => c.split(`_k${ci}[_i]`).join(`_f${ci}`))
    const gateTest = gateChecks.length ? `!_a${ci}.has(_f${ci})&&!(${gateChecks.join('||')})` : `!_a${ci}.has(_f${ci})`
    const detail = `const _k${ci}=Object.keys(${v});for(let _i=0;_i<_k${ci}.length;_i++){if(${isAdditional}){_e.push({code:'${apLit.codeStr}',keyword:'additionalProperties',instancePath:${pathExpr||'""'},schemaPath:'${apSp}'${ordinalField(ctx, `${apSp}`)},params:{additionalProperty:_k${ci}[_i]},message:'must NOT have additional properties',docUrl:'${apLit.docUrl}'${apLit.frame}});if(!_all)return{valid:false,errors:_e}}}`
    // The name set is built once per call of the error function, not at every
    // object it checks: on a list of 1723 tokens it was 1723 Sets.
    ctx.helperCode.push(`const _a${ci}=new Set([${allowed}])`)
    const inner = `let _x${ci}=0;for(const _f${ci} in ${v}){if(${gateTest}){_x${ci}=1;break}}if(_x${ci}){${detail}}`
    lines.push(isObj ? `{${inner}}` : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){${inner}}`)
  }

  // unevaluatedProperties: false, on a node where it is provably its plain
  // counterpart (the bail above guaranteed that for every occurrence). With
  // additionalProperties present everything is evaluated and there is nothing
  // to emit. The error keeps the keyword's own identity: the interpreted
  // engine reports these as unevaluatedProperties with the key named, and the
  // two engines are pinned to identical output.
  // Inside the combined function (a oneOf or anyOf branch, see
  // emitBranchCollapse) this generator only has the static form. A branch
  // whose evaluated set depends on its own branches would report the wrong
  // errors, and the collapse would pick the wrong closest branch; declined.
  if (ctx.inCombined && schema.unevaluatedProperties !== undefined && schema.unevaluatedProperties !== true && !unevalLocalOk(schema, 'unevaluatedProperties')) throw DECLINE
  if (ctx.inCombined && schema.unevaluatedItems !== undefined && schema.unevaluatedItems !== true && !unevalLocalOk(schema, 'unevaluatedItems')) throw DECLINE
  if (schema.unevaluatedProperties === false && schema.additionalProperties === undefined) genUnevaluatedFalseE(schema, v, pathExpr, lines, ctx, schemaPrefix, isObj)

  // unevaluatedItems: false under the same rule. The interpreted engine
  // reports one error for the array with the first unevaluated position as
  // the limit; with adjacent `items` everything is evaluated. The draft-07
  // array form of items acts as the prefix.
  if (schema.unevaluatedItems === false) genUnevaluatedItemsFalseE(schema, v, pathExpr, lines, ctx, schemaPrefix)

  // dependentRequired
  if (schema.dependentRequired) {
    const drSp = `${schemaPrefix}/dependentRequired`
    const drLit = buildErrorLiteral({ keyword: 'dependentRequired', schemaPath: drSp, sourceMap: ctx.sourceMap })
    for (const [key, deps] of Object.entries(schema.dependentRequired)) {
      for (const dep of deps) {
        lines.push(`if(typeof ${v}==='object'&&${v}!==null&&${ownKeyExpr(ctx, v, key)}&&!${ownKeyExpr(ctx, v, dep)}){_e.push({code:'${drLit.codeStr}',keyword:'required',instancePath:${pathExpr||'""'},schemaPath:'${drSp}'${ordinalField(ctx, `${drSp}`)},params:{missingProperty:'${esc(dep)}'},message:"must have required property '${esc(dep)}'",docUrl:'${drLit.docUrl}'${drLit.frame}});if(!_all)return{valid:false,errors:_e}}`)
      }
    }
  }

  // properties — always guard (error mode, data may not be an object or may be array)
  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      const childPath = childPathExpr(pathExpr, ptrSeg(key))
      lines.push(`if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})&&${ownKeyExpr(ctx, v, key)}){`)
      genCodeE(prop, `${v}[${JSON.stringify(key)}]`, childPath, lines, ctx, schemaPrefix+'/properties/'+ptrSeg(key))
      lines.push(`}`)
    }
  }

  // patternProperties
  if (schema.patternProperties) genPatternPropertiesE(schema, v, pathExpr, lines, ctx, schemaPrefix)

  // additionalProperties as a schema — validate each property not declared in
  // `properties` against the subschema, with a dynamic /<key> path. codegenSafe
  // guarantees no patternProperties or composition here, so "additional" is
  // simply "not declared".
  if (typeof schema.additionalProperties === 'object' && schema.additionalProperties !== null) genAdditionalSchemaE(schema, v, pathExpr, lines, ctx, schemaPrefix)

  // dependentSchemas
  if (schema.dependentSchemas) genDependentSchemasE(schema, v, pathExpr, lines, ctx, schemaPrefix)

  // propertyNames: false reports every key, at the key's own path, the way the
  // interpreter does (plan-compiler: instancePath + '/' + key).
  if (schema.propertyNames === false) genPropertyNamesFalseE(schema, v, pathExpr, lines, ctx, schemaPrefix)

  // propertyNames
  if (schema.propertyNames && typeof schema.propertyNames === 'object') genPropertyNamesE(schema, v, pathExpr, lines, ctx, schemaPrefix, fail)

  // items — starts after prefixItems (Draft 2020-12 semantics)
  if (schema.items !== undefined && schema.items !== true) {
    const startIdx = schema.prefixItems ? schema.prefixItems.length : 0
    const idx = `_j${ctx.varCounter}`
    const elem = `_ei${ctx.varCounter}`
    ctx.varCounter++
    const childPath = childPathDynExpr(pathExpr, idx)
    lines.push(`if(Array.isArray(${v})){for(let ${idx}=${startIdx};${idx}<${v}.length;${idx}++){const ${elem}=${v}[${idx}]`)
    genCodeE(schema.items, elem, childPath, lines, ctx, schemaPrefix+'/items')
    lines.push(`}}`)
  }

  // prefixItems
  if (schema.prefixItems) genPrefixItemsE(schema, v, pathExpr, lines, ctx, schemaPrefix)

  // contains
  if (schema.contains !== undefined) genContainsE(schema, v, pathExpr, lines, ctx, schemaPrefix, fail)

  // allOf
  if (schema.allOf) {
    for (let _ai = 0; _ai < schema.allOf.length; _ai++) {
      genCodeE(schema.allOf[_ai], v, pathExpr, lines, ctx, schemaPrefix+'/allOf/'+_ai)
    }
  }

  // anyOf - collapse to single best-branch error via __ataCollapse
  if (schema.anyOf) genAnyOfE(schema, v, pathExpr, lines, ctx, schemaPrefix)

  // oneOf - collapse to single best-branch error via __ataCollapse
  if (schema.oneOf) genOneOfE(schema, v, pathExpr, lines, ctx, schemaPrefix)

  // not
  if (schema.not !== undefined) genNotE(schema, v, pathExpr, lines, ctx, schemaPrefix, fail)

  // if/then/else
  if (schema.if !== undefined) genIfE(schema, v, pathExpr, lines, ctx, schemaPrefix)
}

// Rarely used keyword families of genCodeENode, kept out of it so their compile is
// paid only by schemas that use them.

function genDynamicRefE(schema, v, pathExpr, lines, ctx, schemaPrefix) {
  const anchorKey = schema.$dynamicRef.startsWith('#') ? schema.$dynamicRef : '#' + schema.$dynamicRef
  if (ctx.anchors && ctx.anchors[anchorKey]) {
    const target = ctx.anchors[anchorKey]
    if (target === ctx.rootSchema) {
      // Self-recursive: generate _validateE call
      ctx.usesRecursion = true
      lines.push(`_validateE(${v},_all,_e)`)
    } else {
      const refKey = '$dynamicRef:' + anchorKey
      if (!ctx.refStack.has(refKey)) {
        ctx.refStack.add(refKey)
        genCodeE(target, v, pathExpr, lines, ctx, schemaPrefix)
        ctx.refStack.delete(refKey)
      }
    }
  }
}

function genUniqueItemsE(schema, v, pathExpr, lines, ctx, schemaPrefix, fail, isArr) {
  const si = ctx.varCounter++
  const failExpr = (iVar, jVar) => fail('uniqueItems', 'uniqueItems', `{i:${iVar},j:${jVar}}`, `'must NOT have duplicate items (items ## '+${jVar}+' and '+${iVar}+' are identical)'`)
  // Only reached once the verdict has rejected, or when errors are wanted, so
  // one strategy for every item type: the hoisted pair finder. See UQP_HELPER.
  const inner = `const _j${si}=${emitUqp(ctx)}(${v});if(_j${si}>=0){const _i${si}=_uqpI;${failExpr('_i' + si, '_j' + si)}}`
  lines.push(isArr ? `{${inner}}` : `if(Array.isArray(${v})){${inner}}`)
}

function genUnevaluatedFalseE(schema, v, pathExpr, lines, ctx, schemaPrefix, isObj) {
  const allowedU = Object.keys(schema.properties || {}).map(k => `${JSON.stringify(k)}`).join(',')
  const ui = ctx.varCounter++
  const upSp = `${schemaPrefix}/unevaluatedProperties`
  const upLit = buildErrorLiteral({ keyword: 'unevaluatedProperties', schemaPath: upSp, sourceMap: ctx.sourceMap })
  const patChecksU = []
  for (const pat of Object.keys(schema.patternProperties || {})) {
    const pattern = JSON.stringify(pat)
    if (!ctx.regExpMap.has(pattern)) {
      const ri = ctx.varCounter++
      ctx.regExpMap.set(pattern, ri)
      if (useSafeEngine(pat)) {
        ctx.helperCode.push(`const _re${ri}=__ataSafeRe(${pattern})`)
        ctx.usesSafeRe = true
      } else {
        ctx.helperCode.push(`const _re${ri}=new RegExp(${pattern}${reFlagArg(pattern)})`)
      }
    }
    patChecksU.push(`_re${ctx.regExpMap.get(pattern)}.test(_k${ui}[_i])`)
  }
  const isUneval = patChecksU.length ? `!_a${ui}.has(_k${ui}[_i])&&!(${patChecksU.join('||')})` : `!_a${ui}.has(_k${ui}[_i])`
  ctx.helperCode.push(`const _a${ui}=new Set([${allowedU}])`)
  const innerU = `const _k${ui}=Object.keys(${v});for(let _i=0;_i<_k${ui}.length;_i++){if(${isUneval}){_e.push({code:'${upLit.codeStr}',keyword:'unevaluatedProperties',instancePath:${pathExpr||'""'},schemaPath:'${upSp}'${ordinalField(ctx, `${upSp}`)},params:{unevaluatedProperty:_k${ui}[_i]},message:'must NOT have unevaluated properties',docUrl:'${upLit.docUrl}'${upLit.frame}});if(!_all)return{valid:false,errors:_e}}}`
  lines.push(isObj ? `{${innerU}}` : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){${innerU}}`)
}

function genUnevaluatedItemsFalseE(schema, v, pathExpr, lines, ctx, schemaPrefix) {
  const itemsIsPrefix = Array.isArray(schema.items)
  const allEval = schema.items !== undefined && !itemsIsPrefix
  if (!allEval) {
    const plen = itemsIsPrefix ? schema.items.length : (Array.isArray(schema.prefixItems) ? schema.prefixItems.length : 0)
    const uiSp = `${schemaPrefix}/unevaluatedItems`
    const uiLit = buildErrorLiteral({ keyword: 'unevaluatedItems', schemaPath: uiSp, sourceMap: ctx.sourceMap })
    lines.push(`if(Array.isArray(${v})&&${v}.length>${plen}){_e.push({code:'${uiLit.codeStr}',keyword:'unevaluatedItems',instancePath:${pathExpr||'""'},schemaPath:'${uiSp}'${ordinalField(ctx, `${uiSp}`)},params:{limit:${plen}},message:'must NOT have more than ${plen} items',docUrl:'${uiLit.docUrl}'${uiLit.frame}});if(!_all)return{valid:false,errors:_e}}`)
  }
}

function genPatternPropertiesE(schema, v, pathExpr, lines, ctx, schemaPrefix) {
  for (const [pat, sub] of Object.entries(schema.patternProperties)) {
    const pattern = JSON.stringify(pat);
    if (!ctx.regExpMap.has(pattern)) {
      const ri = ctx.varCounter++
      ctx.regExpMap.set(pattern, ri)
      if (useSafeEngine(pat)) {
        ctx.helperCode.push(`const _re${ri}=__ataSafeRe(${pattern})`);
        ctx.usesSafeRe = true
      } else {
        ctx.helperCode.push(`const _re${ri}=new RegExp(${pattern}${reFlagArg(pattern)})`);
      }
    }
    const ri = ctx.regExpMap.get(pattern);
    const ki = ctx.varCounter++
    lines.push(`if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){for(const _k${ki} in ${v}){if(_re${ri}.test(_k${ki})){`)
    const _peFn = emitPtrEsc(ctx)
    const p = pathExpr ? `${pathExpr}+'/'+${_peFn}(_k${ki})` : `'/'+${_peFn}(_k${ki})`
    // The real pointer, so source maps can locate the failing keyword.
    genCodeE(sub, `${v}[_k${ki}]`, p, lines, ctx, schemaPrefix + '/patternProperties/' + ptrSeg(pat))
    lines.push(`}}}`)
  }
}

function genAdditionalSchemaE(schema, v, pathExpr, lines, ctx, schemaPrefix) {
  const ki = ctx.varCounter++
  const known = Object.keys(schema.properties || {})
  if (known.length) ctx.helperCode.push(`const _ak${ki}=new Set([${known.map((k) => JSON.stringify(k)).join(',')}])`)
  const guard = ''
  // A key matched by any patternProperties entry is not additional.
  const patTests = []
  for (const pat of Object.keys(schema.patternProperties || {})) {
    const pattern = JSON.stringify(pat)
    if (!ctx.regExpMap.has(pattern)) {
      const ri = ctx.varCounter++
      ctx.regExpMap.set(pattern, ri)
      if (useSafeEngine(pat)) {
        ctx.helperCode.push(`const _re${ri}=__ataSafeRe(${pattern})`)
        ctx.usesSafeRe = true
      } else {
        ctx.helperCode.push(`const _re${ri}=new RegExp(${pattern}${reFlagArg(pattern)})`)
      }
    }
    patTests.push(`_re${ctx.regExpMap.get(pattern)}.test(_k${ki})`)
  }
  const conds = []
  if (known.length) conds.push(`!_ak${ki}.has(_k${ki})`)
  if (patTests.length) conds.push(`!(${patTests.join('||')})`)
  const keep = conds.length ? `if(${conds.join('&&')}){` : `{`
  lines.push(`if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){${guard}for(const _k${ki} in ${v}){${keep}`)
  const _peFn = emitPtrEsc(ctx)
  const p = pathExpr ? `${pathExpr}+'/'+${_peFn}(_k${ki})` : `'/'+${_peFn}(_k${ki})`
  genCodeE(schema.additionalProperties, `${v}[_k${ki}]`, p, lines, ctx, schemaPrefix + '/additionalProperties')
  lines.push(`}}}`)
}

function genDependentSchemasE(schema, v, pathExpr, lines, ctx, schemaPrefix) {
  for (const [key, depSchema] of Object.entries(schema.dependentSchemas)) {
    lines.push(`if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})&&${ownKeyExpr(ctx, v, key)}){`)
    genCodeE(depSchema, v, pathExpr, lines, ctx, schemaPrefix+'/dependentSchemas/'+ptrSeg(key))
    lines.push(`}`)
  }
}

function genPropertyNamesFalseE(schema, v, pathExpr, lines, ctx, schemaPrefix) {
  const ki = ctx.varCounter++
  // The subschema is applied to the property NAME, so the failure belongs to
  // the object that carries the name, not to `/<key>`, which is where the
  // value lives. Same placement as the object-valued propertyNames branch.
  const p = pathExpr || '""'
  lines.push(`if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){for(const _k${ki} in ${v}){_e.push({keyword:'not',instancePath:${p},schemaPath:'${schemaPrefix}/propertyNames'${ordinalField(ctx, `${schemaPrefix}/propertyNames`)},params:{},message:'boolean schema is false'});if(!_all)return{valid:false,errors:_e}}}`)
}

function genPropertyNamesE(schema, v, pathExpr, lines, ctx, schemaPrefix, fail) {
  const pn = schema.propertyNames
  const ki = ctx.varCounter++
  lines.push(`if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){for(const _k${ki} in ${v}){`)
  // The subschema checks the key as a value, and its errors are reported at
  // the object, as the interpreter reports them.
  if (!isSimplePN(pn)) {
    genCodeE(pn, `_k${ki}`, pathExpr, lines, ctx, schemaPrefix + '/propertyNames')
    lines.push(`}}`)
    return
  }
  if (pn.minLength !== undefined) {
    lines.push(`if(_k${ki}.length<${pn.minLength}){${fail('minLength', 'propertyNames/minLength', `{limit:${pn.minLength}}`, `'must NOT have fewer than ${pn.minLength} characters'`)}}`)
  }
  if (pn.maxLength !== undefined) {
    lines.push(`if(_k${ki}.length>${pn.maxLength}){${fail('maxLength', 'propertyNames/maxLength', `{limit:${pn.maxLength}}`, `'must NOT have more than ${pn.maxLength} characters'`)}}`)
  }
  if (pn.pattern) {
    const pattern = JSON.stringify(pn.pattern);
    if (!ctx.regExpMap.has(pattern)) {
      const ri = ctx.varCounter++
      ctx.regExpMap.set(pattern, ri)
      if (useSafeEngine(pn.pattern)) {
        ctx.helperCode.push(`const _re${ri}=__ataSafeRe(${pattern})`);
        ctx.usesSafeRe = true
      } else {
        ctx.helperCode.push(`const _re${ri}=new RegExp(${pattern}${reFlagArg(pattern)})`);
      }
    }
    const ri = ctx.regExpMap.get(pattern);
    lines.push(`if(!_re${ri}.test(_k${ki})){${fail('pattern', 'propertyNames/pattern', `{pattern:${JSON.stringify(pn.pattern)}}`, JSON.stringify(`must match pattern "${pn.pattern}"`))}}`)
  }
  if (pn.const !== undefined) {
    lines.push(`if(_k${ki}!==${JSON.stringify(pn.const)}){${fail('const', 'propertyNames/const', `{allowedValue:${JSON.stringify(pn.const)}}`, "'must be equal to constant'")}}`)
  }
  if (pn.enum) {
    const ei = ctx.varCounter++
    ctx.helperCode.push(`const _es${ei}=new Set(${JSON.stringify(pn.enum)})`)
    lines.push(`if(!_es${ei}.has(_k${ki})){${fail('enum', 'propertyNames/enum', `{allowedValues:${JSON.stringify(pn.enum)}}`, "'must be equal to one of the allowed values'")}}`)
  }
  lines.push(`}}`)
}

function genPrefixItemsE(schema, v, pathExpr, lines, ctx, schemaPrefix) {
  for (let i = 0; i < schema.prefixItems.length; i++) {
    const childPath = childPathExpr(pathExpr, String(i))
    lines.push(`if(Array.isArray(${v})&&${v}.length>${i}){`)
    genCodeE(schema.prefixItems[i], `${v}[${i}]`, childPath, lines, ctx, schemaPrefix+'/prefixItems/'+i)
    lines.push(`}`)
  }
}

function genContainsE(schema, v, pathExpr, lines, ctx, schemaPrefix, fail) {
  const ci = ctx.varCounter++
  const subLines = []
  nestedGenCode(schema.contains, `_cv`, subLines, ctx)
  const fnBody = subLines.length === 0 ? `return true` : `${subLines.join(';')};return true`
  const minC = schema.minContains !== undefined ? schema.minContains : 1
  const maxC = schema.maxContains
  lines.push(`if(Array.isArray(${v})){const _cf${ci}=function(_cv){${fnBody}};let _cc${ci}=0;for(let _ci${ci}=0;_ci${ci}<${v}.length;_ci${ci}++){if(_cf${ci}(${v}[_ci${ci}]))_cc${ci}++}`)
  lines.push(`if(_cc${ci}<${minC}){${fail('contains', 'contains', `{minContains:${minC}}`, `'must contain at least ${minC} valid item(s)'`)}}`)
  if (maxC !== undefined) {
    lines.push(`if(_cc${ci}>${maxC}){${fail('contains', 'contains', `{minContains:${minC},maxContains:${maxC}}`, `'must NOT contain more than ${maxC} valid item(s)'`)}}`)
  }
  lines.push(`}`)
}

function genAnyOfE(schema, v, pathExpr, lines, ctx, schemaPrefix) {
  emitBranchCollapse(schema.anyOf, 'anyOf', v, pathExpr, lines, ctx, schemaPrefix)
}

function genOneOfE(schema, v, pathExpr, lines, ctx, schemaPrefix) {
  emitBranchCollapse(schema.oneOf, 'oneOf', v, pathExpr, lines, ctx, schemaPrefix)
}

function genNotE(schema, v, pathExpr, lines, ctx, schemaPrefix, fail) {
  const subLines = []
  nestedGenCode(schema.not, '_nv', subLines, ctx)
  const nfn = subLines.length === 0 ? `function(_nv){return true}` : `function(_nv){${subLines.join(';')};return true}`
  const fi = ctx.varCounter++
  lines.push(`{const _nf${fi}=${nfn};if(_nf${fi}(${v})){${fail('not', 'not', '{}', "'must NOT be valid'")}}}`)
}

function genIfE(schema, v, pathExpr, lines, ctx, schemaPrefix) {
  const ifLines = []
  nestedGenCode(schema.if, '_iv', ifLines, ctx)
  const fi = ctx.varCounter++
  const ifFn = ifLines.length === 0
    ? `function(_iv){return true}`
    : `function(_iv){${ifLines.join(';')};return true}`
  lines.push(`{const _if${fi}=${ifFn}`)
  if (schema.then !== undefined) {
    lines.push(`if(_if${fi}(${v})){`)
    genCodeE(schema.then, v, pathExpr, lines, ctx, schemaPrefix+'/then')
    lines.push(`}`)
  }
  if (schema.else !== undefined) {
    lines.push(`${schema.then !== undefined ? 'else' : `if(!_if${fi}(${v}))`}{`)
    genCodeE(schema.else, v, pathExpr, lines, ctx, schemaPrefix+'/else')
    lines.push(`}`)
  }
  lines.push(`}`)
}

// --- Combined validator: single pass, validates + collects errors ---
// Returns VALID_RESULT for valid data, {valid:false, errors} for invalid.
// Avoids double-pass (jsFn → false → errFn runs same checks again).
// Uses type-aware optimizations: after type check passes, skip guards.
// An error literal the combined function shares between calls, frozen. Two
// non-enumerable fields ride along, invisible to Object.keys, spread and
// JSON: `_s` says the object is shared, so the reader copies it before handing
// it out (Object.isFrozen, the check it replaces, cost more than the copy),
// and `_o` is its schema ordinal, known here and otherwise looked up by path
// on every read. An `_o` the literal already carries, for standalone output,
// is kept. `_t` is an empty slot lib/enrich-error.js fills once.
function sharedErr (lit, rootSchema) {
  Object.defineProperty(lit, '_s', { value: true })
  // A slot the enrichment fills on the first read with the fields that depend
  // only on this literal (code, expected, rank), so later reads skip them.
  Object.defineProperty(lit, '_t', { value: {} })
  if (lit._o === undefined) {
    const o = ordinalFor(rootSchema, lit.schemaPath)
    if (typeof o === 'number') Object.defineProperty(lit, '_o', { value: o })
  }
  return Object.freeze(lit)
}

// The push for one error in the combined generator. With `ctx.rich` (the
// validator's errors are being read and enriched, see validator-core) the
// error is built in its final enriched shape where it happens, by makeRich in
// lib/enrich-site.js with a site record made here at compile time; otherwise
// it is the plain literal `lean` the generator always emitted. `valueExpr` is
// the value at `pathExpr`, which enrichment otherwise finds again by walking
// the document. `paramsShared` names a frozen params object hoisted for a
// static site, so a static error's params stay one shared object as before.
// The ordinal `_ap` is handed with each error of the combined function: the
// error's place in schema order when its path is fixed at compile time, -1
// when it is not (a path through a shared definition, a collapsed branch
// error, an enriched error). `_ap` keeps whether the list is still in order
// as it grows; a list that came out in order, which is most of them, is
// handed out without the sort that looked every error's path up in a map.
function apOrd (ctx, sp, coarse) {
  // Inside a shared definition's function every error takes the ordinal of
  // the reference that reached it, handed in as `_so`: errors behind one
  // `$ref` sort where the reference is written, in the order the definition
  // reports them.
  if (typeof sp === 'string' && sp.includes(SP_PLACEHOLDER) && ctx && ctx.inDefC) return '_so'
  if (typeof sp !== 'string' || sp.includes(SP_PLACEHOLDER) || sp.includes('+')) return -1
  if (!ctx || !ctx.rootSchema) return -1
  const path = unescapeSp(sp)
  const o = ordinalFor(ctx.rootSchema, path)
  if (typeof o !== 'number') return -1
  // The reader orders by ordinal and, between equal ordinals, by the rank of
  // the path (tieOrder in lib/rejections.js). Both are known here, so a site
  // gets a token that assignOrdKeys turns into a dense integer in exactly that
  // order when the program is assembled: two errors with one key are ones the
  // reader keeps as they came. Keyed by the ordinal alone, two errors under
  // one synthetic definition shared a key and sent every such list to the
  // reader, which ranked the paths again: 45 percent of reading a list
  // schema's two errors.
  if (!ctx.ordSites) ctx.ordSites = new Map()
  let site = ctx.ordSites.get(path)
  if (site === undefined) { site = { i: ctx.ordSites.size, o, r: rankFor(ctx.rootSchema, path), key: -1 }; ctx.ordSites.set(path, site) }
  // A coarse key, for the errors behind a reference into a shared definition
  // (see `ap` in lib/combined-runtime.js): -(k+2), written when k is known.
  return coarse ? `@@C${site.i}@@` : `@@O${site.i}@@`
}

// The dense keys of a program's error sites, in the reader's order: ordinal,
// then rank as tieOrder compares it, element by element and the shorter
// first; equal pairs share a key, and a site without a rank keeps -1, which
// hands its list to the reader. Replaces the tokens apOrd wrote.
function assignOrdKeys (ctx, src) {
  if (!ctx.ordSites || ctx.ordSites.size === 0) return src
  const sites = [...ctx.ordSites.values()]
  const cmp = (a, b) => {
    if (a.o !== b.o) return a.o - b.o
    const m = Math.min(a.r.length, b.r.length)
    for (let k = 0; k < m; k++) if (a.r[k] !== b.r[k]) return a.r[k] - b.r[k]
    return a.r.length - b.r.length
  }
  const ranked = sites.filter((x) => x.r !== null).sort(cmp)
  let key = 0
  for (let i = 0; i < ranked.length; i++) { if (i > 0 && cmp(ranked[i - 1], ranked[i]) !== 0) key++; ranked[i].key = key }
  return src.replace(/@@([OC])(\d+)@@/g, (_, t, i) => { const k = sites[+i].key; return String(t === 'O' || k < 0 ? k : -(k + 2)) })
}

// The error list and its order live in lib/combined-runtime.js (`ap`, `sr`):
// `_A` is this program's state, reset at the top of each call.
const AP_RESET = '_A.mo=true;_A.lo=-1;_A.on=0;'
function errPushC(ctx, keyword, sp, pathExpr, paramsCode, msgCode, valueExpr, lean, paramsShared) {
  if (!ctx.rich) return `(_e=_ap(_A,_e,${lean},${apOrd(ctx, sp)}))`
  if (!ctx.richMk) {
    ctx.richMk = true
    const { makeRich } = require('./enrich-site')
    ctx.closureVars.push('_mk'); ctx.closureVals.push(makeRich)
  }
  let paramsVal
  try { paramsVal = Function('return ' + paramsCode)() } catch { paramsVal = undefined }
  const fmt = keyword === 'format' && paramsVal ? paramsVal.format : undefined
  const { errorSite } = require('./enrich-site')
  const siteVar = `_S${ctx.varCounter++}`
  ctx.closureVars.push(siteVar)
  // Inside a shared definition (emitSharedDefC) the site holds the path past
  // the definition and the reference's own comes in as `_sp`.
  const rel = sp.startsWith(SP_PLACEHOLDER)
  ctx.closureVals.push(errorSite(keyword, unescapeSp(rel ? sp.slice(SP_PLACEHOLDER.length) : sp), paramsVal, fmt))
  return `(_e=_ap(_A,_e,_mk(${siteVar},${pathExpr || '""'},${paramsShared || paramsCode},${msgCode},${valueExpr},d${rel ? ',_sp' : ''}),-1))`
}

function compileToJSCombined(schema, VALID_RESULT, schemaMap, userFormats, opts) {
  const inputSchema = schema
  schema = prepareForCodegen(schema, schemaMap)
  // Same provably-local rule as the error generator above.
  if (typeof schema === 'object' && schema !== null) {
    const s = JSON.stringify(schema)
    // unevaluatedProperties and unevaluatedItems that are not provably local
    // are worked out at run time (genUnevaluatedDynamicC,
    // genUnevaluatedItemsDynamicC).
    // A schema that references itself, through `$ref: "#"` or a definition on
    // a cycle, has those references written as calls under the cycle guard
    // (emitDefFnC).
    // Bail on oneOf/anyOf — branch-collapse aggregation lives in genCodeE only.
    // Letting genCodeC emit the legacy "must match exactly one" placeholder
    // would short-circuit the ATA4001/ATA4002/ATA4003 contract. The boolean
    // fast path plus errFn fallback handles these schemas with collapse.
    // Branches are collapsed into one error by the error generator's emitter
    // (emitBranchCollapse). Its errors are plain, so the rich form, which
    // builds every error enriched where it fails, declines them.
    // In the rich form the collapsed error and its branch errors come out
    // plain (the branches are the error generator's) and are enriched when
    // presented; every other error is built enriched. See richBuilder.
  }
  if (typeof schema === 'boolean') {
    // A `false` root has one fixed error; the rich form leaves it to enrich.
    if (!schema && opts && (opts.rich || opts.resultShape)) return null
    if (opts && opts.resultShape) return null
    return schema
      ? () => VALID_RESULT
      : () => ({ valid: false, errors: [{ keyword: 'not', instancePath: '', schemaPath: '#', params: {}, message: 'boolean schema is false' }] })
  }
  if (typeof schema !== 'object' || schema === null) return null
  if (!sharedCodegenGate(schema, schemaMap)) return null
  if (schema.patternProperties) {
    for (const [pat, sub] of Object.entries(schema.patternProperties)) {
      if (typeof sub === 'object' && sub !== null && !codegenSafe(sub, schemaMap)) return null
    }
  }
  if (schema.dependentSchemas) {
    for (const sub of Object.values(schema.dependentSchemas)) {
      if (typeof sub === 'object' && sub !== null && !codegenSafe(sub, schemaMap)) return null
    }
  }
  if (schema.propertyNames && typeof schema.propertyNames === 'object' && !isSimplePN(schema.propertyNames) && !codegenSafe(schema.propertyNames, schemaMap)) return null

  // Build anchors map for $ref/#anchor and $dynamicRef resolution
  const cRootDefs = schema.$defs || schema.definitions || null
  const cAnchors = {}
  if (schema.$dynamicAnchor) cAnchors['#' + schema.$dynamicAnchor] = schema
  if (schema.$anchor) cAnchors['#' + schema.$anchor] = schema
  if (typeof schema.$id === 'string' && schema.$id.startsWith('#')) cAnchors[schema.$id] = schema
  if (cRootDefs) {
    for (const def of Object.values(cRootDefs)) {
      if (def && typeof def === 'object') {
        if (def.$dynamicAnchor) cAnchors['#' + def.$dynamicAnchor] = def
        if (def.$anchor) cAnchors['#' + def.$anchor] = def
        if (typeof def.$id === 'string' && def.$id.startsWith('#')) cAnchors[def.$id] = def
      }
    }
  }
  if (schemaMap) {
    for (const ext of schemaMap.values()) {
      if (ext && typeof ext === 'object') {
        if (ext.$dynamicAnchor && !cAnchors['#' + ext.$dynamicAnchor]) cAnchors['#' + ext.$dynamicAnchor] = ext
        if (ext.$anchor && !cAnchors['#' + ext.$anchor]) cAnchors['#' + ext.$anchor] = ext
        if (typeof ext.$id === 'string' && ext.$id.startsWith('#') && !cAnchors[ext.$id]) cAnchors[ext.$id] = ext
      }
    }
  }

  // The same two bails the boolean generator makes. Without them this path
  // emits nothing for a reference it cannot resolve or follow, and an empty
  // program is returned below as `() => VALID_RESULT`, so every constraint
  // behind the reference is dropped instead of the schema routing to the
  // interpreted engine.
  if (hasUnresolvableRef(schema, cRootDefs, cAnchors, schemaMap, new Set())) return null
  if (needsBaseTracking(schema, schemaMap, new Set())) return null

  // runtimeShape: errors without the ordinal, see compileToJSCodegenWithErrors.
  // `_ap` adds an error to a list that may not exist yet: the first one
  // creates it as a one-element literal. Pushing onto an empty `[]` grew its
  // backing store on every rejection, about 7% of reading errors across the
  // official suite.
  const ctx = { noOrdinal: !!(opts && opts.runtimeShape), rich: !!(opts && opts.rich), inCombined: true, hoisted: [], rootC: schema, varCounter: 0, preamble: [], helperCode: [], shared: [], closureVars: ['_cpLen', '_A', '_ap', '_sr', '_srX'], closureVals: [_cpLen, sharedRt().apState(), sharedRt().ap, sharedRt().sr, sharedRt().srX], sharedRuntime: true,
                rootDefs: cRootDefs, refStack: new Set(), schemaMap: schemaMap || null, anchors: cAnchors, rootSchema: inputSchema, userFormats: userFormats || null }
  const lines = []
  try {
    genCodeC(schema, 'd', '', lines, ctx, '#')
  } catch (e) {
    if (e === DECLINE) return null
    throw e
  }
  if (lines.length === 0) return () => VALID_RESULT

  // Use factory pattern: closure vars (regexes, etc.) created once, not per call.
  // The helpers are constants too and are declared in the factory: inside the
  // function they were rebuilt on every call. `__ataSafeRe` is bound when a
  // helper compiles a pattern through it, which the boolean generator does for
  // subschemas under not/if/contains; without the binding those threw a
  // ReferenceError on the first document that reached them.
  if (opts && opts.resultShape) {
    ctx.closureVars.push('_ER', '_EE', '_SRT', '_FB', '_VF')
    ctx.closureVals.push(opts.resultShape.Rejection, opts.resultShape.empty, opts.resultShape.sort, opts.resultShape.fallback, opts.resultShape.verdict || null)
  }
  if (ctx.usesBranchCollapse) bindRt(ctx, ['__ataCollapse', '__ataMulti'])
  const closureNames = ctx.usesSafeRe ? [...ctx.closureVars, '__ataSafeRe'] : ctx.closureVars
  const closureArgs = ctx.usesSafeRe ? [...ctx.closureVals, compileSafe] : ctx.closureVals
  const closureParams = closureNames.join(',')
  // A definition the error generator wrote as a named function inside a
  // branch (one on a cycle, or referenced from several places) reads the
  // cycle-guard state the error function declares. Here that state is
  // declared too, and the checks run as the error function runs them: in a
  // body of their own, again in the guarded mode when data turns out to
  // point back at itself. This used to decline, which left every schema
  // whose oneOf or anyOf branches reach a shared definition without one
  // pass.
  const guardList = [...(ctx.defFns ? ctx.defFns.values() : []), ...(ctx.cycFnsC || [])]
  const guardDefs = guardList.length ? guardList : null
  if (guardDefs) ctx.helperCode.unshift(emitGuardState())
  // Collapsed oneOf/anyOf: the helper the error generator embeds, `_all` for
  // the branch functions (this function collects everything), and the
  // runtime shape the error generator gives its literals, without code and
  // docUrl. The collapsed error itself keeps its code, as everywhere.
  if (ctx.usesBranchCollapse && opts && opts.runtimeShape) {
    const shape = (src) => src.replace(/code:'ATA\d{4}',/g, '').replace(/,docUrl:'https:\/\/ata-validator\.com\/e\/ATA\d{4}'/g, '')
    for (let i = 0; i < ctx.helperCode.length; i++) ctx.helperCode[i] = shape(ctx.helperCode[i])
    for (let i = 0; i < lines.length; i++) lines[i] = shape(lines[i])
  }
  // Lazy error array: no allocation for valid data (the common case)
  // resultShape: validate() itself for a validator whose errors are being read
  // (see validator-core): the result objects built here, so one pass decides,
  // collects and answers, with nothing between the caller and the checks.
  const rs = opts && opts.resultShape
  // Counts shared between a node's unevaluatedProperties and its anyOf and
  // oneOf (genUnevaluatedDynamicC), visible to every line of the function.
  let hoistDecl = ctx.hoisted.length ? `let ${ctx.hoisted.map((n) => n + '=null').join(',')};` : ''
  let checks = lines.join('\n  ')
  let allDecl = ctx.usesBranchCollapse ? 'const _all=true;' : ''
  if (guardDefs) {
    const clears = ['_stk.clear()'].concat(guardDefs.map((n) => `${n}_s.clear()`)).join(';')
    ctx.helperCode.push(`function _bodyC(d){${hoistDecl}${allDecl}let _e;\n  ${checks}\n  return _e}`)
    hoistDecl = ''
    allDecl = ''
    checks = `_sd=0;try{_e=_bodyC(d)}catch(_err){if(_err!==_CYC)throw _err;_sg=true;${clears};${AP_RESET}try{_e=_bodyC(d)}finally{_sg=false}}`
  }
  // In the result shape this function is validate() itself, so a document
  // that makes it throw is answered by the caller's previous path instead
  // (`_FB`). A thrown error reaching the caller is the one thing this form
  // must not add; a try that does not throw costs nothing measurable.
  const inner = rs
    // With collapsed branches, collecting runs every branch of every oneOf
    // and anyOf in full, which an accepted document does not need: the
    // verdict answers it first.
    // Not when every collapse is guarded by a count (emitBranchCollapse): an
    // accepted document then runs no branch twice, and a rejected one would
    // pay for the verdict for nothing.
    ? `try{${hoistDecl}${ctx.usesBranchCollapse && ctx.unguardedCollapse ? 'if(_VF!==null&&_VF(d))return{valid:true,data:d,errors:_EE};' : ''}${allDecl}let _e;${AP_RESET}\n  ` + checks +
      // A collapsed branch error is presented even alone (its ordinal and
      // raw branch errors stay inside); otherwise only a list of two or more
      // needs ordering.
      // The checked sort (_srX) compares with the reader, which a module
      // does not carry: there `_SRT` keeps the list as it is.
      `\n  return _e?new _ER(_A.mo?_e:${process.env.ATA_CHECK_SORT && !(opts && opts.emit) ? '_srX(_A,_e,_SRT)' : '_sr(_A,_e,_SRT)'}):${opts && opts.moduleShape ? 'R' : '{valid:true,data:d,errors:_EE}'}}catch(_x){return _FB(d)}`
    : hoistDecl + allDecl + `let _e;${AP_RESET}\n  ` + checks + `\n  return _e?{valid:false,errors:_e}:R`
  // The verdict generator's hoisted functions (subtreeGuard writes guards
  // through it) come first: a oneOf branch it could not hoist was a closure
  // built at every call of the guard, six per element of a json-patch list.
  const helpers = (ctx.preamble.length ? ctx.preamble.join('\n  ') + '\n  ' : '') + (ctx.helperCode.length ? ctx.helperCode.join('\n  ') + '\n  ' : '')

  try {
    if (typeof process !== 'undefined' && process.env && process.env.ATA_DUMP_CODEGEN) console.log('=== COMBINED CODEGEN ===\n' + helpers + inner + '\n=== CLOSURE VARS: ' + ctx.closureVars.length + ' ===')
    const programSrc = assignOrdKeys(ctx, `${helpers}return function _vC(d){${inner}}`)
    const factory = new Function('R' + (closureParams ? ',' + closureParams : ''), programSrc)
    const made = factory(VALID_RESULT, ...closureArgs)
    // For a standalone module (lib/aot-impl.js): the program's source and the
    // closure values it takes, after the function was built and tried on
    // three values, so a program that throws at once is never emitted.
    if (opts && opts.emit) {
      made({}); made(null); made(0)
      return { source: programSrc, names: ['R', ...closureNames], values: [VALID_RESULT, ...closureArgs], usesSafeRe: !!ctx.usesSafeRe }
    }
    return made
  } catch (e) {
    if (typeof process !== 'undefined' && process.env && process.env.ATA_DEBUG) console.error('compileToJSCombined error:', e.message, '\n', inner.slice(0, 500))
    return null
  }
}

// Combined code generator: type-aware like genCode, error-collecting like genCodeE.
// After type check passes → use optimizations (destructuring, no guards).
// If type check fails → push error, skip property checks (they'd crash).
// What of a node still applies to a value that failed its `type`, for the
// combined generator: the node without `type`, without what it emits outside
// the type block anyway (enum, const, anyOf, oneOf), and without the keywords
// of the declared types, which no value of another type meets. Null when
// nothing that validates is left.
const TYPE_KEYWORDS = {
  object: ['properties', 'patternProperties', 'additionalProperties', 'required', 'propertyNames', 'minProperties', 'maxProperties', 'dependentRequired', 'dependentSchemas', 'dependencies', 'unevaluatedProperties'],
  array: ['items', 'prefixItems', 'additionalItems', 'contains', 'minContains', 'maxContains', 'minItems', 'maxItems', 'uniqueItems', 'unevaluatedItems'],
  string: ['minLength', 'maxLength', 'pattern'],
  number: ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf'],
}
TYPE_KEYWORDS.integer = TYPE_KEYWORDS.number
const NOT_VALIDATING = new Set(['$schema', '$id', '$anchor', '$comment', '$defs', 'definitions', 'title', 'description', 'default', 'examples', 'deprecated', 'readOnly', 'writeOnly', '$vocabulary'])
function typeMismatchRest(schema, types) {
  const drop = new Set(['type', 'enum', 'const', 'anyOf', 'oneOf'])
  for (const t of types) for (const k of (TYPE_KEYWORDS[t] || [])) drop.add(k)
  // A non-integer number reaches the type block already (numberToo).
  let rest = null
  for (const k of Object.keys(schema)) {
    if (drop.has(k)) continue
    if (rest === null) rest = {}
    setOwn(rest, k, schema[k])
  }
  if (rest === null) return null
  // A node whose reference was already written (genCodeCNode) keeps that
  // mark, or the reference is written again here and its errors twice.
  if (schema[REF_DONE]) Object.defineProperty(rest, REF_DONE, { value: true })
  for (const k of Object.keys(rest)) if (!NOT_VALIDATING.has(k) && !k.startsWith('x-')) return rest
  return null
}

function genCodeC(schema, v, pathExpr, lines, ctx, schemaPrefix) {
  return withPlain(schema, v, lines, ctx, () => genCodeCNode(schema, v, pathExpr, lines, ctx, schemaPrefix))
}
// A definition referenced from several places, written once as a function
// and called at each reference, instead of its whole code at every one: the
// combined function of SchemaStore's cloud-run (48 KB of schema) came to
// 1.1 MB of source and sarif's (79 KB) to 2.8 MB, and compiling those was most
// of the 50 to 300 ms a first rejection with its errors read took. The body is
// generated against a placeholder schema path that becomes the `_sp` argument,
// as the error generator does (genCodeENode), so an error names the path it
// was reached by. It collects into its own list, returned to the caller, and
// declares its own branch counts (genUnevaluatedDynamicC). The document root
// comes in as `d` for the rich errors that read it. Not for a definition on a
// reference cycle, which keeps its existing path. False when not shared.
const COMBINED_DEF_FN_MIN = 160
const _defOwnChars = new WeakMap()
// The definition's own size, its annotations left out, measured once.
function defOwnChars (def) {
  if (def === null || typeof def !== 'object') return 0
  let n = _defOwnChars.get(def)
  if (n === undefined) {
    n = 0
    const walk = (x) => { if (x === null || typeof x !== 'object') { n += 6; return } if (Array.isArray(x)) { for (const y of x) walk(y); return } for (const k of Object.keys(x)) { if (SIZE_SKIPS.has(k)) continue; n += k.length + 4; walk(x[k]) } }
    walk(def)
    _defOwnChars.set(def, n)
  }
  return n
}

function emitSharedDefC(defName, v, pathExpr, lines, ctx, schemaPrefix) {
  if (!ctx.cyclicDefs) ctx.cyclicDefs = cyclicDefNames(ctx.rootDefs)
  if (!ctx.sharedDefs) ctx.sharedDefs = sharedDefNames(ctx.rootSchema, ctx.rootDefs)
  const cyclic = ctx.cyclicDefs.has(defName)
  // In the combined function every definition of some size is a function of
  // its own, referenced once or not: expanded, a 25-definition API schema
  // was one 122 KB function, which the optimizing compiler took tens of
  // thousands of calls to reach, so its first twenty thousand answers cost
  // 89 ns each where the hundred-thousandth costs 10. Functions the size of
  // one definition tier up early, and the hot ones first.
  if (!cyclic && !ctx.sharedDefs.has(defName) && !(ctx.inCombined && defOwnChars(ctx.rootDefs[defName]) >= COMBINED_DEF_FN_MIN)) return false
  emitDefFnC(defName, ctx.rootDefs[defName], cyclic, v, pathExpr, lines, ctx, schemaPrefix)
  return true
}

// One schema as a function of its own in the combined function (see
// emitSharedDefC). The name is registered before the body is written, so a
// reference back to it inside becomes a call. One that can re-enter itself,
// a definition on a cycle or the root through `$ref: "#"`, goes through the
// cycle guard the error generator's definitions use: depth counted, and in
// the guarded pass a value already being checked is not checked again.
function emitDefFnC(key, target, cyclic, v, pathExpr, lines, ctx, schemaPrefix) {
  if (!ctx.defFnsC) ctx.defFnsC = new Map()
  let fnName = ctx.defFnsC.get(key)
  if (!fnName) {
    fnName = '_defC' + ctx.defFnsC.size + '_' + (key === '#' ? 'root' : key.replace(/[^A-Za-z0-9_]/g, '_'))
    ctx.defFnsC.set(key, fnName)
    const outerHoisted = ctx.hoisted
    ctx.hoisted = []
    // The body is a function of its own: a reference the caller was in the
    // middle of expanding is not on the stack inside it, where reaching it
    // again is a call (this function, or another one) rather than a loop.
    // With the caller's stack, a definition expanded once on the way into
    // the root's function was taken for a cycle inside it, and the schema
    // (a tree whose nodes hold trees) lost its one-pass function.
    const outerRefs = ctx.refStack
    ctx.refStack = new Set()
    const bodyLines = []
    let hoisted
    try {
      ctx.inDefC = (ctx.inDefC || 0) + 1
      genCodeC(target, '_dv', '_p', bodyLines, ctx, SP_PLACEHOLDER)
    } finally {
      ctx.inDefC--
      hoisted = ctx.hoisted
      ctx.hoisted = outerHoisted
      ctx.refStack = outerRefs
    }
    let body = bodyLines.join('\n  ')
    body = body.split(`'${SP_PLACEHOLDER}`).join(`_sp+'`).split(`"${SP_PLACEHOLDER}`).join(`_sp+"`)
    if (body.includes(SP_PLACEHOLDER)) throw DECLINE
    const decl = hoisted.length ? `let ${hoisted.map((n) => n + '=null').join(',')};` : ''
    const fn = `function ${cyclic ? fnName + '_b' : fnName}(_dv,_p,_sp,d,_so){const _all=true;${decl}let _e;\n  ${body}\n  return _e}`
    if (cyclic) {
      if (!ctx.cycFnsC) ctx.cycFnsC = []
      ctx.cycFnsC.push(fnName)
      ctx.helperCode.push(
        `const ${fnName}_s=new Set()\n  function ${fnName}(_dv,_p,_sp,d,_so){\n  ` +
          `if(_sg){if(typeof _dv!=='object'||_dv===null)return ${fnName}_b(_dv,_p,_sp,d,_so);if(${fnName}_s.has(_dv))return;${fnName}_s.add(_dv);try{return ${fnName}_b(_dv,_p,_sp,d,_so)}finally{${fnName}_s.delete(_dv)}}\n  ` +
          `if(++_sd>${CYCLE_DEPTH})throw _CYC\n  const _r=${fnName}_b(_dv,_p,_sp,d,_so)\n  _sd--\n  return _r\n  }\n  ` + fn)
    } else {
      ctx.helperCode.push(fn)
    }
  }
  lines.push(`{const _r=${fnName}(${v},${pathExpr || '""'},'${schemaPrefix}',d,${apOrd(ctx, `${schemaPrefix}/$ref`, true)});if(_r!==undefined){if(_e===undefined)_e=_r;else for(let _i=0;_i<_r.length;_i++)_e.push(_r[_i])}}`)
}

const REF_DONE = Symbol('ata.refDone')
function genCodeCNode(schema, v, pathExpr, lines, ctx, schemaPrefix) {
  if (!schemaPrefix) schemaPrefix = '#'
  // Per-node, for the reason spelled out in genCode.
  let ppHandledPropertyNames = false
  if (schema === false) {
    // Leading semicolon: the previous generated line may end in an
    // expression, and a line starting with `(` would be parsed as a call.
    lines.push(';' + errPushC(ctx, 'not', schemaPrefix, pathExpr, '{}', "'boolean schema is false'", v, `{keyword:'not',instancePath:${pathExpr||'""'},schemaPath:'${schemaPrefix}'${ordinalField(ctx, `${schemaPrefix}`)},params:{},message:'boolean schema is false'}`))
    return
  }
  if (schema === true) return
  if (typeof schema !== 'object' || schema === null) return

  // $ref — resolve local, anchor, and cross-schema refs
  if (schema.$ref && !schema[REF_DONE]) {
    // A keyword beside $ref that validates applies too (2020-12; draft 7
    // drops such siblings when the schema is read). The reference is written
    // on its own, then the node again with the reference marked done, on a
    // fresh copy so the mark cannot reach the same schema object met through
    // another path; the copy keeps `$ref` for unevaluatedProperties and
    // unevaluatedItems, which read its annotations. Dropping the siblings
    // once accepted what they reject, which is why this declined. Not in a
    // branch function, which the error generator writes.
    if (Object.keys(schema).some((k) => !REF_NEUTRAL_SIBLINGS.has(k) && !k.startsWith('x-'))) {
      if (!ctx.inCombined || ctx.inBranchFn) throw DECLINE
      genCodeCNode({ $ref: schema.$ref }, v, pathExpr, lines, ctx, schemaPrefix)
      const rest = { ...schema }
      Object.defineProperty(rest, REF_DONE, { value: true })
      genCodeCNode(rest, v, pathExpr, lines, ctx, schemaPrefix)
      return
    }
    // A reference back into what is being expanded is a call to that
    // schema's function (emitDefFnC), never nothing: an expansion that stops
    // and emits no lines reads as valid.
    if (schema.$ref === '#') {
      if (ctx.inCombined && !ctx.inBranchFn && ctx.rootC) { emitDefFnC('#', ctx.rootC, true, v, pathExpr, lines, ctx, schemaPrefix); return }
      throw DECLINE
    }
    const m = schema.$ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/)
    if (m && ctx.rootDefs && ctx.rootDefs[m[1]]) {
      if (ctx.inCombined && !ctx.inBranchFn && emitSharedDefC(m[1], v, pathExpr, lines, ctx, schemaPrefix)) return
      if (ctx.refStack.has(schema.$ref)) throw DECLINE
      ctx.refStack.add(schema.$ref)
      genCodeC(ctx.rootDefs[m[1]], v, pathExpr, lines, ctx, schemaPrefix)
      ctx.refStack.delete(schema.$ref)
      return
    }
    // Anchor ref: "#foo" — resolve via rootDefs or anchors map
    if (!m && schema.$ref.startsWith('#') && !schema.$ref.startsWith('#/')) {
      const entry = ctx.rootDefs && ctx.rootDefs[schema.$ref]
      const anchorTarget = entry && entry.raw ? entry.raw : (ctx.anchors && ctx.anchors[schema.$ref])
      if (anchorTarget) {
        if (ctx.refStack.has(schema.$ref)) throw DECLINE
        ctx.refStack.add(schema.$ref)
        genCodeC(anchorTarget, v, pathExpr, lines, ctx, schemaPrefix)
        ctx.refStack.delete(schema.$ref)
        return
      }
    }
    if (ctx.schemaMap && ctx.schemaMap.has(schema.$ref)) {
      if (ctx.refStack.has(schema.$ref)) throw DECLINE
      ctx.refStack.add(schema.$ref)
      genCodeC(ctx.schemaMap.get(schema.$ref), v, pathExpr, lines, ctx, schemaPrefix)
      ctx.refStack.delete(schema.$ref)
      return
    }
    // Cross-schema ref with JSON pointer fragment ("<id>#/<path>")
    if (ctx.schemaMap && schema.$ref.includes('#') && !schema.$ref.startsWith('#')) {
      const r = resolveCrossSchemaRef(schema.$ref, ctx.schemaMap)
      if (r) {
        if (ctx.refStack.has(schema.$ref)) throw DECLINE
        ctx.refStack.add(schema.$ref)
        genCodeC(r.schema, v, pathExpr, lines, ctx, schemaPrefix)
        ctx.refStack.delete(schema.$ref)
        return
      }
    }
  }

  // $dynamicRef — resolve via anchors map
  if (schema.$dynamicRef) genDynamicRefC(schema, v, pathExpr, lines, ctx, schemaPrefix)

  const types = schema.type ? (Array.isArray(schema.type) ? schema.type : [schema.type]) : null
  let isObj = false, isArr = false, isStr = false, isNum = false

  // Pre-allocate error objects as closure variables for static paths.
  // This shrinks the generated function body → better V8 JIT on valid path.
  const isStaticPath = !pathExpr || (pathExpr.startsWith("'") && !pathExpr.includes('+'))
  const fail = (keyword, schemaSuffix, paramsCode, msgCode) => {
    const sp = schemaPrefix + '/' + schemaSuffix
    if (ctx.rich) {
      // A static site shares one frozen params object between calls, as its
      // hoisted literal does below; a dynamic one builds its params per call.
      let shared = null
      if (isStaticPath && msgCode.startsWith("'") && !msgCode.includes('+')) {
        let pv
        try { pv = Function('return ' + paramsCode)() } catch { pv = undefined }
        if (pv !== undefined) {
          shared = `_P${ctx.varCounter++}`
          ctx.closureVars.push(shared); ctx.closureVals.push(Object.freeze(pv))
        }
      }
      return errPushC(ctx, keyword, sp, pathExpr, paramsCode, msgCode, v, null, shared)
    }
    // Hoisting a static error as one shared literal keeps a function that
    // also answers accepted documents small. In the runtime shape this
    // function only runs for documents being rejected (the verdict is its own
    // function), and a shared literal has to be copied for the caller on
    // every read, so there it is written fresh.
    if (isStaticPath && !ctx.noOrdinal && msgCode.startsWith("'") && !msgCode.includes('+')) {
      // Try to evaluate paramsCode as a static constant
      let paramsVal
      try { paramsVal = Function('return ' + paramsCode)() } catch { /* dynamic params — fall through */ }
      if (paramsVal !== undefined) {
        // Static error: pre-allocate as frozen closure variable
        const ei = ctx.varCounter++
        const errVar = `_E${ei}`
        // The path and message are source literals; evaluate them rather than
        // strip the quotes, so an escaped quote or backslash in a key comes
        // out as the character and not as the escape.
        let pathVal, msgVal
        try {
          pathVal = pathExpr ? Function('return ' + pathExpr)() : ''
          msgVal = Function('return ' + msgCode)()
        } catch {
          // Not a literal that parses on its own (a key with a raw line break):
          // leave it to the inline form below, which declines the same way the
          // whole function would.
          pathVal = undefined
        }
        if (pathVal !== undefined) {
        const spVal = unescapeSp(sp)
        ctx.closureVars.push(errVar)
        const o = ctx.noOrdinal ? null : ordinalFor(ctx.rootSchema, spVal)
        const lit = {keyword, instancePath: pathVal, schemaPath: spVal, params: Object.freeze(paramsVal), message: msgVal}
        if (o !== null) lit._o = o
        ctx.closureVals.push(sharedErr(lit, ctx.rootSchema))
        return `(_e=_ap(_A,_e,${errVar},${apOrd(ctx, sp)}))`
        }
      }
    }
    // Dynamic path (e.g., array index): inline as before
    return `(_e=_ap(_A,_e,{keyword:'${keyword}',instancePath:${pathExpr||'""'},schemaPath:'${sp}',params:${paramsCode},message:${msgCode}${ordinalField(ctx, sp)}},${apOrd(ctx, sp)}))`
  }

  // enum and const apply to a value of any type, so a value that fails
  // `type` is still checked against them, as the other engines do. They sat
  // inside the type-success block, and `{type: 'number', enum: [1]}` reported
  // only `type` for 'x' where the interpreter reports both.
  const emitEnumConst = () => {
    // enum
    if (schema.enum) {
      lines.push(`if(!(${enumCondition(ctx, schema.enum, v)})){${fail('enum', 'enum', `{allowedValues:${JSON.stringify(schema.enum)}}`, "'must be equal to one of the allowed values'")}}`)
    }

    // const
    if (schema.const !== undefined) {
      const cv = schema.const
      if (cv === null || typeof cv !== 'object') {
        lines.push(`if(${v}!==${JSON.stringify(cv)}){${fail('const', 'const', `{allowedValue:${JSON.stringify(schema.const)}}`, "'must be equal to constant'")}}`)
      } else {
        lines.push(`if(!${emitDeq(ctx)}(${v},${emitConstant(ctx, cv)})){${fail('const', 'const', `{allowedValue:${emitParamConstant(ctx, schema.const)}}`, "'must be equal to constant'")}}`)
      }
    }
  }

  if (types) {
    const conds = types.map(t => {
      switch (t) {
        case 'object': return `(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v}))`
        case 'array': return `Array.isArray(${v})`
        case 'string': return `typeof ${v}==='string'`
        case 'number': return `Number.isFinite(${v})`
        case 'integer': return `Number.isInteger(${v})`
        case 'boolean': return `typeof ${v}==='boolean'`
        case 'null': return `${v}===null`
        default: return 'true'
      }
    })
    const expected = types.join(', ')
    // As written: a one-element array stays an array, as the interpreted engine
    // reports it.
    const expectedParam = !Array.isArray(schema.type) ? `'${types[0]}'` : JSON.stringify(types)
    // Type check: push error but continue — wrap remaining in type-success block
    const typeOk = `_tok${ctx.varCounter++}`
    lines.push(`const ${typeOk}=${conds.join('||')}`)
    lines.push(`if(!${typeOk}){${fail('type', 'type', `{type:${expectedParam}}`, `'must be ${expected}'`)}}`)
    // Subsequent optimized code runs inside if(typeOk){...}
    if (types.length === 1) {
      isObj = types[0] === 'object'
      isArr = types[0] === 'array'
      isStr = types[0] === 'string'
      isNum = types[0] === 'number' || types[0] === 'integer'
    }
    emitEnumConst()
    // A number that is not an integer fails `integer` and is still a number:
    // minimum, multipleOf and the rest apply to it, and the other engines
    // report them next to the type error. The block opens for any number.
    const numberToo = types.includes('integer') && !types.includes('number')
    lines.push(numberToo ? `if(${typeOk}||typeof ${v}==='number'){` : `if(${typeOk}){`)
  } else {
    emitEnumConst()
  }

  // required — use destructuring when type is object (SAFE because type check already passed)
  const requiredSet = new Set(schema.required || [])
  const hoisted = {}
  if (schema.required && schema.properties && isObj) {
    const destructKeys = []
    for (const key of schema.required) {
      if (schema.properties[key]) {
        const lv = `_h${ctx.varCounter++}`
        hoisted[key] = lv
        destructKeys.push(`${JSON.stringify(key)}:${lv}`)
      }
    }
    if (destructKeys.length > 0) {
      lines.push(`let{${destructKeys.join(',')}}=${v}`)
      // A value the object only inherits reads as absent, here and in the
      // property checks that use the same local below.
      for (const key of schema.required) {
        if (hoisted[key]) lines.push(`if(${hoisted[key]}!==undefined&&!${ownGuard(ctx, v, key)})${hoisted[key]}=undefined`)
      }
    }
    for (const key of schema.required) {
      const check = hoisted[key] ? `${hoisted[key]}===undefined` : `!${ownKeyExpr(ctx, v, key)}`
      if (isStaticPath && !ctx.rich && !ctx.noOrdinal) {
        const ei = ctx.varCounter++
        const errVar = `_E${ei}`
        const pathVal = pathExpr ? literalValue(pathExpr) : ''
        ctx.closureVars.push(errVar)
        ctx.closureVals.push(sharedErr({keyword: 'required', instancePath: pathVal, schemaPath: unescapeSp(`${schemaPrefix}/required`), params: Object.freeze({missingProperty: key}), message: `must have required property '${key}'`}, ctx.rootSchema))
        lines.push(`if(${check}){(_e=_ap(_A,_e,${errVar},${apOrd(ctx, `${schemaPrefix}/required`)}))}`)
      } else {
        lines.push(`if(${check}){${errPushC(ctx, 'required', `${schemaPrefix}/required`, pathExpr, `{missingProperty:'${esc(key)}'}`, `"must have required property '${esc(key)}'"`, v, `{keyword:'required',instancePath:${pathExpr||'""'},schemaPath:'${schemaPrefix}/required'${ordinalField(ctx, `${schemaPrefix}/required`)},params:{missingProperty:'${esc(key)}'},message:"must have required property '${esc(key)}'"}`)}}`)
      }
    }
  } else if (schema.required) {
    for (const key of schema.required) {
      const isStatic = !pathExpr || (pathExpr.startsWith("'") && !pathExpr.includes('+'))
      if (isStatic && !ctx.rich && !ctx.noOrdinal) {
        const ei = ctx.varCounter++
        const errVar = `_E${ei}`
        const pathVal = pathExpr ? literalValue(pathExpr) : ''
        ctx.closureVars.push(errVar)
        ctx.closureVals.push(sharedErr({keyword: 'required', instancePath: pathVal, schemaPath: unescapeSp(`${schemaPrefix}/required`), params: Object.freeze({missingProperty: key}), message: `must have required property '${key}'`}, ctx.rootSchema))
        lines.push(`if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})&&!${ownKeyExpr(ctx, v, key)}){(_e=_ap(_A,_e,${errVar},${apOrd(ctx, `${schemaPrefix}/required`)}))}`)
      } else {
        lines.push(`if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})&&!${ownKeyExpr(ctx, v, key)}){${errPushC(ctx, 'required', `${schemaPrefix}/required`, pathExpr, `{missingProperty:'${esc(key)}'}`, `"must have required property '${esc(key)}'"`, v, `{keyword:'required',instancePath:${pathExpr||'""'},schemaPath:'${schemaPrefix}/required'${ordinalField(ctx, `${schemaPrefix}/required`)},params:{missingProperty:'${esc(key)}'},message:"must have required property '${esc(key)}'"}`)}}`)
      }
    }
  }

  // numeric — skip type guard if known
  if (schema.minimum !== undefined) { const c = isNum ? `${v}<${schema.minimum}` : `typeof ${v}==='number'&&${v}<${schema.minimum}`; lines.push(`if(${c}){${fail('minimum', 'minimum', `{comparison:'>=',limit:${schema.minimum}}`, `'must be >= ${schema.minimum}'`)}}`) }
  if (schema.maximum !== undefined) { const c = isNum ? `${v}>${schema.maximum}` : `typeof ${v}==='number'&&${v}>${schema.maximum}`; lines.push(`if(${c}){${fail('maximum', 'maximum', `{comparison:'<=',limit:${schema.maximum}}`, `'must be <= ${schema.maximum}'`)}}`) }
  if (schema.exclusiveMinimum !== undefined) { const c = isNum ? `${v}<=${schema.exclusiveMinimum}` : `typeof ${v}==='number'&&${v}<=${schema.exclusiveMinimum}`; lines.push(`if(${c}){${fail('exclusiveMinimum', 'exclusiveMinimum', `{comparison:'>',limit:${schema.exclusiveMinimum}}`, `'must be > ${schema.exclusiveMinimum}'`)}}`) }
  if (schema.exclusiveMaximum !== undefined) { const c = isNum ? `${v}>=${schema.exclusiveMaximum}` : `typeof ${v}==='number'&&${v}>=${schema.exclusiveMaximum}`; lines.push(`if(${c}){${fail('exclusiveMaximum', 'exclusiveMaximum', `{comparison:'<',limit:${schema.exclusiveMaximum}}`, `'must be < ${schema.exclusiveMaximum}'`)}}`) }
  if (schema.multipleOf !== undefined) {
    const m = schema.multipleOf
    const ci = ctx.varCounter++
    lines.push(`{if(typeof ${v}==='number'&&${multipleOfBad(v, m)}){${fail('multipleOf', 'multipleOf', `{multipleOf:${m}}`, `'must be multiple of ${m}'`)}}}`)
  }

  // string length — s.length fast paths, _cpLen only in the uncertain band.
  if (schema.minLength !== undefined) {
    const M = schema.minLength
    const inner = `${v}.length<${M}||(${v}.length<${M * 2}&&_cpLen(${v})<${M})`
    const c = isStr ? inner : `typeof ${v}==='string'&&(${inner})`
    lines.push(`if(${c}){${fail('minLength', 'minLength', `{limit:${M}}`, `'must NOT have fewer than ${M} characters'`)}}`)
  }
  if (schema.maxLength !== undefined) {
    const X = schema.maxLength
    const inner = `${v}.length>${X * 2}||(${v}.length>${X}&&_cpLen(${v})>${X})`
    const c = isStr ? inner : `typeof ${v}==='string'&&(${inner})`
    lines.push(`if(${c}){${fail('maxLength', 'maxLength', `{limit:${X}}`, `'must NOT have more than ${X} characters'`)}}`)
  }
  if (schema.pattern) {
    const inlineCheck = compilePatternInline(schema.pattern, v)
    if (inlineCheck) {
      const c = isStr ? `!(${inlineCheck})` : `typeof ${v}==='string'&&!(${inlineCheck})`
      lines.push(`if(${c}){${fail('pattern', 'pattern', `{pattern:${JSON.stringify(schema.pattern)}}`, JSON.stringify(`must match pattern "${schema.pattern}"`))}}`)
    } else {
      const ri = ctx.varCounter++
      const reVar = `_re${ri}`
      ctx.closureVars.push(reVar)
      ctx.closureVals.push(useSafeEngine(schema.pattern) ? compileSafe(schema.pattern) : new RegExp(schema.pattern, reFlags(schema.pattern)))
      const c = isStr ? `!${reVar}.test(${v})` : `typeof ${v}==='string'&&!${reVar}.test(${v})`
      lines.push(`if(${c}){${fail('pattern', 'pattern', `{pattern:${JSON.stringify(schema.pattern)}}`, JSON.stringify(`must match pattern "${schema.pattern}"`))}}`)
    }
  }
  if (schema.format) {
    const fc = FORMAT_CODEGEN[schema.format]
    if (fc) {
      // Same rule as the error codegen: one violation, one error. The first
      // failing statement pushes and leaves the labeled block.
      const ri = ctx.varCounter++
      const code = fc(v, isStr, ctx).replace(/return false/g, `{${fail('format', 'format', `{format:'${esc(schema.format)}'}`, `'must match format "${esc(schema.format)}"'`)};break _fmt${ri}}`)
      lines.push(`_fmt${ri}:{${code}}`)
    } else if (ctx.userFormats && typeof ctx.userFormats[schema.format] === 'function') {
      const safeName = schema.format.replace(/[^a-zA-Z0-9_]/g, '_')
      const closureName = `_uf_${safeName}`
      if (!ctx.closureVars.includes(closureName)) {
        ctx.closureVars.push(closureName)
        ctx.closureVals.push(ctx.userFormats[schema.format])
      }
      const guard = isStr ? '' : `typeof ${v}==='string'&&`
      lines.push(`if(${guard}!${closureName}(${v})){${fail('format', 'format', `{format:'${esc(schema.format)}'}`, `'must match format "${esc(schema.format)}"'`)}}`)
    }
  }

  // array size
  if (schema.minItems !== undefined) { const c = isArr ? `${v}.length<${schema.minItems}` : `Array.isArray(${v})&&${v}.length<${schema.minItems}`; lines.push(`if(${c}){${fail('minItems', 'minItems', `{limit:${schema.minItems}}`, `'must NOT have fewer than ${schema.minItems} items'`)}}`) }
  if (schema.maxItems !== undefined) { const c = isArr ? `${v}.length>${schema.maxItems}` : `Array.isArray(${v})&&${v}.length>${schema.maxItems}`; lines.push(`if(${c}){${fail('maxItems', 'maxItems', `{limit:${schema.maxItems}}`, `'must NOT have more than ${schema.maxItems} items'`)}}`) }

  // uniqueItems — tiered: small primitive arrays use nested loop (no allocation)
  if (schema.uniqueItems) genUniqueItemsC(schema, v, pathExpr, lines, ctx, schemaPrefix, fail, isArr)

  // object size
  if (schema.minProperties !== undefined) lines.push(`if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})&&Object.keys(${v}).length<${schema.minProperties}){${fail('minProperties', 'minProperties', `{limit:${schema.minProperties}}`, `'must NOT have fewer than ${schema.minProperties} properties'`)}}`)
  if (schema.maxProperties !== undefined) lines.push(`if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})&&Object.keys(${v}).length>${schema.maxProperties}){${fail('maxProperties', 'maxProperties', `{limit:${schema.maxProperties}}`, `'must NOT have more than ${schema.maxProperties} properties'`)}}`)

  // additionalProperties — skip if patternProperties present (handled in unified loop below)
  // Small property sets: direct === chain (no Set allocation)
  if (schema.additionalProperties === false && !schema.patternProperties) {
    const propKeys = Object.keys(schema.properties || {})
    const ci = ctx.varCounter++
    // The error has to name the offending property, so the keys have to be
    // materialised to report one. They do not have to be materialised to find
    // out whether there is one: a for-in answers that with no allocation, and
    // an accepted document is the common case. The verdict generator pays a
    // bare key count here, and this kept the combined function 2.8x that on a
    // valid document, which is what stopped it from replacing the
    // verdict-then-revalidate pair on the error path.
    const detail = (test) =>
      `const _k${ci}=Object.keys(${v});for(let _i=0;_i<_k${ci}.length;_i++)if(${test}){${fail('additionalProperties', 'additionalProperties', `{additionalProperty:_k${ci}[_i]}`, "'must NOT have additional properties'")}}`
    let body
    if (propKeys.length <= 8) {
      // Direct chain: no Set allocation for small schemas
      // With nothing declared every key is additional: an empty chain would
      // leave `if()`, so the test is `true`.
      const gate = propKeys.map(k => `_f${ci}!==${JSON.stringify(k)}`).join('&&') || 'true'
      const checks = propKeys.map(k => `_k${ci}[_i]!==${JSON.stringify(k)}`).join('&&') || 'true'
      body = `let _x${ci}=0;for(const _f${ci} in ${v}){if(${gate}){_x${ci}=1;break}}if(_x${ci}){${detail(checks)}}`
    } else {
      // The name set lives in the closure, built once with the function: built
      // in the body it was a 33-name Set on every call of this function, which
      // is where a rejected npm-badges document spent most of its 701 ns.
      ctx.closureVars.push(`_a${ci}`)
      ctx.closureVals.push(new Set(propKeys))
      body = `let _x${ci}=0;for(const _f${ci} in ${v}){if(!_a${ci}.has(_f${ci})){_x${ci}=1;break}}if(_x${ci}){${detail(`!_a${ci}.has(_k${ci}[_i])`)}}`
    }
    // When every declared property is required, a clean object has exactly the
    // declared keys: if the enumerated count equals the declared count and
    // every declared name is there, the enumerated set is the declared set and
    // nothing is extra. That is the verdict generator's count, and it skips
    // comparing each key against every name, which kept this function over
    // twice the verdict's cost on an accepted document. Anything else, a
    // different count or a missing name, falls through to the scan, which
    // names the extra keys. A name Object.prototype carries answers `in`
    // through the prototype without being enumerated, so those stay on the
    // scan.
    const req = new Set(Array.isArray(schema.required) ? schema.required : [])
    if (propKeys.length > 0 && propKeys.every((k) => req.has(k) && !PROTO_NAMES.has(k))) {
      const present = propKeys.map((k) => `${JSON.stringify(k)} in ${v}`).join('&&')
      body = `let _n${ci}=0;for(const _f${ci} in ${v})_n${ci}++;if(_n${ci}!==${propKeys.length}||!(${present})){${body}}`
    }
    lines.push(isObj
      ? `{${body}}`
      : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){${body}}`)
  }

  // unevaluatedProperties: false where it is provably additionalProperties
  // (the entry bail guaranteed that), keeping the keyword's own identity so
  // the two engines report the same error.
  if (schema.unevaluatedProperties !== undefined && schema.unevaluatedProperties !== true) {
    if (unevalLocalOk(schema, 'unevaluatedProperties')) {
      if (schema.additionalProperties === undefined && !schema.patternProperties) genUnevaluatedFalseC(schema, v, pathExpr, lines, ctx, schemaPrefix, fail, isObj)
    } else {
      genUnevaluatedDynamicC(schema, v, pathExpr, lines, ctx, schemaPrefix, fail, isObj)
    }
  }

  // unevaluatedItems: false under the same rule: one error for the array,
  // the first uncovered position as the limit. Adjacent schema-form `items`
  // evaluates everything; the draft-07 array form acts as the prefix.
  if (schema.unevaluatedItems !== undefined && schema.unevaluatedItems !== true) {
    if (unevalLocalOk(schema, 'unevaluatedItems')) genUnevaluatedItemsFalseC(schema, v, pathExpr, lines, ctx, schemaPrefix, fail)
    else genUnevaluatedItemsDynamicC(schema, v, pathExpr, lines, ctx, schemaPrefix, fail)
  }

  // dependentRequired
  if (schema.dependentRequired) {
    for (const [key, deps] of Object.entries(schema.dependentRequired)) {
      for (const dep of deps) {
        const isStatic = !pathExpr || (pathExpr.startsWith("'") && !pathExpr.includes('+'))
        if (isStatic && !ctx.rich && !ctx.noOrdinal) {
          const ei = ctx.varCounter++
          const errVar = `_E${ei}`
          const pathVal = pathExpr ? literalValue(pathExpr) : ''
          ctx.closureVars.push(errVar)
          ctx.closureVals.push(sharedErr({keyword: 'required', instancePath: pathVal, schemaPath: unescapeSp(`${schemaPrefix}/dependentRequired`), params: Object.freeze({missingProperty: dep}), message: `must have required property '${dep}'`}, ctx.rootSchema))
          lines.push(`if(typeof ${v}==='object'&&${v}!==null&&${ownKeyExpr(ctx, v, key)}&&!${ownKeyExpr(ctx, v, dep)}){(_e=_ap(_A,_e,${errVar},-1))}`)
        } else {
          lines.push(`if(typeof ${v}==='object'&&${v}!==null&&${ownKeyExpr(ctx, v, key)}&&!${ownKeyExpr(ctx, v, dep)}){${errPushC(ctx, 'required', `${schemaPrefix}/dependentRequired`, pathExpr, `{missingProperty:'${esc(dep)}'}`, `"must have required property '${esc(dep)}'"`, v, `{keyword:'required',instancePath:${pathExpr||'""'},schemaPath:'${schemaPrefix}/dependentRequired'${ordinalField(ctx, `${schemaPrefix}/dependentRequired`)},params:{missingProperty:'${esc(dep)}'},message:"must have required property '${esc(dep)}'"}`)}}`)
        }
      }
    }
  }

  // properties — use hoisted vars for required+known-object, full guard otherwise
  if (schema.properties) {
    for (const [key, prop] of Object.entries(schema.properties)) {
      const pv = hoisted[key] || `${v}[${JSON.stringify(key)}]`
      const childPath = childPathExpr(pathExpr, ptrSeg(key))
      if (requiredSet.has(key) && isObj) {
        // A hoisted local was already cleared if the value is only inherited.
        lines.push(`if(${pv}!==undefined${hoisted[key] ? '' : '&&' + ownGuard(ctx, v, key)}){`)
        genGuardedC(prop, pv, childPath, lines, ctx, schemaPrefix+'/properties/'+ptrSeg(key))
        lines.push(`}`)
      } else if (isObj) {
        const oi = ctx.varCounter++
        lines.push(`{const _o${oi}=${v}[${JSON.stringify(key)}];if(_o${oi}!==undefined&&${ownGuard(ctx, v, key)}){`)
        genGuardedC(prop, `_o${oi}`, childPath, lines, ctx, schemaPrefix+'/properties/'+ptrSeg(key))
        lines.push(`}}`)
      } else {
        lines.push(`if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})&&${ownKeyExpr(ctx, v, key)}){`)
        genGuardedC(prop, `${v}[${JSON.stringify(key)}]`, childPath, lines, ctx, schemaPrefix+'/properties/'+ptrSeg(key))
        lines.push(`}`)
      }
    }
  }

  // patternProperties — same optimizations as genCode: charCodeAt + inline key comparison + merged propertyNames
  if (schema.patternProperties) {
    if (genPatternPropertiesC(schema, v, pathExpr, lines, ctx, schemaPrefix, fail, isObj)) ppHandledPropertyNames = true
  }
  // additionalProperties as a schema: each key that is neither declared nor
  // matched by a pattern, validated where it is (see genAdditionalSchemaC).
  if (typeof schema.additionalProperties === 'object' && schema.additionalProperties !== null) genAdditionalSchemaC(schema, v, pathExpr, lines, ctx, schemaPrefix, isObj)


  // dependentSchemas
  if (schema.dependentSchemas) genDependentSchemasC(schema, v, pathExpr, lines, ctx, schemaPrefix)

  if (schema.propertyNames === false) genPropertyNamesFalseC(schema, v, pathExpr, lines, ctx, schemaPrefix)

  // propertyNames — skip if already merged into patternProperties loop
  if (schema.propertyNames && typeof schema.propertyNames === 'object' && !ppHandledPropertyNames) genPropertyNamesC(schema, v, pathExpr, lines, ctx, schemaPrefix, fail)

  // items
  if (schema.items !== undefined && schema.items !== true) {
    const startIdx = schema.prefixItems ? schema.prefixItems.length : 0
    const idx = `_j${ctx.varCounter}`, elem = `_ei${ctx.varCounter}`
    ctx.varCounter++
    const childPath = childPathDynExpr(pathExpr, idx)
    lines.push(`if(Array.isArray(${v})){for(let ${idx}=${startIdx};${idx}<${v}.length;${idx}++){const ${elem}=${v}[${idx}]`)
    genGuardedC(schema.items, elem, childPath, lines, ctx, schemaPrefix+'/items')
    lines.push(`}}`)
  }

  // prefixItems
  if (schema.prefixItems) genPrefixItemsC(schema, v, pathExpr, lines, ctx, schemaPrefix)

  // contains
  if (schema.contains !== undefined) genContainsC(schema, v, pathExpr, lines, ctx, schemaPrefix, fail)

  // allOf
  if (schema.allOf) { for (let _ai = 0; _ai < schema.allOf.length; _ai++) genCodeC(schema.allOf[_ai], v, pathExpr, lines, ctx, schemaPrefix+'/allOf/'+_ai) }

  // anyOf, oneOf. A collapsed branch applies to a value of any type, as enum
  // and const do: the other engines report it next to a failed `type`, so
  // in the combined function it goes after the type-success block below.
  if (schema.anyOf && !ctx.inCombined) genAnyOfC(schema, v, pathExpr, lines, ctx, schemaPrefix, fail)
  if (schema.oneOf && !ctx.inCombined) genOneOfC(schema, v, pathExpr, lines, ctx, schemaPrefix, fail)

  // not
  if (schema.not !== undefined) genNotC(schema, v, pathExpr, lines, ctx, schemaPrefix, fail)

  // if/then/else
  if (schema.if !== undefined) genIfC(schema, v, pathExpr, lines, ctx, schemaPrefix)

  // Close type-success block if opened
  if (types) {
    lines.push(`}`)
    // A value of another type still meets every keyword that applies to its
    // own type, and the applicators (allOf, not, if/then/else, $ref): the
    // other engines report those next to the type error, and the block above
    // skipped them all. The keywords of the declared types cannot apply to
    // it and are left out, so the else is small and does not repeat the
    // declared type's subtree.
    const rest = typeMismatchRest(schema, types)
    if (rest !== null) {
      lines.push(`else{`)
      genCodeC(rest, v, pathExpr, lines, ctx, schemaPrefix)
      lines.push(`}`)
    }
  }
  if (schema.anyOf && ctx.inCombined) genAnyOfC(schema, v, pathExpr, lines, ctx, schemaPrefix, fail)
  if (schema.oneOf && ctx.inCombined) genOneOfC(schema, v, pathExpr, lines, ctx, schemaPrefix, fail)

}

// Rarely used keyword families of genCodeCNode, kept out of it so their compile is
// paid only by schemas that use them.

function genDynamicRefC(schema, v, pathExpr, lines, ctx, schemaPrefix) {
  const anchorKey = schema.$dynamicRef.startsWith('#') ? schema.$dynamicRef : '#' + schema.$dynamicRef
  if (ctx.anchors && ctx.anchors[anchorKey]) {
    const target = ctx.anchors[anchorKey]
    // This generator has no named functions, so it cannot follow a reference
    // back to the root or around a cycle. It used to emit nothing in both
    // cases, which the function then answered as valid: a document the other
    // generators reject passed through validateJSON. It declines instead,
    // and the schema takes the error generator.
    if (target === ctx.rootSchema) throw DECLINE
    const refKey = '$dynamicRef:' + anchorKey
    if (ctx.refStack.has(refKey)) throw DECLINE
    ctx.refStack.add(refKey)
    genCodeC(target, v, pathExpr, lines, ctx, schemaPrefix)
    ctx.refStack.delete(refKey)
  }
}

function genUniqueItemsC(schema, v, pathExpr, lines, ctx, schemaPrefix, fail, isArr) {
  const si = ctx.varCounter++
  const failExpr = (iVar, jVar) => fail('uniqueItems', 'uniqueItems', `{i:${iVar},j:${jVar}}`, `'must NOT have duplicate items (items ## '+${jVar}+' and '+${iVar}+' are identical)'`)
  // Only reached once the verdict has rejected, or when errors are wanted, so
  // one strategy for every item type: the hoisted pair finder. See UQP_HELPER.
  const inner = `const _j${si}=${emitUqp(ctx)}(${v});if(_j${si}>=0){const _i${si}=_uqpI;${failExpr('_i' + si, '_j' + si)}}`
  lines.push(isArr ? `{${inner}}` : `if(Array.isArray(${v})){${inner}}`)
}

// The verdict form of genUnevaluatedDynamicC: the same set, built the same
// way, and the answer false at the first key outside it.
function genUnevalDynamicVerdict(schema, v, lines, ctx, isObj, nonObjApplicators) {
  if (schema.additionalProperties !== undefined) {
    if (nonObjApplicators) throw DECLINE
    return
  }
  const ui = ctx.varCounter++
  const S = `_ev${ui}`
  const body = [`const ${S}=[]`]
  addLocalAnnotations(schema, v, S, body, ctx)
  // With the anyOf and oneOf blocks moved here (see genCodeNode), their
  // passing branches are counted by the annotation pass and judged from the
  // count: a oneOf holds with exactly one, an anyOf with at least one.
  const counts = nonObjApplicators ? { anyOf: `_ac${ui}`, oneOf: `_oc${ui}`, oneOfMask: null, of: null, verdict: true } : null
  if (counts) body.push(`let ${counts.anyOf}=0,${counts.oneOf}=0`)
  addTopApplicatorAnnotations(schema, v, S, body, ctx, counts)
  if (counts) {
    if (Array.isArray(schema.anyOf)) body.push(`if(${counts.anyOf}<1)return false`)
    if (Array.isArray(schema.oneOf)) body.push(`if(${counts.oneOf}!==1)return false`)
  }
  const kVar = `_uk${ui}`
  const up = schema.unevaluatedProperties
  if (up === false) {
    body.push(`for(const ${kVar} of Object.keys(${v}))if(!${S}.includes(${kVar}))return false`)
  } else if (typeof up === 'object' && up !== null) {
    const sub = []
    genCode(up, `${v}[${kVar}]`, sub, ctx)
    if (sub.length) body.push(`for(const ${kVar} of Object.keys(${v}))if(!${S}.includes(${kVar})){${sub.join('\n  ')}\n  }`)
  } else {
    throw DECLINE
  }
  // A value that is not an object skips the pass, so the blocks moved here
  // run for it in the `else`; a value known to be an object has no `else`.
  const other = nonObjApplicators && nonObjApplicators.length && !isObj ? `else{${nonObjApplicators.join('\n  ')}}` : ''
  lines.push(isObj ? `{${body.join(';')}}` : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){${body.join(';')}}${other}`)
}

// unevaluatedProperties where what is evaluated depends on which branches
// pass: the set is built at run time with the interpreted engine's rules.
// The node's own properties, patternProperties and additionalProperties
// count whether or not their values pass; an allOf, anyOf or dependentSchemas
// branch, an if, then or else, or a $ref target counts only when it passes,
// a oneOf only when exactly one branch passes, and `not` never. Each branch is
// asked through an annotation function (emitAnnot).
// Run-time unevaluatedProperties written as straight-line code. The names a
// node and its in-place applicators can evaluate are known when the code is
// written (their `properties`), so the evaluated set is a bit per name in an
// integer, each branch's verdict a labelled block, and a failed oneOf's
// rollback the integer it started from. The annotation functions this
// replaces (emitAnnot) pushed names onto an array, asked it with `includes`
// for every key, and were a call per branch per level: ten functions and
// twenty calls for the suite's nested-reference case, which in the first
// thousands of calls of a process, before anything is inlined, cost 548 ns
// against 131. Null when the shape is not modelled: names that are only known
// at run time (patternProperties, additionalProperties), a nested
// unevaluatedProperties, a reference cycle, more than 30 names, or too much
// code; the annotation functions then stand in as before.
const ANNOT_INLINE_MAX = 8192
const ANNOT_NAME_MAX = 30
const ANNOT_BLOCKERS = ['unevaluatedItems', '$dynamicRef', '$recursiveRef', 'dependencies']
// Besides a bit per declared name, the mask has a bit per pattern of a
// patternProperties (set when the subschema holding it holds: the keys it
// matches are evaluated) and one bit, `all`, for a subschema that evaluates
// every key when it holds (additionalProperties of any value, or a nested
// `unevaluatedProperties: true`). A nested `unevaluatedProperties` that
// checks something is not modelled.
const ALL_BIT_KEY = '\u0000all'
function annotSubs (node, ctx) {
  const subs = []
  for (const b of node.allOf || []) subs.push(b)
  for (const b of node.anyOf || []) subs.push(b)
  for (const b of node.oneOf || []) subs.push(b)
  if (node.if !== undefined) subs.push(node.if)
  if (node.then !== undefined) subs.push(node.then)
  if (node.else !== undefined) subs.push(node.else)
  if (node.dependentSchemas && typeof node.dependentSchemas === 'object') for (const ds of Object.values(node.dependentSchemas)) subs.push(ds)
  if (typeof node.$ref === 'string') subs.push(refTargetFor(node.$ref, ctx))
  return subs
}
function annotNames (node, ctx, names, seen, top) {
  if (node === true || node === false) return true
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return false
  if (seen.has(node)) return false
  seen.add(node)
  try {
    for (const k of ANNOT_BLOCKERS) if (node[k] !== undefined) return false
    if (!top && node.unevaluatedProperties !== undefined && node.unevaluatedProperties !== true) return false
    const add = (key) => { if (!names.has(key)) { if (names.size >= ANNOT_NAME_MAX) return false; names.set(key, names.size) } return true }
    if (node.properties && typeof node.properties === 'object') for (const k of Object.keys(node.properties)) if (!add(k)) return false
    if (node.patternProperties && typeof node.patternProperties === 'object') for (const pat of Object.keys(node.patternProperties)) if (!add('/' + pat)) return false
    if ((!top && node.additionalProperties !== undefined) || (!top && node.unevaluatedProperties === true)) if (!add(ALL_BIT_KEY)) return false
    let subs
    try { subs = annotSubs(node, ctx) } catch { return false }
    for (const b of subs) if (!annotNames(b, ctx, names, seen, false)) return false
    return true
  } finally { seen.delete(node) }
}
// The bits a subschema's own keywords evaluate when it holds: its declared
// names that are present, every pattern it declares, and `all` for a
// subschema that evaluates every key.
function ownBits (sub, v, names, ctx, t, top) {
  const out = []
  for (const k of Object.keys(sub.properties || {})) out.push(`if(${ownKeyExpr(ctx, v, k)})${t}|=${1 << names.get(k)}`)
  let fixed = 0
  for (const pat of Object.keys(sub.patternProperties || {})) fixed |= 1 << names.get('/' + pat)
  if (!top && (sub.additionalProperties !== undefined || sub.unevaluatedProperties === true)) fixed |= 1 << names.get(ALL_BIT_KEY)
  if (fixed !== 0) out.push(`${t}|=${fixed}`)
  return out
}
// The test for one pattern bit against a key variable, a closure regex or a
// fixed prefix test (fastPrefixCheck) as addLocalAnnotations writes them.
function patternKeyTest (ctx, pat, kv) {
  const fast = fastPrefixCheck(pat, kv)
  if (fast) return fast
  const ri = ctx.varCounter++
  ctx.closureVars.push(`_re${ri}`)
  ctx.closureVals.push(safeReClosure(ctx, pat))
  return `_re${ri}.test(${kv})`
}
// Factory-scope count variables for one anyOf or oneOf array (by identity),
// registered in ctx.branchCounts for emitBranchCollapse: `of` the object
// they were counted for, `count` how many branches held, `mask` which (oneOf
// up to 30 branches). Declared once per program; a stale value is never
// taken, since every reader checks `of` against the value at hand.
function factoryCount (ctx, arr, withMask) {
  if (!ctx.inCombined) return null
  if (!ctx.branchCounts) ctx.branchCounts = new Map()
  const hit = ctx.branchCounts.get(arr)
  if (hit !== undefined) return hit.factory ? hit : null
  const id = ctx.varCounter++
  const fc = { of: `_fa${id}`, count: `_fn${id}`, mask: withMask ? `_fm${id}` : null, factory: true }
  ctx.helperCode.push(`let ${fc.of}=null,${fc.count}=0${withMask ? `,${fc.mask}=0` : ''}`)
  ctx.branchCounts.set(arr, fc)
  return fc
}
// Lines that set `ok` (declared by the caller, 1 or 0) for `sub` at `v`, an
// object, and OR the names it evaluated into `tv` when it holds.
function emitAnnotInline (sub, v, names, ctx, out, ok, tv) {
  if (sub === true) { out.push(`${ok}=1`); return }
  if (sub === false) { out.push(`${ok}=0`); return }
  const id = ctx.varCounter++
  const t = `_t${id}`
  const local = {}
  for (const k of Object.keys(sub)) if (!ANNOT_APPLICATORS.has(k)) setOwn(local, k, sub[k])
  const vl = []
  // The value is known to be an object here (the block runs for objects
  // only), which the verdict is told when the branch does not say otherwise:
  // told a type, the generator takes it for the value's and skips the
  // branch's own `type`, so a `type: "string"` branch has to keep its check.
  ctx.nestedBoolean = (ctx.nestedBoolean || 0) + 1
  try { genCode(local, v, vl, ctx, local.type === undefined || local.type === 'object' ? 'object' : undefined) } finally { ctx.nestedBoolean-- }
  out.push(`let ${t}=0;${ok}=1`)
  if (vl.length) out.push(`a${id}:{${replaceTopLevel(vl.join(';'), `break a${id}`, `{${ok}=0;break a${id}}`)}}`)
  if (sub.not !== undefined) {
    const nl = []
    nestedGenCode(sub.not, v, nl, ctx)
    if (nl.length) out.push(`if(${ok}){let _nk${id}=1;n${id}:{${replaceTopLevel(nl.join(';'), `break n${id}`, `{_nk${id}=0;break n${id}}`)}};if(_nk${id})${ok}=0}`)
    else out.push(`${ok}=0`)
  }
  const own = ownBits(sub, v, names, ctx, t, false)
  if (own.length) out.push(`if(${ok}){${own.join(';')}}`)
  let bi = 0
  const child = (b) => { const o = `_ok${id}_${bi}`, tb = `_tb${id}_${bi}`; bi++; out.push(`let ${o}=1,${tb}=0`); emitAnnotInline(b, v, names, ctx, out, o, tb); return [o, tb] }
  for (const b of sub.allOf || []) { const [o, tb] = child(b); out.push(`if(!${o})${ok}=0;else ${t}|=${tb}`) }
  // The counts of a nested anyOf or oneOf go to factory-scope variables as
  // well (factoryCount), where the keyword's own error code in a branch
  // function, and the counting copies, read them instead of deciding the
  // branches again: the suite's nested-reference case decided each branch
  // four times over (this pass, the verdict closures, the counting copies,
  // the chosen branch's error function).
  if (Array.isArray(sub.anyOf)) {
    const na = `_na${id}`
    const fc = factoryCount(ctx, sub.anyOf, false)
    out.push(`let ${na}=0${fc ? `;${fc.of}=${v};${fc.count}=0` : ''}`)
    for (const b of sub.anyOf) { const [o, tb] = child(b); out.push(`if(${o}){${na}++;${t}|=${tb}${fc ? `;${fc.count}++` : ''}}`) }
    out.push(`if(${na}===0)${ok}=0`)
  }
  if (Array.isArray(sub.oneOf)) {
    const nc = `_nc${id}`, tc = `_tc${id}`
    const fc = factoryCount(ctx, sub.oneOf, sub.oneOf.length <= 30)
    out.push(`let ${nc}=0,${tc}=0${fc ? `;${fc.of}=${v};${fc.count}=0${fc.mask ? `;${fc.mask}=0` : ''}` : ''}`)
    sub.oneOf.forEach((b, i) => { const [o, tb] = child(b); out.push(`if(${o}){${nc}++;${tc}=${tb}${fc ? `;${fc.count}++${fc.mask ? `;${fc.mask}|=${1 << i}` : ''}` : ''}}`) })
    out.push(`if(${nc}===1)${t}|=${tc};else ${ok}=0`)
  }
  if (sub.if !== undefined) {
    const [oi, ti] = child(sub.if)
    const thenPart = []
    if (sub.then !== undefined) { const saved = out.length; const [ot, tt] = child(sub.then); thenPart.push(...out.splice(saved)); thenPart.push(`if(!${ot})${ok}=0;else ${t}|=${tt}`) }
    const elsePart = []
    if (sub.else !== undefined) { const saved = out.length; const [oe, te] = child(sub.else); elsePart.push(...out.splice(saved)); elsePart.push(`if(!${oe})${ok}=0;else ${t}|=${te}`) }
    out.push(`if(${oi}){${t}|=${ti};${thenPart.join(';')}}else{${elsePart.join(';')}}`)
  }
  if (sub.dependentSchemas && typeof sub.dependentSchemas === 'object') {
    for (const [k, ds] of Object.entries(sub.dependentSchemas)) { const saved = out.length; const [o, tb] = child(ds); const body = out.splice(saved); out.push(`if(${ownKeyExpr(ctx, v, k)}){${body.join(';')};if(!${o})${ok}=0;else ${t}|=${tb}}`) }
  }
  if (typeof sub.$ref === 'string') { const [o, tb] = child(refTargetFor(sub.$ref, ctx)); out.push(`if(!${o})${ok}=0;else ${t}|=${tb}`) }
  out.push(`if(${ok})${tv}|=${t}`)
}
// The whole run-time unevaluatedProperties block for `schema` at `v`, or
// null. `counts` as in genUnevaluatedDynamicC: how many anyOf and oneOf
// branches held, for the keywords' own code to read.
function inlineUnevalBlock (schema, v, pathExpr, ctx, schemaPrefix, fail, counts) {
  const names = new Map()
  if (!annotNames(schema, ctx, names, new Set(), true)) return null
  const saved = snapshotCtx(ctx)
  try {
    const id = ctx.varCounter++
    const m = `_m${id}`
    const out = [`let ${m}=0`]
    // One prototype flag for the object, read by every presence test below.
    if (!ctx.plainOf) ctx.plainOf = new Map()
    const prevPk = ctx.plainOf.get(v)
    const pk = prevPk !== undefined ? prevPk : `_pk${id}`
    const prevReuse = ctx.plainReuse
    if (prevPk === undefined) { out.push(`const ${pk}=${protoIs(ctx, v)}`); ctx.plainOf.set(v, pk); (ctx.plainUsed || (ctx.plainUsed = new Set())).add(pk) }
    ctx.plainReuse = v
    out.push(...ownBits(schema, v, names, ctx, m, true))
    let bi = 0
    const child = (b) => { const o = `_ok${id}_${bi}`, tb = `_tb${id}_${bi}`; bi++; out.push(`let ${o}=1,${tb}=0`); emitAnnotInline(b, v, names, ctx, out, o, tb); return [o, tb] }
    for (const b of schema.allOf || []) { const [, tb] = child(b); out.push(`${m}|=${tb}`) }
    if (Array.isArray(schema.anyOf)) {
      const na = counts ? counts.anyOf : `_na${id}`
      out.push(counts ? `${na}=0` : `let ${na}=0`)
      for (const b of schema.anyOf) { const [o, tb] = child(b); out.push(`if(${o}){${na}++;${m}|=${tb}}`) }
    }
    if (Array.isArray(schema.oneOf)) {
      const nc = counts ? counts.oneOf : `_nc${id}`, tc = `_tc${id}`
      out.push(counts ? `${nc}=0;let ${tc}=0` : `let ${nc}=0,${tc}=0`)
      schema.oneOf.forEach((b, i) => { const [o, tb] = child(b); out.push(`if(${o}){${nc}++;${tc}=${tb};${counts && counts.oneOfMask && schema.oneOf.length <= 30 ? `${counts.oneOfMask}|=${1 << i};` : ''}}`) })
      out.push(`if(${nc}===1)${m}|=${tc}`)
    }
    if (schema.if !== undefined) {
      const [oi, ti] = child(schema.if)
      const thenPart = []
      if (schema.then !== undefined) { const sv = out.length; const [ot, tt] = child(schema.then); thenPart.push(...out.splice(sv)); thenPart.push(`if(${ot})${m}|=${tt}`) }
      const elsePart = []
      if (schema.else !== undefined) { const sv = out.length; const [oe, te] = child(schema.else); elsePart.push(...out.splice(sv)); elsePart.push(`if(${oe})${m}|=${te}`) }
      out.push(`if(${oi}){${m}|=${ti};${thenPart.join(';')}}else{${elsePart.join(';')}}`)
    }
    if (schema.dependentSchemas && typeof schema.dependentSchemas === 'object') {
      for (const [k, ds] of Object.entries(schema.dependentSchemas)) { const sv = out.length; const [o, tb] = child(ds); const body = out.splice(sv); out.push(`if(${ownKeyExpr(ctx, v, k)}){${body.join(';')};if(${o})${m}|=${tb}}`) }
    }
    if (typeof schema.$ref === 'string') { const [o, tb] = child(refTargetFor(schema.$ref, ctx)); out.push(`if(${o})${m}|=${tb}`) }
    // What is left: every own key whose bit is not set.
    const kVar = `_uk${id}`
    const cases = [...names].filter(([k]) => k !== ALL_BIT_KEY && k[0] !== '/').map(([k, i]) => `case ${JSON.stringify(k)}:_ub${id}=${1 << i};break`).join(';')
    const allBit = names.has(ALL_BIT_KEY) ? `if((${m}&${1 << names.get(ALL_BIT_KEY)})!==0)continue;` : ''
    const patBits = [...names].filter(([k]) => k[0] === '/').map(([k, i]) => `if((${m}&${1 << i})!==0&&${patternKeyTest(ctx, k.slice(1), `_uk${id}`)})continue;`).join('')
    const up = schema.unevaluatedProperties
    let body
    if (up === false) {
      body = fail('unevaluatedProperties', 'unevaluatedProperties', `{unevaluatedProperty:${kVar}}`, "'must NOT have unevaluated properties'")
    } else if (typeof up === 'object' && up !== null) {
      const pe = emitPtrEsc(ctx)
      const p = pathExpr ? `${pathExpr}+'/'+${pe}(${kVar})` : `'/'+${pe}(${kVar})`
      const sub = []
      genCodeC(up, `${v}[${kVar}]`, p, sub, ctx, schemaPrefix + '/unevaluatedProperties')
      body = sub.join('\n  ')
    } else {
      throw DECLINE
    }
    if (body) out.push(`for(const ${kVar} in ${v}){if(!${ownKeyExpr(ctx, v, kVar).split(JSON.stringify(kVar)).join(kVar)})continue;let _ub${id}=0;switch(${kVar}){${cases}}if(_ub${id}!==0&&(${m}&_ub${id})!==0)continue;${allBit}${patBits}${body}}`)
    const text = out.join(';')
    ctx.plainReuse = prevReuse
    if (prevPk === undefined) ctx.plainOf.delete(v)
    if (text.length > ANNOT_INLINE_MAX || /\b(?:_validate|_stk|_sd|_sg|_CYC)\b/.test(text)) { restoreCtx(ctx, saved); return null }
    return text
  } catch (e) {
    if (e !== DECLINE) throw e
    restoreCtx(ctx, saved)
    return null
  }
}

function genUnevaluatedDynamicC(schema, v, pathExpr, lines, ctx, schemaPrefix, fail, isObj) {
  // additionalProperties evaluates every key the others do not, pass or fail.
  if (schema.additionalProperties !== undefined) return
  const ui = ctx.varCounter++
  const S = `_ev${ui}`
  const body = [`const ${S}=[]`]
  addLocalAnnotations(schema, v, S, body, ctx)
  // The anyOf and oneOf counts are handed to the keywords' own error code
  // (emitBranchCollapse), with the object they were counted for: they are
  // declared once at the top of the combined function, where every later
  // line sees them, and read only when that object is the value at hand, so
  // a count left from another value, another loop iteration or another place
  // is never taken for this one. Only in the combined function proper.
  const share = ctx.inCombined && !ctx.inBranchFn && ctx.hoisted !== undefined &&
    (Array.isArray(schema.anyOf) || Array.isArray(schema.oneOf))
  const counts = share ? { anyOf: `_ac${ui}`, oneOf: `_oc${ui}`, oneOfMask: `_om${ui}`, of: `_ao${ui}` } : null
  if (share) {
    ctx.hoisted.push(counts.anyOf, counts.oneOf, counts.oneOfMask, counts.of)
    body.push(`${counts.of}=${v};${counts.oneOfMask}=0`)
    if (!ctx.branchCounts) ctx.branchCounts = new Map()
    if (Array.isArray(schema.anyOf)) ctx.branchCounts.set(schema.anyOf, { of: counts.of, count: counts.anyOf, mask: null })
    if (Array.isArray(schema.oneOf)) ctx.branchCounts.set(schema.oneOf, { of: counts.of, count: counts.oneOf, mask: schema.oneOf.length <= 30 ? counts.oneOfMask : null })
  }
  const inline = inlineUnevalBlock(schema, v, pathExpr, ctx, schemaPrefix, fail, counts)
  if (inline !== null) {
    const pre = share ? `${counts.of}=${v};${counts.oneOfMask}=0;` : ''
    lines.push(isObj ? `{${pre}${inline}}` : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){${pre}${inline}}`)
    return
  }
  addTopApplicatorAnnotations(schema, v, S, body, ctx, counts)
  const kVar = `_uk${ui}`
  const up = schema.unevaluatedProperties
  if (up === false) {
    body.push(`for(const ${kVar} of Object.keys(${v}))if(!${S}.includes(${kVar})){${fail('unevaluatedProperties', 'unevaluatedProperties', `{unevaluatedProperty:${kVar}}`, "'must NOT have unevaluated properties'")}}`)
  } else if (typeof up === 'object' && up !== null) {
    const pe = emitPtrEsc(ctx)
    const p = pathExpr ? `${pathExpr}+'/'+${pe}(${kVar})` : `'/'+${pe}(${kVar})`
    const sub = []
    genCodeC(up, `${v}[${kVar}]`, p, sub, ctx, schemaPrefix + '/unevaluatedProperties')
    if (sub.length) body.push(`for(const ${kVar} of Object.keys(${v}))if(!${S}.includes(${kVar})){${sub.join('\n  ')}\n  }`)
  } else {
    throw DECLINE
  }
  lines.push(isObj ? `{${body.join(';')}}` : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){${body.join(';')}}`)
}

// The names a node's own keywords evaluate, pushed onto the array `S`:
// present declared properties, keys matching a pattern, and every key when
// additionalProperties is there.
function addLocalAnnotations(node, v, S, out, ctx) {
  if (node.additionalProperties !== undefined) {
    out.push(`for(const _ka in ${v})${S}.push(_ka)`)
    return
  }
  for (const k of Object.keys(node.properties || {})) out.push(`if(Object.prototype.hasOwnProperty.call(${v},${JSON.stringify(k)}))${S}.push(${JSON.stringify(k)})`)
  const pats = Object.keys(node.patternProperties || {})
  if (pats.length) {
    const tests = []
    const kv = `_pk${ctx.varCounter++}`
    for (const pat of pats) {
      const fast = fastPrefixCheck(pat, kv)
      if (fast) { tests.push(fast); continue }
      const ri = ctx.varCounter++
      ctx.closureVars.push(`_re${ri}`)
      ctx.closureVals.push(safeReClosure(ctx, pat))
      tests.push(`_re${ri}.test(${kv})`)
    }
    out.push(`for(const ${kv} in ${v})if(${tests.join('||')})${S}.push(${kv})`)
  }
}

// What the applicators of the node that owns the unevaluatedProperties add.
// Their validity is checked by the code around this; here a branch only
// contributes, through its annotation function, when it passes, and a oneOf
// only with exactly one passing branch. An annotation function that fails
// leaves `S` as it found it.
function addTopApplicatorAnnotations(node, v, S, out, ctx, counts) {
  if (node.$dynamicRef !== undefined || node.$recursiveRef !== undefined || node.dependencies !== undefined) throw DECLINE
  for (const b of node.allOf || []) out.push(`${emitAnnot(b, ctx)}(${v},${S})`)
  // With `counts`, the passing branches of anyOf and oneOf are counted into
  // variables the caller declared, so the keyword's own error code further
  // down can skip its branches when the count already says it holds (see
  // emitBranchCollapse).
  if (Array.isArray(node.anyOf)) {
    if (counts) out.push(`${counts.anyOf}=0;${node.anyOf.map((b) => `if(${emitAnnot(b, ctx)}(${v},${S}))${counts.anyOf}++;`).join('')}`)
    else for (const b of node.anyOf) out.push(`${emitAnnot(b, ctx)}(${v},${S})`)
  }
  if (Array.isArray(node.oneOf)) {
    const t = counts ? counts.oneOf : `_oc${ctx.varCounter++}`
    // Which branches passed, as bits, for a collapse that has to name them.
    const mask = counts && node.oneOf.length <= 30 ? counts.oneOfMask : null
    // In a verdict (counts.verdict), a second passing branch is the answer.
    const over = counts && counts.verdict ? `if(${t}>1)return false;` : ''
    out.push(`{const ${t}m=${S}.length;${counts ? '' : 'let '}${t}=0;${node.oneOf.map((b, i) => `if(${emitAnnot(b, ctx)}(${v},${S})){${t}++;${over}${mask ? `${mask}|=${1 << i};` : ''}}`).join('')}if(${t}!==1)_rb(${S},${t}m)}`)
  }
  if (node.if !== undefined) {
    const thenCall = node.then !== undefined ? `${emitAnnot(node.then, ctx)}(${v},${S})` : ''
    const elseCall = node.else !== undefined ? `${emitAnnot(node.else, ctx)}(${v},${S})` : ''
    out.push(`if(${emitAnnot(node.if, ctx)}(${v},${S})){${thenCall}}else{${elseCall}}`)
  }
  if (node.dependentSchemas && typeof node.dependentSchemas === 'object') {
    for (const [k, ds] of Object.entries(node.dependentSchemas)) out.push(`if(Object.prototype.hasOwnProperty.call(${v},${JSON.stringify(k)}))${emitAnnot(ds, ctx)}(${v},${S})`)
  }
  if (typeof node.$ref === 'string') out.push(`${emitAnnot(refTargetFor(node.$ref, ctx), ctx)}(${v},${S})`)
}

function refTargetFor(ref, ctx) {
  const m = ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/)
  const t = m && ctx.rootDefs ? ctx.rootDefs[m[1]] : undefined
  if (t === undefined) throw DECLINE
  return t
}

// The keywords an annotation function evaluates itself, through its children;
// the rest of a subschema is checked by a plain verdict.
const ANNOT_APPLICATORS = new Set(['allOf', 'anyOf', 'oneOf', 'if', 'then', 'else', 'dependentSchemas', '$ref', 'not', 'unevaluatedProperties'])

// A function `(value, S) => valid` for one subschema: whether it passes, and
// when it does, what it evaluated pushed onto S; when it does not, S is left
// as it was. Validity is worked out bottom up: the subschema's own keywords
// by a verdict of the subschema without its applicators, each applicator from
// its branches' annotation functions. Asking each branch for a full verdict
// and then again for its annotations repeated every nested branch once per
// level, which made nested references the slowest shape there was.
function emitAnnot(sub, ctx) {
  if (sub === true) return '_anT'
  if (sub === false) return '_anF'
  if (sub === null || typeof sub !== 'object') throw DECLINE
  if (!ctx.annFns) {
    ctx.annFns = new Map()
    if (ctx.sharedRuntime) bindRt(ctx, ['_anT', '_anF', '_rb'])
    else (ctx.preamble || ctx.helperCode).push('function _anT(){return true}function _anF(){return false}function _rb(S,m){if(S.length!==m)S.length=m}')
  }
  const hit = ctx.annFns.get(sub)
  if (hit !== undefined) {
    if (hit === null) throw DECLINE // a reference cycle: not modelled here
    return hit
  }
  if (sub.$dynamicRef !== undefined || sub.$recursiveRef !== undefined || sub.dependencies !== undefined) throw DECLINE
  // unevaluatedItems reads what the applicators evaluate too; the local
  // verdict would see it without them.
  if (sub.unevaluatedItems !== undefined) throw DECLINE
  ctx.annFns.set(sub, null)
  const name = `_an${ctx.varCounter++}`
  const local = {}
  for (const k of Object.keys(sub)) if (!ANNOT_APPLICATORS.has(k)) setOwn(local, k, sub[k])
  const vl = []
  nestedGenCode(local, '_av', vl, ctx)
  const decls = [`function ${name}_v(_av){${vl.join('\n  ')}\n  return true}`]
  const body = [`if(!${name}_v(d))return false`]
  if (sub.not !== undefined) {
    const nl = []
    nestedGenCode(sub.not, '_nv', nl, ctx)
    decls.push(`function ${name}_n(_nv){${nl.join('\n  ')}\n  return true}`)
    body.push(`if(${name}_n(d))return false`)
  }
  body.push(`const _m=S.length;const _o=typeof d==='object'&&d!==null&&!Array.isArray(d)`)
  const locals = []
  addLocalAnnotations(sub, 'd', 'S', locals, ctx)
  if (locals.length) body.push(`if(_o){${locals.join(';')}}`)
  const failOut = '{_rb(S,_m);return false}'
  for (const b of sub.allOf || []) body.push(`if(!${emitAnnot(b, ctx)}(d,S))${failOut}`)
  if (Array.isArray(sub.anyOf)) body.push(`{let _a=false;${sub.anyOf.map((b) => `if(${emitAnnot(b, ctx)}(d,S))_a=true;`).join('')}if(!_a)${failOut}}`)
  // A second passing branch settles the oneOf; the rest are not run.
  if (Array.isArray(sub.oneOf)) body.push(`{let _c=0;${sub.oneOf.map((b) => `if(${emitAnnot(b, ctx)}(d,S)&&++_c>1)${failOut}`).join('')}if(_c!==1)${failOut}}`)
  if (sub.if !== undefined) {
    const thenCheck = sub.then !== undefined ? `if(!${emitAnnot(sub.then, ctx)}(d,S))${failOut}` : ''
    const elseCheck = sub.else !== undefined ? `if(!${emitAnnot(sub.else, ctx)}(d,S))${failOut}` : ''
    body.push(`if(${emitAnnot(sub.if, ctx)}(d,S)){${thenCheck}}else{${elseCheck}}`)
  }
  if (sub.dependentSchemas && typeof sub.dependentSchemas === 'object') {
    for (const [k, ds] of Object.entries(sub.dependentSchemas)) body.push(`if(_o&&Object.prototype.hasOwnProperty.call(d,${JSON.stringify(k)})&&!${emitAnnot(ds, ctx)}(d,S))${failOut}`)
  }
  if (typeof sub.$ref === 'string') body.push(`if(!${emitAnnot(refTargetFor(sub.$ref, ctx), ctx)}(d,S))${failOut}`)
  // An unevaluatedProperties of its own: the keys this subschema evaluated
  // are the ones pushed since _m; what is left must pass it, and then every
  // key is evaluated.
  const up = sub.unevaluatedProperties
  if (up !== undefined && up !== true && sub.additionalProperties === undefined) {
    if (up === false) {
      body.push(`if(_o){for(const _k of Object.keys(d))if(S.indexOf(_k,_m)<0)${failOut}}`)
    } else if (typeof up === 'object' && up !== null) {
      const ul = []
      nestedGenCode(up, '_uv', ul, ctx)
      decls.push(`function ${name}_u(_uv){${ul.join('\n  ')}\n  return true}`)
      body.push(`if(_o){for(const _k of Object.keys(d))if(S.indexOf(_k,_m)<0&&!${name}_u(d[_k]))${failOut}}`)
    } else {
      throw DECLINE
    }
  }
  if (up !== undefined && sub.additionalProperties === undefined) body.push(`if(_o)for(const _ka in d)S.push(_ka)`)
  decls.push(`function ${name}(d,S){${body.join(';')};return true}`)
  ;(ctx.preamble || ctx.helperCode).push(decls.join(''))
  ctx.annFns.set(sub, name)
  return name
}

// unevaluatedItems worked out at run time, for the combined function. The
// evaluated positions of an array are kept as the interpreter keeps them
// (lib/plan-compiler.js): `n`, every index below it evaluated, and `x`, the
// indexes past it that `contains` matched. This node's own prefixItems,
// items and contains mark them whatever their own verdict, and each in-place
// subschema marks them only when it passes (emitAnnotI); what is left must
// pass unevaluatedItems. `false` reports once, at the first position left,
// as the interpreter does.
// Run-time unevaluatedItems written as straight-line code, the way
// inlineUnevalBlock writes unevaluatedProperties. Without `contains` the
// positions a node and its in-place applicators evaluate are a prefix: items
// evaluates every position, prefixItems the first p, a nested
// `unevaluatedItems: true` every position once its subschema holds; the
// record is one integer, merged with max where a branch holds, and what is
// left starts at that index. `contains` (positions that are not a prefix), a
// tuple `items`, a nested unevaluatedItems that checks something, dynamic
// references and reference cycles keep the annotation functions.
const ANNOT_I_BLOCKERS = ['contains', 'additionalItems', '$dynamicRef', '$recursiveRef', 'dependencies']
function annotItemsFit (node, ctx, seen, top) {
  if (node === true || node === false) return true
  if (node === null || typeof node !== 'object' || Array.isArray(node)) return false
  if (seen.has(node)) return false
  seen.add(node)
  try {
    for (const k of ANNOT_I_BLOCKERS) if (node[k] !== undefined) return false
    if (Array.isArray(node.items)) return false
    if (!top && node.unevaluatedItems !== undefined && node.unevaluatedItems !== true) return false
    if (node.unevaluatedProperties !== undefined && node.unevaluatedProperties !== true) return false
    let subs
    try { subs = annotSubs(node, ctx) } catch { return false }
    for (const b of subs) if (!annotItemsFit(b, ctx, seen, false)) return false
    return true
  } finally { seen.delete(node) }
}
// The positions a node's own keywords evaluate, as an expression of the
// array length `len`: null when none.
function ownPrefix (node, len, top) {
  if (node.items !== undefined) return len
  if (!top && node.unevaluatedItems === true) return len
  if (Array.isArray(node.prefixItems) && node.prefixItems.length) return `(${len}<${node.prefixItems.length}?${len}:${node.prefixItems.length})`
  return null
}
// Lines that set `ok` for `sub` at `v`, an array of length `len`, and raise
// `tn` to the positions it evaluated when it holds.
function emitAnnotInlineI (sub, v, len, ctx, out, ok, tn) {
  if (sub === true) { out.push(`${ok}=1`); return }
  if (sub === false) { out.push(`${ok}=0`); return }
  const id = ctx.varCounter++
  const t = `_t${id}`
  const local = {}
  for (const k of Object.keys(sub)) if (!ANNOT_ITEM_APPLICATORS.has(k)) setOwn(local, k, sub[k])
  const vl = []
  ctx.nestedBoolean = (ctx.nestedBoolean || 0) + 1
  try { genCode(local, v, vl, ctx, local.type === undefined || local.type === 'array' ? 'array' : undefined) } finally { ctx.nestedBoolean-- }
  out.push(`let ${t}=0;${ok}=1`)
  if (vl.length) out.push(`a${id}:{${replaceTopLevel(vl.join(';'), `break a${id}`, `{${ok}=0;break a${id}}`)}}`)
  if (sub.not !== undefined) {
    const nl = []
    nestedGenCode(sub.not, v, nl, ctx)
    if (nl.length) out.push(`if(${ok}){let _nk${id}=1;n${id}:{${replaceTopLevel(nl.join(';'), `break n${id}`, `{_nk${id}=0;break n${id}}`)}};if(_nk${id})${ok}=0}`)
    else out.push(`${ok}=0`)
  }
  const own = ownPrefix(sub, len, false)
  if (own !== null) out.push(`if(${ok})${t}=${own}`)
  let bi = 0
  const child = (b) => { const o = `_ok${id}_${bi}`, tb = `_tb${id}_${bi}`; bi++; out.push(`let ${o}=1,${tb}=0`); emitAnnotInlineI(b, v, len, ctx, out, o, tb); return [o, tb] }
  const raise = (tb) => `if(${tb}>${t})${t}=${tb}`
  for (const b of sub.allOf || []) { const [o, tb] = child(b); out.push(`if(!${o})${ok}=0;else ${raise(tb)}`) }
  if (Array.isArray(sub.anyOf)) {
    const na = `_na${id}`
    const fc = factoryCount(ctx, sub.anyOf, false)
    out.push(`let ${na}=0${fc ? `;${fc.of}=${v};${fc.count}=0` : ''}`)
    for (const b of sub.anyOf) { const [o, tb] = child(b); out.push(`if(${o}){${na}++;${raise(tb)}${fc ? `;${fc.count}++` : ''}}`) }
    out.push(`if(${na}===0)${ok}=0`)
  }
  if (Array.isArray(sub.oneOf)) {
    const nc = `_nc${id}`, tc = `_tc${id}`
    const fc = factoryCount(ctx, sub.oneOf, sub.oneOf.length <= 30)
    out.push(`let ${nc}=0,${tc}=0${fc ? `;${fc.of}=${v};${fc.count}=0${fc.mask ? `;${fc.mask}=0` : ''}` : ''}`)
    sub.oneOf.forEach((b, i) => { const [o, tb] = child(b); out.push(`if(${o}){${nc}++;${tc}=${tb}${fc ? `;${fc.count}++${fc.mask ? `;${fc.mask}|=${1 << i}` : ''}` : ''}}`) })
    out.push(`if(${nc}===1){${raise(tc)}}else ${ok}=0`)
  }
  if (sub.if !== undefined) {
    const [oi, ti] = child(sub.if)
    const thenPart = []
    if (sub.then !== undefined) { const sv = out.length; const [ot, tt] = child(sub.then); thenPart.push(...out.splice(sv)); thenPart.push(`if(!${ot})${ok}=0;else ${raise(tt)}`) }
    const elsePart = []
    if (sub.else !== undefined) { const sv = out.length; const [oe, te] = child(sub.else); elsePart.push(...out.splice(sv)); elsePart.push(`if(!${oe})${ok}=0;else ${raise(te)}`) }
    out.push(`if(${oi}){${raise(ti)};${thenPart.join(';')}}else{${elsePart.join(';')}}`)
  }
  if (typeof sub.$ref === 'string') { const [o, tb] = child(refTargetFor(sub.$ref, ctx)); out.push(`if(!${o})${ok}=0;else ${raise(tb)}`) }
  out.push(`if(${ok}&&${t}>${tn})${tn}=${t}`)
}
function inlineUnevalItemsBlock (schema, v, pathExpr, ctx, schemaPrefix, fail) {
  if (!ctx.inCombined || !annotItemsFit(schema, ctx, new Set(), true)) return null
  const saved = snapshotCtx(ctx)
  try {
    const id = ctx.varCounter++
    const n = `_un${id}`, len = `_ul${id}`
    const out = [`const ${len}=${v}.length;let ${n}=0`]
    const own = ownPrefix(schema, len, true)
    if (own !== null) out.push(`${n}=${own}`)
    let bi = 0
    const child = (b) => { const o = `_ok${id}_${bi}`, tb = `_tb${id}_${bi}`; bi++; out.push(`let ${o}=1,${tb}=0`); emitAnnotInlineI(b, v, len, ctx, out, o, tb); return [o, tb] }
    const raise = (tb) => `if(${tb}>${n})${n}=${tb}`
    for (const b of schema.allOf || []) { const [, tb] = child(b); out.push(raise(tb)) }
    if (Array.isArray(schema.anyOf)) {
      const fc = factoryCount(ctx, schema.anyOf, false)
      if (fc) out.push(`${fc.of}=${v};${fc.count}=0`)
      for (const b of schema.anyOf) { const [o, tb] = child(b); out.push(`if(${o}){${raise(tb)}${fc ? `;${fc.count}++` : ''}}`) }
    }
    if (Array.isArray(schema.oneOf)) {
      const fc = factoryCount(ctx, schema.oneOf, schema.oneOf.length <= 30)
      const nc = `_nc${id}`, tc = `_tc${id}`
      out.push(`let ${nc}=0,${tc}=0${fc ? `;${fc.of}=${v};${fc.count}=0${fc.mask ? `;${fc.mask}=0` : ''}` : ''}`)
      schema.oneOf.forEach((b, i) => { const [o, tb] = child(b); out.push(`if(${o}){${nc}++;${tc}=${tb}${fc ? `;${fc.count}++${fc.mask ? `;${fc.mask}|=${1 << i}` : ''}` : ''}}`) })
      out.push(`if(${nc}===1)${raise(tc)}`)
    }
    if (schema.if !== undefined) {
      const [oi, ti] = child(schema.if)
      const thenPart = []
      if (schema.then !== undefined) { const sv = out.length; const [ot, tt] = child(schema.then); thenPart.push(...out.splice(sv)); thenPart.push(`if(${ot})${raise(tt)}`) }
      const elsePart = []
      if (schema.else !== undefined) { const sv = out.length; const [oe, te] = child(schema.else); elsePart.push(...out.splice(sv)); elsePart.push(`if(${oe})${raise(te)}`) }
      out.push(`if(${oi}){${raise(ti)};${thenPart.join(';')}}else{${elsePart.join(';')}}`)
    }
    if (typeof schema.$ref === 'string') { const [o, tb] = child(refTargetFor(schema.$ref, ctx)); out.push(`if(${o})${raise(tb)}`) }
    const iv = `_ix${id}`
    const ui2 = schema.unevaluatedItems
    if (ui2 === false) {
      // Reported once, at the first position left, as the interpreter does.
      out.push(`if(${n}<${len}){const ${iv}=${n};${fail('unevaluatedItems', 'unevaluatedItems', `{limit:${iv}}`, `'must NOT have more than '+${iv}+' items'`)}}`)
    } else if (typeof ui2 === 'object' && ui2 !== null) {
      const pe = pathExpr ? `${pathExpr}+'/'+${iv}` : `'/'+${iv}`
      const sub = []
      genCodeC(ui2, `${v}[${iv}]`, pe, sub, ctx, schemaPrefix + '/unevaluatedItems')
      if (sub.length) out.push(`for(let ${iv}=${n};${iv}<${len};${iv}++){${sub.join('\n  ')}\n  }`)
    } else {
      throw DECLINE
    }
    const text = out.join(';')
    if (text.length > ANNOT_INLINE_MAX || /\b(?:_validate|_stk|_sd|_sg|_CYC)\b/.test(text)) { restoreCtx(ctx, saved); return null }
    return text
  } catch (e) {
    if (e !== DECLINE) throw e
    restoreCtx(ctx, saved)
    return null
  }
}

function genUnevaluatedItemsDynamicC(schema, v, pathExpr, lines, ctx, schemaPrefix, fail) {
  if (schema.$dynamicRef !== undefined || schema.$recursiveRef !== undefined) throw DECLINE
  if (Array.isArray(schema.items) || schema.additionalItems !== undefined) throw DECLINE
  const inline = inlineUnevalItemsBlock(schema, v, pathExpr, ctx, schemaPrefix, fail)
  if (inline !== null) { lines.push(`if(Array.isArray(${v})){${inline}}`); return }
  annItemHelpers(ctx)
  const ui = ctx.varCounter++
  const S = `_es${ui}`
  const body = [`const ${S}={n:0,x:null}`]
  addLocalItemAnnotations(schema, v, S, body, ctx)
  for (const b of schema.allOf || []) body.push(`${emitAnnotI(b, ctx)}(${v},${S})`)
  if (Array.isArray(schema.anyOf)) for (const b of schema.anyOf) body.push(`${emitAnnotI(b, ctx)}(${v},${S})`)
  if (Array.isArray(schema.oneOf)) {
    body.push(`{const _n0=${S}.n,_x0=${S}.x===null?0:${S}.x.length;let _c=0;${schema.oneOf.map((b) => `if(${emitAnnotI(b, ctx)}(${v},${S}))_c++;`).join('')}if(_c!==1)_rbI(${S},_n0,_x0)}`)
  }
  if (schema.if !== undefined) {
    const thenCall = schema.then !== undefined ? `${emitAnnotI(schema.then, ctx)}(${v},${S})` : ''
    const elseCall = schema.else !== undefined ? `${emitAnnotI(schema.else, ctx)}(${v},${S})` : ''
    body.push(`if(${emitAnnotI(schema.if, ctx)}(${v},${S})){${thenCall}}else{${elseCall}}`)
  }
  if (typeof schema.$ref === 'string') body.push(`${emitAnnotI(refTargetFor(schema.$ref, ctx), ctx)}(${v},${S})`)
  const iv = `_ix${ui}`
  const ui2 = schema.unevaluatedItems
  if (ui2 === false) {
    const failI = fail('unevaluatedItems', 'unevaluatedItems', `{limit:${iv}}`, `'must NOT have more than '+${iv}+' items'`)
    body.push(`for(let ${iv}=0;${iv}<${v}.length;${iv}++){if(_hI(${S},${iv}))continue;${failI};break}`)
  } else if (typeof ui2 === 'object' && ui2 !== null) {
    const pe = pathExpr ? `${pathExpr}+'/'+${iv}` : `'/'+${iv}`
    const sub = []
    genCodeC(ui2, `${v}[${iv}]`, pe, sub, ctx, schemaPrefix + '/unevaluatedItems')
    if (sub.length) body.push(`for(let ${iv}=0;${iv}<${v}.length;${iv}++){if(_hI(${S},${iv}))continue;${sub.join('\n  ')}\n  }`)
  } else {
    throw DECLINE
  }
  lines.push(`if(Array.isArray(${v})){${body.join(';')}}`)
}

function annItemHelpers(ctx) {
  if (ctx.annItemHelpers) return
  ctx.annItemHelpers = true
  ;(ctx.preamble || ctx.helperCode).push(
    'function _aI(S,i){if(i<S.n)return;if(i===S.n){S.n=i+1;return}(S.x||(S.x=[])).push(i)}' +
    'function _mrI(S,f,t){if(f>=t)return;if(f<=S.n){if(t>S.n)S.n=t;return}const x=S.x||(S.x=[]);for(let i=f;i<t;i++)x.push(i)}' +
    'function _hI(S,i){if(i<S.n)return true;const x=S.x;if(x===null)return false;for(let j=0;j<x.length;j++)if(x[j]===i)return true;return false}' +
    'function _rbI(S,n,l){S.n=n;if(S.x!==null)S.x.length=l}' +
    'function _anIT(){return true}function _anIF(){return false}')
}

// The positions a node's own keywords evaluate, marked on `S`, for an array.
function addLocalItemAnnotations(node, v, S, out, ctx) {
  if (Array.isArray(node.items) || node.additionalItems !== undefined) throw DECLINE
  const prefix = Array.isArray(node.prefixItems) ? node.prefixItems.length : 0
  if (prefix) out.push(`_mrI(${S},0,Math.min(${v}.length,${prefix}))`)
  if (node.items !== undefined) out.push(`_mrI(${S},${prefix},${v}.length)`)
  if (node.contains !== undefined) {
    const cl = []
    nestedGenCode(node.contains, '_cv', cl, ctx)
    const ci = ctx.varCounter++
    ;(ctx.preamble || ctx.helperCode).push(`function _cI${ci}(_cv){${cl.join('\n  ')}\n  return true}`)
    out.push(`for(let _i=0;_i<${v}.length;_i++)if(_cI${ci}(${v}[_i]))_aI(${S},_i)`)
  }
}

// The keywords an item annotation function evaluates through its children;
// the rest of a subschema is checked by a plain verdict.
const ANNOT_ITEM_APPLICATORS = new Set(['allOf', 'anyOf', 'oneOf', 'if', 'then', 'else', '$ref', 'not', 'unevaluatedItems'])

// A function `(value, S) => valid` for one subschema, marking on S the array
// positions it evaluated when it passes, and leaving S as it was when it does
// not. A subschema with an unevaluatedItems of its own evaluates every
// position once that passes, so it works on a record of its own and then
// marks them all.
function emitAnnotI(sub, ctx) {
  if (sub === true) return '_anIT'
  if (sub === false) return '_anIF'
  if (sub === null || typeof sub !== 'object') throw DECLINE
  if (!ctx.annFnsI) ctx.annFnsI = new Map()
  const hit = ctx.annFnsI.get(sub)
  if (hit !== undefined) {
    if (hit === null) throw DECLINE
    return hit
  }
  if (sub.$dynamicRef !== undefined || sub.$recursiveRef !== undefined) throw DECLINE
  if (Array.isArray(sub.items) || sub.additionalItems !== undefined) throw DECLINE
  // unevaluatedProperties reads the applicators too, which the local verdict
  // below leaves out.
  if (sub.unevaluatedProperties !== undefined && sub.unevaluatedProperties !== true) throw DECLINE
  ctx.annFnsI.set(sub, null)
  annItemHelpers(ctx)
  const name = `_ai${ctx.varCounter++}`
  const local = {}
  for (const k of Object.keys(sub)) if (!ANNOT_ITEM_APPLICATORS.has(k)) setOwn(local, k, sub[k])
  const vl = []
  nestedGenCode(local, '_av', vl, ctx)
  const decls = [`function ${name}_v(_av){${vl.join('\n  ')}\n  return true}`]
  const body = [`if(!${name}_v(d))return false`]
  if (sub.not !== undefined) {
    const nl = []
    nestedGenCode(sub.not, '_nv', nl, ctx)
    decls.push(`function ${name}_n(_nv){${nl.join('\n  ')}\n  return true}`)
    body.push(`if(${name}_n(d))return false`)
  }
  const own = sub.unevaluatedItems !== undefined && sub.unevaluatedItems !== true
  const R = own ? '_R' : 'S'
  body.push(own ? `const _R={n:0,x:null}` : `const _n0=S.n,_x0=S.x===null?0:S.x.length`)
  const failOut = own ? 'return false' : '{_rbI(S,_n0,_x0);return false}'
  const locals = []
  addLocalItemAnnotations(sub, 'd', R, locals, ctx)
  if (locals.length) body.push(`if(Array.isArray(d)){${locals.join(';')}}`)
  for (const b of sub.allOf || []) body.push(`if(!${emitAnnotI(b, ctx)}(d,${R}))${failOut}`)
  if (Array.isArray(sub.anyOf)) body.push(`{let _a=false;${sub.anyOf.map((b) => `if(${emitAnnotI(b, ctx)}(d,${R}))_a=true;`).join('')}if(!_a)${failOut}}`)
  if (Array.isArray(sub.oneOf)) body.push(`{let _c=0;${sub.oneOf.map((b) => `if(${emitAnnotI(b, ctx)}(d,${R})&&++_c>1)${failOut}`).join('')}if(_c!==1)${failOut}}`)
  if (sub.if !== undefined) {
    const thenCheck = sub.then !== undefined ? `if(!${emitAnnotI(sub.then, ctx)}(d,${R}))${failOut}` : ''
    const elseCheck = sub.else !== undefined ? `if(!${emitAnnotI(sub.else, ctx)}(d,${R}))${failOut}` : ''
    body.push(`if(${emitAnnotI(sub.if, ctx)}(d,${R})){${thenCheck}}else{${elseCheck}}`)
  }
  if (typeof sub.$ref === 'string') body.push(`if(!${emitAnnotI(refTargetFor(sub.$ref, ctx), ctx)}(d,${R}))${failOut}`)
  if (own) {
    const u = sub.unevaluatedItems
    if (u === false) {
      body.push(`if(Array.isArray(d)){for(let _i=0;_i<d.length;_i++)if(!_hI(_R,_i))return false}`)
    } else if (typeof u === 'object' && u !== null) {
      const ul = []
      nestedGenCode(u, '_uv', ul, ctx)
      decls.push(`function ${name}_u(_uv){${ul.join('\n  ')}\n  return true}`)
      body.push(`if(Array.isArray(d)){for(let _i=0;_i<d.length;_i++)if(!_hI(_R,_i)&&!${name}_u(d[_i]))return false}`)
    } else {
      throw DECLINE
    }
    body.push(`if(Array.isArray(d))_mrI(S,0,d.length)`)
  }
  // `unevaluatedItems: true` evaluates every position once the subschema
  // has passed, with nothing to check; marked last, so a failure above has
  // nothing of it to undo.
  if (sub.unevaluatedItems === true) body.push(`if(Array.isArray(d))_mrI(S,0,d.length)`)
  decls.push(`function ${name}(d,S){${body.join(';')};return true}`)
  ;(ctx.preamble || ctx.helperCode).push(decls.join(''))
  ctx.annFnsI.set(sub, name)
  return name
}

function genUnevaluatedFalseC(schema, v, pathExpr, lines, ctx, schemaPrefix, fail, isObj) {
  const propKeysU = Object.keys(schema.properties || {})
  const ui = ctx.varCounter++
  const failU = fail('unevaluatedProperties', 'unevaluatedProperties', `{unevaluatedProperty:_k${ui}[_i]}`, "'must NOT have unevaluated properties'")
  let innerU
  if (propKeysU.length === 0) {
    innerU = `const _k${ui}=Object.keys(${v});for(let _i=0;_i<_k${ui}.length;_i++){${failU}}`
  } else if (propKeysU.length <= 8) {
    const checksU = propKeysU.map(k => `_k${ui}[_i]!==${JSON.stringify(k)}`).join('&&')
    innerU = `const _k${ui}=Object.keys(${v});for(let _i=0;_i<_k${ui}.length;_i++)if(${checksU}){${failU}}`
  } else {
    ctx.closureVars.push(`_a${ui}`)
    ctx.closureVals.push(new Set(propKeysU))
    innerU = `const _k${ui}=Object.keys(${v});for(let _i=0;_i<_k${ui}.length;_i++)if(!_a${ui}.has(_k${ui}[_i])){${failU}}`
  }
  lines.push(isObj ? `{${innerU}}` : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){${innerU}}`)
}

function genUnevaluatedItemsFalseC(schema, v, pathExpr, lines, ctx, schemaPrefix, fail) {
  const itemsIsPrefixC = Array.isArray(schema.items)
  const allEvalC = schema.items !== undefined && !itemsIsPrefixC
  if (!allEvalC) {
    const plenC = itemsIsPrefixC ? schema.items.length : (Array.isArray(schema.prefixItems) ? schema.prefixItems.length : 0)
    const failI = fail('unevaluatedItems', 'unevaluatedItems', `{limit:${plenC}}`, `'must NOT have more than ${plenC} items'`)
    lines.push(`if(Array.isArray(${v})&&${v}.length>${plenC}){${failI}}`)
  }
}

// The error generator's per-key loop (genAdditionalSchemaE), in the combined
// generator: the subschema compiled by genCodeC at each additional key, with
// that key's path. Patterns go through the same matchers patternProperties
// uses here.
function genAdditionalSchemaC(schema, v, pathExpr, lines, ctx, schemaPrefix, isObj) {
  const ki = ctx.varCounter++
  const kVar = `_ak${ki}`
  const known = Object.keys(schema.properties || {})
  const conds = []
  if (known.length) {
    const set = `_akn${ki}`
    ctx.closureVars.push(set)
    ctx.closureVals.push(new Set(known))
    conds.push(`!${set}.has(${kVar})`)
  }
  const pats = []
  for (const pat of Object.keys(schema.patternProperties || {})) {
    const fast = fastPrefixCheck(pat, kVar)
    if (fast) { pats.push(fast); continue }
    const ri = ctx.varCounter++
    ctx.closureVars.push(`_re${ri}`)
    ctx.closureVals.push(safeReClosure(ctx, pat))
    pats.push(`_re${ri}.test(${kVar})`)
  }
  if (pats.length) conds.push(`!(${pats.join('||')})`)
  const guard = isObj ? '' : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v}))`
  const keep = conds.length ? `if(${conds.join('&&')})` : ''
  const pe = emitPtrEsc(ctx)
  const p = pathExpr ? `${pathExpr}+'/'+${pe}(${kVar})` : `'/'+${pe}(${kVar})`
  const sub = []
  genCodeC(schema.additionalProperties, `${v}[${kVar}]`, p, sub, ctx, schemaPrefix + '/additionalProperties')
  if (sub.length === 0) return
  lines.push(`${guard}{for(const ${kVar} in ${v}){${keep}{${sub.join('\n  ')}\n  }}}`)
}

function genPatternPropertiesC(schema, v, pathExpr, lines, ctx, schemaPrefix, fail, isObj) {
  let handledPropertyNames = false
  const ppEntries = Object.entries(schema.patternProperties)
  const pn = isSimplePN(schema.propertyNames) ? schema.propertyNames : null
  const pi = ctx.varCounter++

  // Build pattern matchers: prefer charCodeAt for simple prefixes
  const matchers = []
  for (const [pat] of ppEntries) {
    const kVar = `_k${pi}`
    const fast = fastPrefixCheck(pat, kVar)
    if (fast) {
      matchers.push({ check: fast })
    } else {
      const ri = ctx.varCounter++
      ctx.closureVars.push(`_re${ri}`)
      ctx.closureVals.push(safeReClosure(ctx, pat))
      matchers.push({ check: `_re${ri}.test(_k${pi})` })
    }
  }

  const guard = isObj ? '' : `if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v}))`
  const kVar = `_k${pi}`

  if (schema.additionalProperties === false) {
    handledPropertyNames = !!pn
    const propKeys = Object.keys(schema.properties || {})
    // Inline key comparison for small property sets
    const keyCheck = propKeys.length <= 8
      ? propKeys.map(k => `${kVar}===${JSON.stringify(k)}`).join('||')
      : null
    if (!keyCheck) {
      const allowedSet = `_as${pi}`
      ctx.closureVars.push(allowedSet)
      ctx.closureVals.push(new Set(propKeys))
    }

    lines.push(`${guard}{for(const ${kVar} in ${v}){`)
    // propertyNames checks (merged)
    if (pn) {
      if (pn.minLength !== undefined) lines.push(`if(${kVar}.length<${pn.minLength}){${fail('minLength', 'propertyNames/minLength', `{limit:${pn.minLength}}`, `'must NOT have fewer than ${pn.minLength} characters'`)}}`)
      if (pn.maxLength !== undefined) lines.push(`if(${kVar}.length>${pn.maxLength}){${fail('maxLength', 'propertyNames/maxLength', `{limit:${pn.maxLength}}`, `'must NOT have more than ${pn.maxLength} characters'`)}}`)
      if (pn.pattern) {
        const fast = fastPrefixCheck(pn.pattern, kVar)
        if (fast) {
          lines.push(`if(!(${fast})){${fail('pattern', 'propertyNames/pattern', `{pattern:${JSON.stringify(pn.pattern)}}`, JSON.stringify(`must match pattern "${pn.pattern}"`))}}`)
        } else {
          const ri = ctx.varCounter++
          ctx.closureVars.push(`_re${ri}`)
          ctx.closureVals.push(safeReClosure(ctx, pn.pattern))
          lines.push(`if(!_re${ri}.test(${kVar})){${fail('pattern', 'propertyNames/pattern', `{pattern:${JSON.stringify(pn.pattern)}}`, JSON.stringify(`must match pattern "${pn.pattern}"`))}}`)
        }
      }
      if (pn.const !== undefined) lines.push(`if(${kVar}!==${JSON.stringify(pn.const)}){${fail('const', 'propertyNames/const', `{allowedValue:${JSON.stringify(pn.const)}}`, "'must be equal to constant'")}}`)
      if (pn.enum) {
        const ei = ctx.varCounter++
        ctx.closureVars.push(`_es${ei}`)
        ctx.closureVals.push(new Set(pn.enum))
        lines.push(`if(!_es${ei}.has(${kVar})){${fail('enum', 'propertyNames/enum', `{allowedValues:${JSON.stringify(pn.enum)}}`, "'must be equal to one of the allowed values'")}}`)
      }
    }
    const matchExpr = keyCheck || `_as${pi}.has(${kVar})`
    lines.push(`let _m${pi}=${matchExpr}`)
    for (let i = 0; i < ppEntries.length; i++) {
      // The subschema is generated in place so its own keywords report
      // the real instance path and schema pointer.
      lines.push(`if(${matchers[i].check}){_m${pi}=true;{const _ppv${pi}_${i}=${v}[${kVar}]`)
      genCodeC(ppEntries[i][1], `_ppv${pi}_${i}`, childPathDynExpr(pathExpr, `${emitPtrEsc(ctx)}(${kVar})`), lines, ctx, schemaPrefix + '/patternProperties/' + ptrSeg(ppEntries[i][0]))
      lines.push(`}}`)
    }
    lines.push(`if(!_m${pi}){${fail('additionalProperties', 'additionalProperties', `{additionalProperty:${kVar}}`, "'must NOT have additional properties'")}}`)
    lines.push(`}}`)
  } else {
    handledPropertyNames = !!pn
    lines.push(`${guard}{for(const ${kVar} in ${v}){`)
    if (pn) {
      if (pn.minLength !== undefined) lines.push(`if(${kVar}.length<${pn.minLength}){${fail('minLength', 'propertyNames/minLength', `{limit:${pn.minLength}}`, `'must NOT have fewer than ${pn.minLength} characters'`)}}`)
      if (pn.maxLength !== undefined) lines.push(`if(${kVar}.length>${pn.maxLength}){${fail('maxLength', 'propertyNames/maxLength', `{limit:${pn.maxLength}}`, `'must NOT have more than ${pn.maxLength} characters'`)}}`)
      if (pn.pattern) {
        const fast = fastPrefixCheck(pn.pattern, kVar)
        if (fast) {
          lines.push(`if(!(${fast})){${fail('pattern', 'propertyNames/pattern', `{pattern:${JSON.stringify(pn.pattern)}}`, JSON.stringify(`must match pattern "${pn.pattern}"`))}}`)
        } else {
          const ri = ctx.varCounter++
          ctx.closureVars.push(`_re${ri}`)
          ctx.closureVals.push(safeReClosure(ctx, pn.pattern))
          lines.push(`if(!_re${ri}.test(${kVar})){${fail('pattern', 'propertyNames/pattern', `{pattern:${JSON.stringify(pn.pattern)}}`, JSON.stringify(`must match pattern "${pn.pattern}"`))}}`)
        }
      }
      if (pn.const !== undefined) lines.push(`if(${kVar}!==${JSON.stringify(pn.const)}){${fail('const', 'propertyNames/const', `{allowedValue:${JSON.stringify(pn.const)}}`, "'must be equal to constant'")}}`)
      if (pn.enum) {
        const ei = ctx.varCounter++
        ctx.closureVars.push(`_es${ei}`)
        ctx.closureVals.push(new Set(pn.enum))
        lines.push(`if(!_es${ei}.has(${kVar})){${fail('enum', 'propertyNames/enum', `{allowedValues:${JSON.stringify(pn.enum)}}`, "'must be equal to one of the allowed values'")}}`)
      }
    }
    for (let i = 0; i < ppEntries.length; i++) {
      lines.push(`if(${matchers[i].check}){const _ppv${pi}_${i}=${v}[${kVar}]`)
      genCodeC(ppEntries[i][1], `_ppv${pi}_${i}`, childPathDynExpr(pathExpr, `${emitPtrEsc(ctx)}(${kVar})`), lines, ctx, schemaPrefix + '/patternProperties/' + ptrSeg(ppEntries[i][0]))
      lines.push(`}`)
    }
    lines.push(`}}`)
  }
  return handledPropertyNames
}

function genDependentSchemasC(schema, v, pathExpr, lines, ctx, schemaPrefix) {
  for (const [key, depSchema] of Object.entries(schema.dependentSchemas)) {
    lines.push(`if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})&&${ownKeyExpr(ctx, v, key)}){`)
    genCodeC(depSchema, v, pathExpr, lines, ctx, schemaPrefix+'/dependentSchemas/'+ptrSeg(key))
    lines.push(`}`)
  }
}

function genPropertyNamesFalseC(schema, v, pathExpr, lines, ctx, schemaPrefix) {
  const ki = ctx.varCounter++
  const p = pathExpr || '""'
  lines.push(`;if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){for(const _k${ki} in ${v}){${errPushC(ctx, 'not', `${schemaPrefix}/propertyNames`, pathExpr, '{}', "'boolean schema is false'", v, `{keyword:'not',instancePath:${p},schemaPath:'${schemaPrefix}/propertyNames'${ordinalField(ctx, `${schemaPrefix}/propertyNames`)},params:{},message:'boolean schema is false'}`)}}}`)
}

function genPropertyNamesC(schema, v, pathExpr, lines, ctx, schemaPrefix, fail) {
  const pn = schema.propertyNames
  const ki = ctx.varCounter++
  // In the rich function an error carries the value it was raised on, and
  // here that would be the key where the interpreter's error points at the
  // object, so that one is left to the plain function and enrichment.
  if (!isSimplePN(pn) && ctx.rich) throw DECLINE
  lines.push(`if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})){for(const _k${ki} in ${v}){`)
  if (!isSimplePN(pn)) {
    genCodeC(pn, `_k${ki}`, pathExpr, lines, ctx, schemaPrefix + '/propertyNames')
    lines.push(`}}`)
    return
  }
  if (pn.minLength !== undefined) {
    lines.push(`if(_k${ki}.length<${pn.minLength}){${fail('minLength', 'propertyNames/minLength', `{limit:${pn.minLength}}`, `'must NOT have fewer than ${pn.minLength} characters'`)}}`)
  }
  if (pn.maxLength !== undefined) {
    lines.push(`if(_k${ki}.length>${pn.maxLength}){${fail('maxLength', 'propertyNames/maxLength', `{limit:${pn.maxLength}}`, `'must NOT have more than ${pn.maxLength} characters'`)}}`)
  }
  if (pn.pattern) {
    const ri = ctx.varCounter++
    ctx.closureVars.push(`_re${ri}`)
    ctx.closureVals.push(safeReClosure(ctx, pn.pattern))
    lines.push(`if(!_re${ri}.test(_k${ki})){${fail('pattern', 'propertyNames/pattern', `{pattern:${JSON.stringify(pn.pattern)}}`, JSON.stringify(`must match pattern "${pn.pattern}"`))}}`)
  }
  if (pn.const !== undefined) {
    lines.push(`if(_k${ki}!==${JSON.stringify(pn.const)}){${fail('const', 'propertyNames/const', `{allowedValue:${JSON.stringify(pn.const)}}`, "'must be equal to constant'")}}`)
  }
  if (pn.enum) {
    const ei = ctx.varCounter++
    ctx.closureVars.push(`_es${ei}`)
    ctx.closureVals.push(new Set(pn.enum))
    lines.push(`if(!_es${ei}.has(_k${ki})){${fail('enum', 'propertyNames/enum', `{allowedValues:${JSON.stringify(pn.enum)}}`, "'must be equal to one of the allowed values'")}}`)
  }
  lines.push(`}}`)
}

function genPrefixItemsC(schema, v, pathExpr, lines, ctx, schemaPrefix) {
  for (let i = 0; i < schema.prefixItems.length; i++) {
    const childPath = childPathExpr(pathExpr, String(i))
    lines.push(`if(Array.isArray(${v})&&${v}.length>${i}){`)
    genCodeC(schema.prefixItems[i], `${v}[${i}]`, childPath, lines, ctx, schemaPrefix+'/prefixItems/'+i)
    lines.push(`}`)
  }
}

function genContainsC(schema, v, pathExpr, lines, ctx, schemaPrefix, fail) {
  const ci = ctx.varCounter++
  const subLines = []
  nestedGenCode(schema.contains, `_cv`, subLines, ctx)
  const fnBody = subLines.length === 0 ? `return true` : `${subLines.join(';')};return true`
  const minC = schema.minContains !== undefined ? schema.minContains : 1
  const maxC = schema.maxContains
  lines.push(`if(Array.isArray(${v})){const _cf${ci}=function(_cv){${fnBody}};let _cc${ci}=0;for(let _ci${ci}=0;_ci${ci}<${v}.length;_ci${ci}++){if(_cf${ci}(${v}[_ci${ci}]))_cc${ci}++}`)
  lines.push(`if(_cc${ci}<${minC}){${fail('contains', 'contains', `{minContains:${minC}}`, `'must contain at least ${minC} valid item(s)'`)}}`)
  if (maxC !== undefined) lines.push(`if(_cc${ci}>${maxC}){${fail('contains', 'contains', `{minContains:${minC},maxContains:${maxC}}`, `'must NOT contain more than ${maxC} valid item(s)'`)}}`)
  lines.push(`}`)
}

function genAnyOfC(schema, v, pathExpr, lines, ctx, schemaPrefix, fail) {
  // The collapsed branch error the other engines report (ATA4001-4003),
  // built by the error generator's emitter; see compileToJSCombined.
  if (ctx.inCombined) return emitBranchCollapse(schema.anyOf, 'anyOf', v, pathExpr, lines, ctx, schemaPrefix)
  const fi = ctx.varCounter++
  const fns = schema.anyOf.map(sub => { const sl = []; nestedGenCode(sub, '_av', sl, ctx); return sl.length === 0 ? `function(_av){return true}` : `function(_av){${sl.join(';')};return true}` })
  lines.push(`{const _af${fi}=[${fns.join(',')}];let _am=false;for(let _ai=0;_ai<_af${fi}.length;_ai++){if(_af${fi}[_ai](${v})){_am=true;break}}if(!_am){${fail('anyOf', 'anyOf', '{}', "'must match a schema in anyOf'")}}}`)
}

function genOneOfC(schema, v, pathExpr, lines, ctx, schemaPrefix, fail) {
  // The collapsed branch error the other engines report (ATA4001-4003),
  // built by the error generator's emitter; see compileToJSCombined.
  if (ctx.inCombined) return emitBranchCollapse(schema.oneOf, 'oneOf', v, pathExpr, lines, ctx, schemaPrefix)
  const fi = ctx.varCounter++
  const fns = schema.oneOf.map(sub => { const sl = []; nestedGenCode(sub, '_ov', sl, ctx); return sl.length === 0 ? `function(_ov){return true}` : `function(_ov){${sl.join(';')};return true}` })
  lines.push(`{const _of${fi}=[${fns.join(',')}];let _oc=0;for(let _oi=0;_oi<_of${fi}.length;_oi++){if(_of${fi}[_oi](${v}))_oc++;if(_oc>1)break}if(_oc!==1){${fail('oneOf', 'oneOf', '{}', "'must match exactly one schema in oneOf'")}}}`)
}

function genNotC(schema, v, pathExpr, lines, ctx, schemaPrefix, fail) {
  const sl = []; nestedGenCode(schema.not, '_nv', sl, ctx)
  const nfn = sl.length === 0 ? `function(_nv){return true}` : `function(_nv){${sl.join(';')};return true}`
  const fi = ctx.varCounter++
  lines.push(`{const _nf${fi}=${nfn};if(_nf${fi}(${v})){${fail('not', 'not', '{}', "'must NOT be valid'")}}}`)
}

function genIfC(schema, v, pathExpr, lines, ctx, schemaPrefix) {
  const sl = []; nestedGenCode(schema.if, '_iv', sl, ctx)
  const fi = ctx.varCounter++
  const ifFn = sl.length === 0 ? `function(_iv){return true}` : `function(_iv){${sl.join(';')};return true}`
  lines.push(`{const _if${fi}=${ifFn}`)
  if (schema.then !== undefined) { lines.push(`if(_if${fi}(${v})){`); genCodeC(schema.then, v, pathExpr, lines, ctx, schemaPrefix+'/then'); lines.push(`}`) }
  if (schema.else !== undefined) { lines.push(`${schema.then !== undefined ? 'else' : `if(!_if${fi}(${v}))`}{`); genCodeC(schema.else, v, pathExpr, lines, ctx, schemaPrefix+'/else'); lines.push(`}`) }
  lines.push(`}`)
}

// Collect statically-known evaluated properties/items from a schema.
// Returns { props: string[], items: number|null, allProps: bool, allItems: bool, dynamic: bool }
function collectEvaluated(schema, schemaMap, rootDefs) {
  if (typeof schema !== 'object' || schema === null) return { props: [], items: null, allProps: false, allItems: false, dynamic: false }
  const defs = rootDefs || schema.$defs || schema.definitions || null
  const result = { props: [], items: null, allProps: false, allItems: false, dynamic: false }
  _collectEval(schema, result, defs, schemaMap, new Set(), true)
  return result
}

function _collectEval(schema, result, defs, schemaMap, refStack, isRoot) {
  if (typeof schema !== 'object' || schema === null) return
  if (result.allProps && result.allItems) return

  // $ref — inline
  if (schema.$ref) {
    const m = schema.$ref.match(/^#\/(?:\$defs|definitions)\/(.+)$/)
    if (m && defs && defs[m[1]]) {
      if (refStack.has(schema.$ref)) { result.dynamic = true; return }
      refStack.add(schema.$ref)
      _collectEval(defs[m[1]], result, defs, schemaMap, refStack)
      refStack.delete(schema.$ref)
    } else if (schemaMap && typeof schemaMap.get === 'function') {
      let resolved = schemaMap.has(schema.$ref) ? schemaMap.get(schema.$ref) : null
      // Relative URI resolution
      if (!resolved && !schema.$ref.includes('://') && !schema.$ref.startsWith('#')) {
        for (const [id, s] of schemaMap) {
          if (id.endsWith('/' + schema.$ref)) { resolved = s; break }
        }
      }
      if (resolved) {
        if (refStack.has(schema.$ref)) { result.dynamic = true; return }
        refStack.add(schema.$ref)
        _collectEval(resolved, result, defs, schemaMap, refStack)
        refStack.delete(schema.$ref)
      }
    }
    // In 2020-12, $ref can coexist with siblings — don't return early if there are other keywords
    const hasOtherKeywords = Object.keys(schema).some(k => k !== '$ref' && k !== '$defs' && k !== 'definitions' && k !== '$schema' && k !== '$id')
    if (!hasOtherKeywords) return
  }

  // properties → static keys
  if (schema.properties) {
    for (const k of Object.keys(schema.properties)) {
      if (!result.props.includes(k)) result.props.push(k)
    }
  }

  // additionalProperties: true/schema → all props evaluated
  if (schema.additionalProperties !== undefined && schema.additionalProperties !== false) {
    result.allProps = true
  }

  // patternProperties → dynamic
  if (schema.patternProperties) {
    result.dynamic = true
  }

  // prefixItems → max index
  if (schema.prefixItems) {
    const count = schema.prefixItems.length
    result.items = result.items === null ? count : Math.max(result.items, count)
  }

  // items: schema/true → all items evaluated
  if (schema.items && typeof schema.items === 'object') {
    result.allItems = true
  }
  if (schema.items === true) {
    result.allItems = true
  }

  // contains: marks matching items as evaluated (not ALL items)
  // Always set dynamic since which items match depends on the data
  if (schema.contains !== undefined) {
    result.dynamic = true
  }

  // unevaluatedProperties: true/schema → all props evaluated (for nested schemas only)
  // At root level, unevaluatedProperties is what we're computing FOR, not a contributor
  if (!isRoot && (schema.unevaluatedProperties === true || (typeof schema.unevaluatedProperties === 'object' && schema.unevaluatedProperties !== null))) {
    result.allProps = true
  }
  // unevaluatedItems: true/schema → all items evaluated (for nested schemas only)
  if (!isRoot && (schema.unevaluatedItems === true || (typeof schema.unevaluatedItems === 'object' && schema.unevaluatedItems !== null))) {
    result.allItems = true
  }

  // allOf → merge all (unconditional)
  if (schema.allOf) {
    for (const sub of schema.allOf) {
      _collectEval(sub, result, defs, schemaMap, refStack)
    }
  }

  // anyOf / oneOf → dynamic (conditional merge)
  if (schema.anyOf || schema.oneOf) {
    result.dynamic = true
    const branches = schema.anyOf || schema.oneOf
    for (const sub of branches) {
      _collectEval(sub, result, defs, schemaMap, refStack)
    }
  }

  // if/then/else → dynamic (branch-dependent)
  if (schema.if && (schema.then || schema.else)) {
    result.dynamic = true
    _collectEval(schema.if, result, defs, schemaMap, refStack)
    if (schema.then) _collectEval(schema.then, result, defs, schemaMap, refStack)
    if (schema.else) _collectEval(schema.else, result, defs, schemaMap, refStack)
  } else if (schema.if) {
    // Standalone if (no then/else) still produces annotations per spec
    // Only collect properties and patterns, not deep items (contains etc.)
    result.dynamic = true
    if (schema.if.properties) {
      for (const k of Object.keys(schema.if.properties)) {
        if (!result.props.includes(k)) result.props.push(k)
      }
    }
    if (schema.if.patternProperties) {
      // patternProperties contribute to dynamic evaluation
    }
  }

  // dependentSchemas → dynamic
  if (schema.dependentSchemas) {
    result.dynamic = true
    for (const sub of Object.values(schema.dependentSchemas)) {
      _collectEval(sub, result, defs, schemaMap, refStack)
    }
  }

  // not → contributes nothing (spec: annotations from not are discarded)
}

module.exports = { compileToJS, compileToJSCodegen, compileToJSCodegenWithErrors, compileToJSCombined, collectEvaluated, unevalContributions, expandedChars, AJV_MESSAGES, _setCodeBudget, _helperSources: { DEQ_HELPER, PTR_ESC_HELPER, OWN_HELPER_CODE } }
// For tests: the dynamic-scope unrolling, to hold its output to the interpreter.
Object.defineProperty(module.exports, '_expandDynamicScopes', { value: expandDynamicScopes, enumerable: false })
// For tests/test_custom_keyword_codegen.js, which holds these copies to the interpreter's.
Object.defineProperty(module.exports, '_kwTypeBits', { value: { kwTypeBit, kwDataBits, KW_T_ANY }, enumerable: false })
