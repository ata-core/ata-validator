'use strict'

// Schema mutations for the mutation checks (tests/test_core_mutation.js, and
// the 4b harness that runs a candidate engine through the same list).
//
// mutants(schema) walks every subschema of a schema and returns one changed
// copy per change: one keyword tightened, loosened or removed, everything else
// as it was. Each mutant names the keyword, the JSON pointer of the subschema
// it changed, what was done, and the contexts the subschema sits in:
//
//   top level             the root schema itself
//   through $ref          a $ref target or anything under one (local
//                         pointers, anchors, and $id names in the document)
//   through $dynamicRef   a $dynamicAnchor or $recursiveAnchor node a
//                         $dynamicRef or $recursiveRef can land on, or under one
//   in allOf, anyOf, oneOf, not, if/then/else
//                         under a branch of that keyword
//   under unevaluated*    under unevaluatedProperties or unevaluatedItems
//   beside unevaluated*   in a subschema whose own or an enclosing schema's
//                         unevaluated* keyword reads what it evaluates
//
// The contexts are read from the schema's shape, not from a run: a $ref is
// resolved by pointer, anchor or $id name within the document only.

const MAP = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']
const ONE = ['additionalProperties', 'unevaluatedProperties', 'additionalItems', 'unevaluatedItems', 'contains', 'propertyNames', 'not', 'if', 'then', 'else', 'contentSchema']
const LIST = ['prefixItems', 'allOf', 'anyOf', 'oneOf']
const TYPES = ['null', 'boolean', 'object', 'array', 'string', 'integer', 'number']
const SENTINEL = '__mutant__'

