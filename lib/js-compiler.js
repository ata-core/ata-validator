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

// `_uq` compares items with `_deq`, so it can never be hoisted alone.
function emitUq(ctx) {
  emitDeq(ctx)
  hoistOnce(ctx, '_uqHoisted', uqSources().uq)
  return '_uq'
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
// The linear regex engine (safe-regex.js) is read on the first pattern a
// schema brings, not with this module: most schemas have none, and loading
// it cost every process part of its cold start. The two names keep their
// identity (compileSafe is handed to generated code as a closure value).
let _safeRe = null
const safeRe = () => _safeRe || (_safeRe = require('./safe-regex'))
function compileSafe (src) { return safeRe().compileSafe(src) }
function patternIsSafe (src) { return safeRe().patternIsSafe(src) }
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

// The format checkers' source (formats-source.js, 15 KB) is read only when a
// schema with a `format` is compiled; loading it with this module cost every
// process 0.8 ms of its cold start.
let _formatsCache = null
function getFormats () { return _formatsCache || (_formatsCache = { ...require('./formats'), ...require('./formats-source') }) }
// The closure path's formats. It carried its own idea of an email and knew
// five formats in all, so a schema that reached it was told "valid" for
// anything the other engines turned away; the first call on a fresh validator
// is the one that lands here. Every entry now names the same function the
// other two paths use, and the list is the list they implement.
const _fmtFns = require('./formats')
const FORMAT_CHECKS = {
  email: _fmtFns.email,
  'idn-email': _fmtFns.idnEmail,
  date: _fmtFns.date,
  'date-time': _fmtFns.dateTime,
  time: _fmtFns.time,
  duration: _fmtFns.duration,
  uuid: _fmtFns.uuid,
  uri: _fmtFns.uri,
  'uri-reference': _fmtFns.uriReference,
  'uri-template': _fmtFns.uriTemplate,
  iri: _fmtFns.iri,
  'iri-reference': _fmtFns.iriReference,
  ipv4: _fmtFns.ipv4,
  ipv6: _fmtFns.ipv6,
  hostname: _fmtFns.hostname,
  'json-pointer': _fmtFns.jsonPointer,
  'relative-json-pointer': _fmtFns.relativeJsonPointer,
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
const emailHelper = () => `function _em(_s){${getFormats().emailSource('_s', true)}return true}`

// `uri` is the most expensive format an ordinary document carries: a schema
// with a handful of URL fields spent more time here than on every structural
// check put together. The walk reads its character classes out of hoisted
// tables, so it is declared once per compiled function rather than inlined at
// each call site, where the tables would have to be rebuilt.
const uriHelper = () => getFormats().uriHelperSource('_uri')

const FORMAT_CODEGEN = {
  email: (v, isStr, ctx) => {
    if (!ctx) return getFormats().emailSource(v, isStr)
    hoistOnce(ctx, '_emHoisted', emailHelper())
    return isStr ? `if(!_em(${v}))return false` : `if(typeof ${v}==='string'&&!_em(${v}))return false`
  },
  'json-pointer': (...a) => getFormats().jsonPointerSource(...a),
  'relative-json-pointer': (...a) => getFormats().relativeJsonPointerSource(...a),
  'uri-template': (...a) => getFormats().uriTemplateSource(...a),
  iri: (...a) => getFormats().iriSource(...a),
  'iri-reference': (...a) => getFormats().iriReferenceSource(...a),
  'idn-email': (...a) => getFormats().idnEmailSource(...a),
  regex: (v, isStr) => {
    const inner = `try{new RegExp(${v},'u')}catch(_er){return false}`
    return isStr ? `{${inner}}` : `if(typeof ${v}==='string'){${inner}}`
  },
  date: (...a) => getFormats().dateSource(...a),
  uuid: (...a) => getFormats().uuidSource(...a),
  'date-time': (...a) => getFormats().dateTimeSource(...a),
  time: (...a) => getFormats().timeSource(...a),
  duration: (...a) => getFormats().durationSource(...a),
  uri: (v, isStr, ctx) => {
    if (!ctx) return getFormats().uriSource(v, isStr)
    hoistOnce(ctx, '_uriHoisted', uriHelper())
    return isStr ? `if(!_uri(${v}))return false` : `if(typeof ${v}==='string'&&!_uri(${v}))return false`
  },
  'uri-reference': (v, isStr) => isStr
    ? `{${getFormats().uriCharsSource(v, '0')}}`
    : `if(typeof ${v}==='string'){${getFormats().uriCharsSource(v, '0')}}`,
  ipv4: (v, isStr, ctx) => {
    if (!ctx) return getFormats().ipv4Source(v, isStr)
    // Hoisted: a regex literal in the body would build a new RegExp per call.
    hoistOnce(ctx, '_ip4Hoisted', 'const _ip4=/' + getFormats().IPV4.source + '/')
    return isStr ? `if(!_ip4.test(${v}))return false` : `if(typeof ${v}==='string'&&!_ip4.test(${v}))return false`
  },
  ipv6: (v, isStr, ctx) => {
    if (!ctx) return getFormats().ipv6Source(v, isStr)
    hoistOnce(ctx, '_ip6Hoisted', 'const _ip6f=/' + getFormats().IPV6_FULL.source + '/')
    // The fast accept jumps past the walk; the walk's `return false`s are what
    // the error generators rewrite, so they stay as they are.
    const body = `_ip6:{if(${v}.length>=15&&_ip6f.test(${v}))break _ip6;${getFormats().ipv6Source(v, true).replace(/^\{|\}$/g, '')}}`
    return isStr ? body : `if(typeof ${v}==='string'){${body}}`
  },
  hostname: (...a) => getFormats().hostnameSource(...a),
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
// The error generator and the one-pass (combined) generator live in
// lib/js-compiler-errors.js, read on the first call that needs them: a
// validator's errors are compiled when they are first read, and most
// processes load this module to answer verdicts. The two files were one; the
// generators share this module's helpers through _internal below, which is
// an implementation detail and not part of the package's interface.
let _errorsModule = null
function errorsModule () { return _errorsModule || (_errorsModule = require('./js-compiler-errors')) }
function compileToJSCodegenWithErrors (schema, schemaMap, userFormats, sourceOpts) { return errorsModule().compileToJSCodegenWithErrors(schema, schemaMap, userFormats, sourceOpts) }
function compileToJSCombined (schema, VALID_RESULT, schemaMap, userFormats, opts) { return errorsModule().compileToJSCombined(schema, VALID_RESULT, schemaMap, userFormats, opts) }


module.exports = { compileToJS, compileToJSCodegen, compileToJSCodegenWithErrors, compileToJSCombined, collectEvaluated, unevalContributions, expandedChars, AJV_MESSAGES, _setCodeBudget, _helperSources: { DEQ_HELPER, PTR_ESC_HELPER, OWN_HELPER_CODE } }
// For tests: the dynamic-scope unrolling, to hold its output to the interpreter.
Object.defineProperty(module.exports, '_expandDynamicScopes', { value: expandDynamicScopes, enumerable: false })
// For tests/test_custom_keyword_codegen.js, which holds these copies to the interpreter's.
Object.defineProperty(module.exports, '_kwTypeBits', { value: { kwTypeBit, kwDataBits, KW_T_ANY }, enumerable: false })

module.exports._internal = { prepareForCodegen, sharedCodegenGate, codegenSafe, isSimplePN, hasUnresolvableRef, needsBaseTracking, _cpLen, sharedRt, DECLINE, bindRt, compileSafe, emitGuardState, withPlain, REF_NEUTRAL_SIBLINGS, resolveCrossSchemaRef, enumCondition, emitDeq, emitConstant, ownGuard, ownKeyExpr, multipleOfBad, compilePatternInline, useSafeEngine, reFlags, FORMAT_CODEGEN, PROTO_NAMES, setOwn, nestedGenCode, compileToJSCodegen, SKIP_VALUE_KEYS, skipString, CYCLE_DEPTH, cyclicDefNames, sharedDefNames, reFlagArg, hoistOnce, PTR_ESC_HELPER, unevalContributions, emitUq, uqSources, safeReClosure, fastPrefixCheck, replaceTopLevel, refTargetFor, genCode, addLocalAnnotations, addTopApplicatorAnnotations, protoIs, ANNOT_APPLICATORS, SIZE_SKIPS, emitRootGuard, emitGuardedRun }
