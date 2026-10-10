'use strict'
const { env } = require('./env')
const { compileFunction } = require('./compile-fn')

// The error-collecting generator (genCodeE) and the one-pass generator
// (genCodeC, compileToJSCombined) of lib/js-compiler.js, in a module of their
// own so that a process which only ever answers verdicts never parses them:
// they are 45 percent of the generator's source, and the module is read on
// the first call that compiles errors. Everything here was written as part
// of js-compiler.js and reads its helpers from that module's _internal.
const core = require('./js-compiler')
const { hasConstraints, assertEmitted, prepareForCodegen, sharedCodegenGate, codegenSafe, isSimplePN, hasUnresolvableRef, needsBaseTracking, _cpLen, sharedRt, DECLINE, bindRt, compileSafe, emitGuardState, withPlain, REF_NEUTRAL_SIBLINGS, resolveCrossSchemaRef, enumCondition, enumOperand, emitDeq, emitConstant, ownGuard, ownKeyExpr, multipleOfBad, compilePatternInline, useSafeEngine, reFlags, FORMAT_CODEGEN, PROTO_NAMES, setOwn, nestedGenCode, compileToJSCodegen, SKIP_VALUE_KEYS, skipString, CYCLE_DEPTH, cyclicDefNames, sharedDefNames, reFlagArg, hoistOnce, PTR_ESC_HELPER, unevalContributions, emitUq, uqSources, safeReClosure, fastPrefixCheck, replaceTopLevel, refTargetFor, genCode, addLocalAnnotations, addTopApplicatorAnnotations, protoIs, ANNOT_APPLICATORS, SIZE_SKIPS, emitRootGuard, emitGuardedRun } = core._internal