const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const esc = (k) => String(k).replace(/~/g, '~0').replace(/\//g, '~1')
const unesc = (k) => decodeURIComponent(k).replace(/~1/g, '/').replace(/~0/g, '~')

// Every subschema as { node, path: [segments] }, the root first.
function subschemas (root) {
  const out = []
  const seen = new Set()
  const visit = (n, path) => {
    if (n !== true && n !== false && !isObj(n)) return
    if (isObj(n)) { if (seen.has(n)) return; seen.add(n) }
    out.push({ node: n, path })
    if (!isObj(n)) return
    for (const k of MAP) if (isObj(n[k])) for (const p of Object.keys(n[k])) visit(n[k][p], path.concat(k, p))
    if (isObj(n.dependencies)) for (const p of Object.keys(n.dependencies)) if (!Array.isArray(n.dependencies[p])) visit(n.dependencies[p], path.concat('dependencies', p))
    for (const k of ONE) if (n[k] !== undefined) visit(n[k], path.concat(k))
    for (const k of LIST) if (Array.isArray(n[k])) n[k].forEach((s, i) => visit(s, path.concat(k, String(i))))
    if (Array.isArray(n.items)) n.items.forEach((s, i) => visit(s, path.concat('items', String(i))))
    else if (n.items !== undefined) visit(n.items, path.concat('items'))
  }
  visit(root, [])
  return out
}

const key = (path) => path.map(esc).join('/')

// The pointers (as keys) of the subschemas a reference in the document reaches.
function targets (root, subs) {
  const byPointer = new Map(subs.map((s) => [key(s.path), s]))
  const ref = new Set(); const dyn = new Set()
  const anchors = new Map(); const ids = new Map(); const dynAnchors = new Map(); const recursive = []
  for (const s of subs) {
    if (!isObj(s.node)) continue
    const k = key(s.path)
    if (typeof s.node.$anchor === 'string') anchors.set(s.node.$anchor, k)
    if (typeof s.node.$id === 'string') { ids.set(s.node.$id, k); if (s.node.$id.startsWith('#')) anchors.set(s.node.$id.slice(1), k) }
    if (typeof s.node.id === 'string' && s.node.id.startsWith('#')) anchors.set(s.node.id.slice(1), k)
    if (typeof s.node.$dynamicAnchor === 'string') { anchors.set(s.node.$dynamicAnchor, k); if (!dynAnchors.has(s.node.$dynamicAnchor)) dynAnchors.set(s.node.$dynamicAnchor, []); dynAnchors.get(s.node.$dynamicAnchor).push(k) }
    if (s.node.$recursiveAnchor === true) recursive.push(k)
  }
  const resolve = (r) => {
    const h = r.indexOf('#')
    const base = h < 0 ? r : r.slice(0, h)
    const frag = h < 0 ? '' : r.slice(h + 1)
    let at = ''
    if (base !== '') {
      let found = null
      for (const [id, k] of ids) if (id === base || id.replace(/#$/, '') === base || id.endsWith('/' + base)) { found = k; break }
      if (found === null) return null
      at = found
    }
    if (frag === '') return at
    if (frag[0] === '/') { const k = (at ? at + '/' : '') + frag.slice(1).split('/').map(unesc).map(esc).join('/'); return byPointer.has(k) ? k : null }
    return anchors.get(frag) ?? null
  }
  for (const s of subs) {
    if (!isObj(s.node)) continue
    if (typeof s.node.$ref === 'string') { const k = resolve(s.node.$ref); if (k !== null) ref.add(k) }
    if (typeof s.node.$dynamicRef === 'string') {
      const k = resolve(s.node.$dynamicRef); if (k !== null) dyn.add(k)
      const h = s.node.$dynamicRef.indexOf('#')
      const name = h < 0 ? '' : s.node.$dynamicRef.slice(h + 1)
      for (const a of dynAnchors.get(name) || []) dyn.add(a)
    }
    if (typeof s.node.$recursiveRef === 'string') { dyn.add(''); for (const a of recursive) dyn.add(a) }
  }
  return { ref, dyn }
}

const under = (set, k) => { for (const t of set) if (t === '' || k === t || k.startsWith(t + '/')) return true; return false }

function contexts (path, chain, ref, dyn) {
  const c = []
  const k = key(path)
  if (path.length === 0) c.push('top level')
  if (under(ref, k)) c.push('through $ref')
  if (under(dyn, k)) c.push('through $dynamicRef')
  if (path.includes('allOf')) c.push('in allOf')
  if (path.includes('anyOf')) c.push('in anyOf')
  if (path.includes('oneOf')) c.push('in oneOf')
  if (path.includes('not')) c.push('in not')
  if (path.includes('if') || path.includes('then') || path.includes('else')) c.push('in if/then/else')
  if (path.includes('unevaluatedProperties') || path.includes('unevaluatedItems')) c.push('under unevaluated*')
  if (chain.some((n) => isObj(n) && (n.unevaluatedProperties !== undefined || n.unevaluatedItems !== undefined))) c.push('beside unevaluated*')
  return c
}

// The changes for one keyword of one subschema: [what, (node) => void].
function changes (n, kw) {
  const v = n[kw]
  const out = []
  const set = (what, val) => out.push([what, (m) => { m[kw] = val }])
  const num = typeof v === 'number'
  switch (kw) {
    case 'type': {
      if (typeof v === 'string') set('type ' + (v === 'null' ? 'boolean' : 'null'), v === 'null' ? 'boolean' : 'null')
      if (typeof v === 'string' && (v === 'number' || v === 'integer')) set('type string', 'string')
      if (Array.isArray(v)) v.forEach((t, i) => { if (v.length > 1) set('type without ' + t, v.filter((_, j) => j !== i)) })
      if (Array.isArray(v) && v.length === 1) set('type ' + TYPES.find((t) => !v.includes(t)), [TYPES.find((t) => !v.includes(t))])
      break
    }
    case 'minimum': case 'exclusiveMinimum':
      if (num) { set(kw + ' + 1', v + 1); set(kw + ' 1e9', 1e9) } else if (v === false) set(kw + ' true', true)
      break
    case 'maximum': case 'exclusiveMaximum':
      if (num) { set(kw + ' - 1', v - 1); set(kw + ' -1e9', -1e9) } else if (v === false) set(kw + ' true', true)
      break
    case 'minLength': case 'minItems': case 'minProperties': case 'minContains':
      if (num) { set(kw + ' + 1', v + 1); set(kw + ' + 1000', v + 1000) }
      break
    case 'maxLength': case 'maxItems': case 'maxProperties': case 'maxContains':
      if (num && v > 0) { set(kw + ' - 1', v - 1); set(kw + ' 0', 0) }
      break
    case 'multipleOf':
      if (num) set('multipleOf 7.5', 7.5)
      break
    case 'enum':
      if (Array.isArray(v)) {
        if (v.length > 1) { set('enum without the first', v.slice(1)); set('enum without the last', v.slice(0, -1)) }
        set('enum [sentinel]', [SENTINEL])
      }
      break
    case 'const': set('const sentinel', SENTINEL); break
    case 'required':
      if (Array.isArray(v)) { set('required + sentinel', v.concat(SENTINEL)); if (v.length) set('required without the first', v.slice(1)) }
      break
    case 'pattern': if (typeof v === 'string') set('pattern ^sentinel$', '^' + SENTINEL + '$'); break
    case 'uniqueItems': if (v === false) set('uniqueItems true', true); break
    case 'format': if (typeof v === 'string') set('format ' + (v === 'ipv4' ? 'email' : 'ipv4'), v === 'ipv4' ? 'email' : 'ipv4'); break
    case 'dependentRequired': case 'dependencies':
      if (isObj(v)) for (const p of Object.keys(v)) if (Array.isArray(v[p])) { out.push([kw + ' ' + p + ' + sentinel', (m) => { m[kw] = { ...v, [p]: v[p].concat(SENTINEL) } }]); break }
      break
    case 'items': case 'additionalItems': case 'additionalProperties': case 'unevaluatedProperties': case 'unevaluatedItems':
    case 'contains': case 'propertyNames': case 'if': case 'then': case 'else':
      if (v !== false && !Array.isArray(v)) set(kw + ' false', false)
      break
    case 'not':
      if (v !== true && !(isObj(v) && Object.keys(v).length === 0)) set('not true', true)
      break
  }
  return out
}

// Keywords that assert something, and are removed one at a time.
const REMOVABLE = new Set(['type', 'minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties', 'minContains', 'maxContains', 'multipleOf', 'enum', 'const', 'required', 'pattern', 'uniqueItems', 'format', 'dependentRequired', 'dependentSchemas', 'dependencies', 'items', 'prefixItems', 'additionalItems', 'additionalProperties', 'unevaluatedProperties', 'unevaluatedItems', 'contains', 'propertyNames', 'patternProperties', 'properties', 'allOf', 'anyOf', 'oneOf', 'not', 'if', '$ref', '$dynamicRef', '$recursiveRef'])

// Follows a path of segments in a copy.
const at = (root, path) => { let n = root; for (const p of path) n = n[p]; return n }
function setAt (root, path, val) {
  if (path.length === 0) return val
  at(root, path.slice(0, -1))[path[path.length - 1]] = val
  return root
}

function mutants (schema) {
  const subs = subschemas(schema)
  const { ref, dyn } = targets(schema, subs)
  const out = []
  for (const { node, path } of subs) {
    const chain = []; { let n = schema; chain.push(n); for (const p of path) { n = n[p]; chain.push(n) } }
    const ctx = contexts(path, chain, ref, dyn)
    const pointer = '#' + (path.length ? '/' + key(path) : '')
    if (node === true || node === false) {
      out.push({ keyword: 'boolean schema', pointer, what: 'boolean schema ' + !node, contexts: ctx, schema: setAt(structuredClone(schema), path, !node) })
      continue
    }
    for (const kw of Object.keys(node)) {
      for (const [what, apply] of changes(node, kw)) {
        const copy = structuredClone(schema)
        apply(at(copy, path))
        out.push({ keyword: kw, pointer, what, contexts: ctx, schema: copy })
      }
      if (REMOVABLE.has(kw)) {
        const copy = structuredClone(schema)
        delete at(copy, path)[kw]
        out.push({ keyword: kw, pointer, what: 'without ' + kw, contexts: ctx, schema: copy })
      }
    }
  }
  return out
}

const CONTEXTS = ['top level', 'through $ref', 'through $dynamicRef', 'in allOf', 'in anyOf', 'in oneOf', 'in not', 'in if/then/else', 'under unevaluated*', 'beside unevaluated*']

// Runs the mutation check. For each group (a schema and its documents) that
// the oracle accepts at least one document of: every mutant, and every
// document whose oracle verdict the mutant flips is kept; the candidate must
// flip it the same way. The candidate is also held to the oracle on the
// unchanged schema, so a flip it gets right by accident is not counted.
//
//   groups     iterable of { label, schema, docs }
//   build      (schema) => { oracle, candidate } where oracle is (d) => boolean
//              and candidate is (d) => boolean, null where the candidate
//              declines the schema; or null where the schema is not taken
//              at all (refused, or outside what the oracle carries). A
//              candidate may return undefined for a document it declines.
function run (groups, build) {
  const st = { groups: 0, mutants: 0, notTaken: 0, declinedSchemas: 0, flips: 0, checked: 0, declinedDocs: 0, failures: [], keywords: {}, contexts: {} }
  for (const c of CONTEXTS) st.contexts[c] = { mutants: 0, flips: 0, checked: 0, failures: 0 }
  const tally = (o, k) => o[k] || (o[k] = { mutants: 0, flips: 0, checked: 0, failures: 0 })
  const call = (f, d) => { try { return f(d) } catch (e) { return 'threw: ' + (e && e.message) } }
  for (const g of groups) {
    let base
    try { base = build(g.schema) } catch { base = null }
    if (base === null) continue
    const want = g.docs.map((d) => call(base.oracle, d))
    if (!want.includes(true)) continue
    st.groups++
    if (base.candidate !== null) {
      g.docs.forEach((d, i) => {
        if (typeof want[i] !== 'boolean') return
        const got = call(base.candidate, d)
        if (got !== undefined && got !== want[i]) st.failures.push({ label: g.label, keyword: '(unchanged schema)', pointer: '#', what: 'none', contexts: [], doc: d, oracle: want[i], candidate: got })
      })
    }
    for (const m of mutants(g.schema)) {
      st.mutants++
      const kw = tally(st.keywords, m.keyword); kw.mutants++
      for (const c of m.contexts) st.contexts[c].mutants++
      let e
      try { e = build(m.schema) } catch { e = null }
      if (e === null) { st.notTaken++; continue }
      if (e.candidate === null) st.declinedSchemas++
      g.docs.forEach((d, i) => {
        if (typeof want[i] !== 'boolean') return
        const now = call(e.oracle, d)
        if (typeof now !== 'boolean' || now === want[i]) return
        st.flips++; kw.flips++
        for (const c of m.contexts) st.contexts[c].flips++
        if (e.candidate === null) { st.declinedDocs++; return }
        const got = call(e.candidate, d)
        if (got === undefined) { st.declinedDocs++; return }
        st.checked++; kw.checked++
        for (const c of m.contexts) st.contexts[c].checked++
        if (got !== now) {
          kw.failures++
          for (const c of m.contexts) st.contexts[c].failures++
          st.failures.push({ label: g.label, keyword: m.keyword, pointer: m.pointer, what: m.what, contexts: m.contexts, doc: d, oracle: now, candidate: got })
        }
      })
    }
  }
  return st
}

module.exports = { mutants, run, CONTEXTS }