function emitPtrEsc(ctx) {
  hoistOnce(ctx, '_peHoisted', PTR_ESC_HELPER)
  return '_pe'
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


const { codeFor } = require('./error-codes')
const { ordinalFor, rankFor } = require('./schema-order')

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

// Stands for the schema path of a call to a recursive definition's error
// helper while its body is generated; see genCodeENode. Not a pointer, so no
// ordinal or source frame is looked up for it at compile time.
const SP_PLACEHOLDER = '@@ata-sp@@'

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

// Same but for dynamic segments (array indices)
function childPathDynExpr(parentExpr, indexExpr) {
  if (!parentExpr) return `'/'+${indexExpr}`
  return `${parentExpr}+'/'+${indexExpr}`
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

  const ctx = { noOrdinal: !!(sourceOpts && sourceOpts.noOrdinal), varCounter: 0, helperCode: [], rootDefs: eRootDefs, shared: [], refStack: new Set(), schemaMap: schemaMap || null, anchors: eAnchors, rootE: schema, rootSchema: inputSchema, userFormats: userFormats || null,
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
  if (lines.length === 0) { if (hasConstraints(schema, false)) return null; return (d) => ({ valid: true, errors: [] }) }

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
      const make = compileFunction(...params, factoryBody)
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
      const built = compileFunction(...cvars, '__ataSafeRe', 'd', '_all', body)
      fn = cvars.length
        ? (d, _all) => built(...cvals, compileSafe, d, _all)
        : (d, _all) => built(compileSafe, d, _all)
    } else if (cvars.length) {
      const built = compileFunction(...cvars, 'd', '_all', body)
      fn = (d, _all) => built(...cvals, d, _all)
    } else {
      fn = compileFunction('d', '_all', body)
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
    if (env('ATA_DEBUG_ERRGEN')) console.error('error codegen declined:', e.message)
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
  // A standalone module does without the counting copies (noCounting): each
  // is a second copy of a branch's error body, 40 percent of a large module's
  // source, and a module's rejections are rare enough that running every
  // branch's error function and collapsing is the better trade.
  if (ctx.inCombined && (ctx.noOrdinal ? 'null' : '') === 'null' && !ctx.noCounting) {
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
    const ev = enumOperand(ctx, schema.enum, v, lines)
    lines.push(`if(!(${enumCondition(ctx, schema.enum, ev)})){${fail('enum', 'enum', `{allowedValues:${JSON.stringify(schema.enum)}}`, "'must be equal to one of the allowed values'")}}`)
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
      const sp = schemaPrefix+'/properties/'+ptrSeg(key)
      const from = lines.length
      lines.push(`if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})&&${ownKeyExpr(ctx, v, key)}){`)
      // A large subschema as a function of its own (emitPropFnE); false means inline.
      if (!propFnCandidateE(prop, ctx, sp) || !emitPropFnE(prop, `${v}[${JSON.stringify(key)}]`, childPath, lines, ctx, sp)) {
        genCodeE(prop, `${v}[${JSON.stringify(key)}]`, childPath, lines, ctx, sp)
      }
      lines.push(`}`)
      countInlineE(lines, from, ctx)
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
  const ctx = { noCounting: !!(opts && opts.noCounting), noOrdinal: !!(opts && opts.runtimeShape), rich: !!(opts && opts.rich), inCombined: true, hoisted: [], rootC: schema, varCounter: 0, preamble: [], helperCode: [], shared: [], closureVars: ['_cpLen', '_A', '_ap', '_sr', '_srX'], closureVals: [_cpLen, sharedRt().apState(), sharedRt().ap, sharedRt().sr, sharedRt().srX], sharedRuntime: true,
                rootDefs: cRootDefs, refStack: new Set(), schemaMap: schemaMap || null, anchors: cAnchors, rootSchema: inputSchema, userFormats: userFormats || null }
  const lines = []
  try {
    genCodeC(schema, 'd', '', lines, ctx, '#')
  } catch (e) {
    if (e === DECLINE) return null
    throw e
  }
  if (lines.length === 0) { if (hasConstraints(schema, false)) return null; return () => VALID_RESULT }

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
      `\n  return _e?new _ER(_A.mo?_e:${env('ATA_CHECK_SORT') && !(opts && opts.emit) ? '_srX(_A,_e,_SRT)' : '_sr(_A,_e,_SRT)'}):${opts && opts.moduleShape ? 'R' : '{valid:true,data:d,errors:_EE}'}}catch(_x){return _FB(d)}`
    : hoistDecl + allDecl + `let _e;${AP_RESET}\n  ` + checks + `\n  return _e?{valid:false,errors:_e}:R`
  // The verdict generator's hoisted functions (subtreeGuard writes guards
  // through it) come first: a oneOf branch it could not hoist was a closure
  // built at every call of the guard, six per element of a json-patch list.
  const helpers = (ctx.preamble.length ? ctx.preamble.join('\n  ') + '\n  ' : '') + (ctx.helperCode.length ? ctx.helperCode.join('\n  ') + '\n  ' : '')

  try {
    if (env('ATA_DUMP_CODEGEN')) console.log('=== COMBINED CODEGEN ===\n' + helpers + inner + '\n=== CLOSURE VARS: ' + ctx.closureVars.length + ' ===')
    if (env('ATA_DUMP_PARTS')) {
      const cls = (t) => (t.match(/^\s*(?:const|function|let)\s+([A-Za-z_$]+?)(?=\d|\b|_)/) || [, 'other'])[1]
      const acc = {}
      for (const h of ctx.helperCode) { const k = 'helper:' + cls(h); acc[k] = (acc[k] || 0) + h.length }
      for (const h of ctx.preamble) { const k = 'preamble:' + cls(h); acc[k] = (acc[k] || 0) + h.length }
      acc.inner = inner.length
      console.log('=== COMBINED PARTS ===', JSON.stringify(Object.entries(acc).sort((a, b) => b[1] - a[1])))
    }
    const programSrc = assignOrdKeys(ctx, `${helpers}return function _vC(d){${inner}}`)
    const factory = compileFunction('R' + (closureParams ? ',' + closureParams : ''), programSrc)
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
    if (env('ATA_DEBUG')) console.error('compileToJSCombined error:', e.message, '\n', inner.slice(0, 500))
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

// The same split for the error collector (genCodeE): a large property
// subschema becomes `_pe<n>(d,_p,_all,_e)` in the helper code, pushing into
// the caller's list as an inlined body would, generated against the real
// schema path since it has one call site. Not inside a shared definition's
// body, whose placeholder path is substituted after the fact.
function propFnCandidateE (prop, ctx, schemaPrefix) {
  if (!ctx || ctx.nestedBoolean || ctx.condDepth) return false
  if (typeof schemaPrefix !== 'string' || schemaPrefix.includes(SP_PLACEHOLDER)) return false
  if (!prop || typeof prop !== 'object' || Array.isArray(prop)) return false
  let size = 0
  try { size = JSON.stringify(prop).length } catch { return false }
  return size >= SPLIT_C_SCHEMA || ((ctx.fnBytesE || 0) > SPLIT_C_BUDGET && size >= SPLIT_C_SMALL)
}
function emitPropFnE (prop, v, pathExpr, lines, ctx, schemaPrefix) {
  const outerBytes = ctx.fnBytesE
  ctx.fnBytesE = 0
  const bodyLines = []
  try { genCodeE(prop, 'd', '_p', bodyLines, ctx, schemaPrefix) } finally { ctx.fnBytesE = outerBytes }
  if (bodyLines.length === 0) return false
  const body = bodyLines.join('\n  ')
  if (body.includes(SP_PLACEHOLDER)) return false
  const fnName = '_pe' + (ctx.propFnsE = (ctx.propFnsE || 0) + 1)
  ctx.helperCode.push(`function ${fnName}(d,_p,_all,_e){${body}}`)
  lines.push(`${fnName}(${v},${pathExpr || '""'},_all,_e);if(!_all&&_e.length)return{valid:false,errors:_e}`)
  return true
}
function countInlineE (lines, from, ctx) {
  let n = 0
  for (let i = from; i < lines.length; i++) n += lines[i].length
  ctx.fnBytesE = (ctx.fnBytesE || 0) + n
}

// A large property subschema as a function of its own, for the reason the
// verdict generator has (emitPropFn in js-compiler.js): one function per
// schema outgrew what V8 optimizes, and a 167 KB configuration schema's
// one-pass function was 3.8 MB of source that ran in the interpreter. The
// function is used at one site, so it is generated against the real schema
// path and its errors keep their precise ordinal keys; it is not written
// inside a shared definition's body, whose placeholder path is substituted
// after the fact and would not reach a helper of its own.
const SPLIT_C_SCHEMA = 1500
const SPLIT_C_SMALL = 160
const SPLIT_C_BUDGET = 16 * 1024
function propFnCandidateC (prop, ctx, schemaPrefix) {
  if (!ctx || ctx.inDefC || ctx.nestedBoolean || ctx.condDepth) return false
  if (typeof schemaPrefix !== 'string' || schemaPrefix.includes(SP_PLACEHOLDER)) return false
  if (!prop || typeof prop !== 'object' || Array.isArray(prop)) return false
  let size = 0
  try { size = JSON.stringify(prop).length } catch { return false }
  return size >= SPLIT_C_SCHEMA || ((ctx.fnBytesC || 0) > SPLIT_C_BUDGET && size >= SPLIT_C_SMALL)
}
function emitPropFnC (prop, v, pathExpr, lines, ctx, schemaPrefix) {
  const outerHoisted = ctx.hoisted
  ctx.hoisted = []
  const outerBytes = ctx.fnBytesC
  ctx.fnBytesC = 0
  const bodyLines = []
  let hoisted
  try {
    genGuardedC(prop, '_dv', '_p', bodyLines, ctx, schemaPrefix)
  } finally {
    hoisted = ctx.hoisted
    ctx.hoisted = outerHoisted
    ctx.fnBytesC = outerBytes
  }
  if (bodyLines.length === 0) return false
  const body = bodyLines.join('\n  ')
  if (body.includes(SP_PLACEHOLDER) || /\b_so\b/.test(body)) return false
  const decl = hoisted.length ? `let ${hoisted.map((n) => n + '=null').join(',')};` : ''
  const fnName = '_pc' + (ctx.propFnsC = (ctx.propFnsC || 0) + 1)
  ctx.helperCode.push(`function ${fnName}(_dv,_p,d){const _all=true;${decl}let _e;\n  ${body}\n  return _e}`)
  lines.push(`{const _r=${fnName}(${v},${pathExpr || '""'},d);if(_r!==undefined){if(_e===undefined)_e=_r;else for(let _i=0;_i<_r.length;_i++)_e.push(_r[_i])}}`)
  return true
}
function countInlineC (lines, from, ctx) {
  let n = 0
  for (let i = from; i < lines.length; i++) n += lines[i].length
  ctx.fnBytesC = (ctx.fnBytesC || 0) + n
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
      const ev = enumOperand(ctx, schema.enum, v, lines)
      lines.push(`if(!(${enumCondition(ctx, schema.enum, ev)})){${fail('enum', 'enum', `{allowedValues:${JSON.stringify(schema.enum)}}`, "'must be equal to one of the allowed values'")}}`)
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
      const sp = schemaPrefix+'/properties/'+ptrSeg(key)
      const from = lines.length
      const split = propFnCandidateC(prop, ctx, sp)
      // A large subschema as a function of its own (emitPropFnC), called
      // where the inline code would be; false means it is written inline.
      const sub = (pvExpr) => { if (!split || !emitPropFnC(prop, pvExpr, childPath, lines, ctx, sp)) genGuardedC(prop, pvExpr, childPath, lines, ctx, sp) }
      if (requiredSet.has(key) && isObj) {
        // A hoisted local was already cleared if the value is only inherited.
        lines.push(`if(${pv}!==undefined${hoisted[key] ? '' : '&&' + ownGuard(ctx, v, key)}){`)
        sub(pv)
        lines.push(`}`)
      } else if (isObj) {
        const oi = ctx.varCounter++
        lines.push(`{const _o${oi}=${v}[${JSON.stringify(key)}];if(_o${oi}!==undefined&&${ownGuard(ctx, v, key)}){`)
        sub(`_o${oi}`)
        lines.push(`}}`)
      } else {
        lines.push(`if(typeof ${v}==='object'&&${v}!==null&&!Array.isArray(${v})&&${ownKeyExpr(ctx, v, key)}){`)
        sub(`${v}[${JSON.stringify(key)}]`)
        lines.push(`}`)
      }
      countInlineC(lines, from, ctx)
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
  assertEmitted(local, vl.length, local.type === undefined || local.type === 'object')
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
  assertEmitted(local, vl.length, local.type === undefined || local.type === 'array')
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

module.exports = { compileToJSCodegenWithErrors, compileToJSCombined }
