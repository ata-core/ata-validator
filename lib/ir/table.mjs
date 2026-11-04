// The table backend: a schema as data for the interpreter in
// lib/kernels/table.mjs, instead of code. A module written here is the plan
// and three lines; the interpreter is shared by every such module on a page,
// so a page with many forms pays for each form about what its schema weighs.
// The module writer (./emit.mjs) writes faster code; this one is for where
// bytes count more than nanoseconds, a browser bundle.
//
// The schema is read as the front end reads it (normalized, its references
// resolved), and every keyword is run in the order the front end runs it,
// so the errors are those of ./emit.mjs. What the interpreter does not cover
// returns null, and the caller keeps the module writer: annotations
// (unevaluated*), branches (anyOf, oneOf), patternProperties, propertyNames,
// contains, dependentSchemas, dynamic references, custom keywords and
// formats, registries, and any option but richErrors, assertFormat and
// useDefaults.
import { front, needsOrder, orderSkeleton } from './front.mjs'
import { buildIndex } from './refs.mjs'
import { LEAVES } from '../kernels/leaves.mjs'
import { FORMAT_HINTS } from './emit-deps.mjs'
import * as KERNELS from '../kernels/index.mjs'

const SKIP = new Set(['$id', '$anchor', '$dynamicAnchor', '$vocabulary', '$defs', 'definitions', 'minContains', 'maxContains', 'additionalItems', 'contentMediaType', 'contentEncoding', 'contentSchema', '$schema', 'then', 'else', 'default', 'title', 'description', 'examples', '$comment', 'readOnly', 'writeOnly', 'deprecated'])
const REFUSE = new Set(['anyOf', 'oneOf', 'patternProperties', 'propertyNames', 'contains', 'dependentSchemas', 'dependencies', 'unevaluatedProperties', 'unevaluatedItems', '$dynamicRef', '$recursiveRef', '$recursiveAnchor', 'errorMessage'])
const NAMES = { const: 'constK', enum: 'enumK' }
const OPTIONS = new Set(['richErrors', 'assertFormat', 'useDefaults'])
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
class Refused extends Error {}
const refuse = (why) => { throw new Refused(why) }

// The module source, or null where the interpreter does not cover the
// schema or an option.
export function tableModule (schema, opts = {}) {
  const b = build(schema, opts, false)
  return b === null ? null : b.module()
}

// The same plan as JSON, for a page that receives its schemas at run time:
// the server writes it, and ata-validator/plan's fromPlan reads it with the
// kernels it names. One writer for both, so the two cannot differ. Kernels
// are named in fixed places only (a step's handler, a leaf's descriptor,
// check and hint), never inside the schema's own values.
export const PLAN_VERSION = 1
export function tablePlan (schema, opts = {}) {
  const b = build(schema, opts, true)
  return b === null ? null : b.plan()
}

function build (schema, opts, json) {
  for (const k of Object.keys(opts)) if (opts[k] !== undefined && !OPTIONS.has(k)) return null
  const rich = opts.richErrors !== false
  const assertFormat = opts.assertFormat !== false
  let ir
  try { ir = front(schema, { assertFormat }) } catch { return null }
  if (ir.dynamic || ir.custom || ir.ctx) return null
  const sorts = needsOrder(ir.schema)
  const root = ir.schema
  const index = buildIndex(root, null, null)
  const uses = new Set([rich ? 'tableRich' : 'tablePlain'])
  const consts = []
  const hints = new Map()
  const nodes = []; const memo = new Map()
  const resolve = (ref, s) => { try { return index.resolve(ref, index.baseOf(s)) } catch { return refuse('unresolved $ref ' + ref) } }
  const lit = (v) => JSON.stringify(v)
  // A kernel as the module names it, or as the plan does, by its name.
  const id = (name) => json ? lit(name) : name
  // A step: its handler (an export of lib/kernels/table.mjs) and arguments.
  const step = (h, ...a) => { uses.add(h); return `[${[id(h), ...a].join(',')}]` }

  function node (s) {
    if (memo.has(s)) return memo.get(s)
    const i = nodes.length
    memo.set(s, i); nodes.push(null)
    nodes[i] = steps(s)
    return i
  }
  // A subschema with no subschema of its own is written in place, as valibot
  // writes a field: no index, no separate entry. Anything else, which may be
  // shared or reached again, by index.
  const CHILDREN = ['properties', 'additionalProperties', 'items', 'prefixItems', 'allOf', '$ref', 'not', 'if', 'then', 'else']
  const leafish = (s) => typeof s === 'boolean' || (isObj(s) && !CHILDREN.some((k) => k in s && typeof s[k] === 'object' && s[k] !== null))
  const ref = (s) => leafish(s) ? steps(s) : node(s)
  // A name an object literal keeps in its place and as an own key: not an
  // array index (those come first) and not __proto__ (which sets the prototype).
  const safeName = (k) => k !== '__proto__' && !/^(0|[1-9][0-9]*)$/.test(k)
  function steps (s) {
    if (s === true) return '[]'
    if (s === false) { uses.add('tFalse'); return `[[${id('tFalse')}]]` }
    if (!isObj(s)) refuse('not a schema')
    const out = []
    let propsAt = -1; const apAt = []; const reqAt = []; let propNames = []
    for (const k of Object.keys(s)) {
      const n = s[k]
      if (SKIP.has(k)) continue
      if (REFUSE.has(k)) refuse(k)
      if (k === 'type') out.push(step('tType', lit(n)))
      else if (k === 'properties') {
        if (!isObj(n)) refuse('properties')
        if (!Object.keys(n).every(safeName)) refuse('a property name an object literal reorders')
        propsAt = out.length; propNames = Object.keys(n)
        out.push(step('tProps', `{${propNames.map((p) => `${lit(p)}:${ref(n[p])}`).join(',')}}`))
      } else if (k === 'required') { if (Array.isArray(n) && n.length) { reqAt.push(out.length); out.push(n) } }
      else if (k === 'dependentRequired') {
        if (!isObj(n)) refuse(k)
        out.push(step('tDepReq', `[${Object.keys(n).map((a) => `${lit(a)},${lit(n[a])}`).join(',')}]`))
      } else if (k === 'additionalProperties') {
        // The names it knows are those of the node's properties step, which
        // may come later in the schema: filled in below.
        if (n === false) { apAt.push(out.length); uses.add('tClosed'); out.push(`[${id('tClosed')},`) }
        else if (n !== true) { apAt.push(out.length); uses.add('tAddl'); out.push(`[${id('tAddl')},${ref(n)},`) }
      } else if (k === 'items') { if (n !== true) out.push(step('tItems', ref(n), Array.isArray(s.prefixItems) ? s.prefixItems.length : 0)) }
      else if (k === 'prefixItems') out.push(step('tTuple', `[${n.map(ref).join(',')}]`))
      else if (k === 'allOf') out.push(step('tAll', `[${n.map(ref).join(',')}]`))
      else if (k === '$ref') out.push(step('tRef', ref(resolve(n, s))))
      else if (k === 'not') out.push(step('tNot', ref(n)))
      else if (k === 'if') out.push(step('tIf', ref(n), 'then' in s ? ref(s.then) : -1, 'else' in s ? ref(s.else) : -1))
      else if (k === 'format' && !assertFormat) continue
      else if (LEAVES[k]) {
        const K = LEAVES[k]
        if (k === 'format') {
          if (typeof n !== 'string' || K.prepare(n) === null) continue
          // A format with a smaller check of the same answers (lib/kernels/formats-small.mjs)
          // takes it: a plan is for a bundle where bytes count.
          const base = 'fmt_' + n.replace(/-/g, '_')
          const fn = base + '_s' in KERNELS ? base + '_s' : base
          if (!(fn in KERNELS)) refuse('format ' + n)
          const D = rich ? 'formatK' : 'formatP'
          uses.add(fn); uses.add(D)
          let hint = json ? 'null' : 'void 0'
          // A plan names the format whose hint it takes (ata-validator/plan makes it).
          if (rich && FORMAT_HINTS[n] && json) hint = lit(n)
          else if (rich && FORMAT_HINTS[n]) {
            if (!hints.has(n)) { const h = 'H' + consts.length; consts.push(`const ${h}=(v)=>{const t=(${FORMAT_HINTS[n].toString()})(v);return t?{text:t,kind:"format"}:null}`); hints.set(n, h) }
            hint = hints.get(n)
          }
          out.push(step('tLeaf', id(D), lit(n), id(fn), lit(K.code(n)), hint))
          continue
        }
        const name = NAMES[k] || k
        if (!(name in KERNELS) || KERNELS[name] !== K || K.kw !== k) refuse('leaf ' + k)
        // The plain view where the rich descriptor carries a hint.
        // The plain view of the descriptor (its kw, check and message, the same
        // functions) where there is one; uniqueItems has none.
        const view = k === 'enum' ? 'enumP' : k === 'const' ? 'constP' : name + 'P'
        const D = !rich && view in KERNELS ? view : name
        if (D !== name && (KERNELS[D].params !== K.params || KERNELS[D].msg !== K.msg || KERNELS[D].ok !== K.ok)) refuse('plain view ' + k)
        uses.add(D)
        out.push(step('tLeaf', id(D), lit(n)))
      } else refuse('keyword ' + k)
    }
    for (const j of apAt) out[j] += propsAt + ']'
    // A required name the properties step lists is written as its position there.
    // Required names that are the properties step's own, in its order, as a
    // mask of their positions; otherwise the names.
    for (const j of reqAt) {
      const pos = out[j].map((r) => typeof r === 'string' ? propNames.indexOf(r) : -1)
      const inOrder = propsAt !== -1 && propNames.length <= 31 && pos.every((i, x) => i !== -1 && (x === 0 || i > pos[x - 1]))
      out[j] = inOrder ? step('tReq', pos.reduce((m, i) => m | (1 << i), 0), propsAt) : step('tReq', lit(out[j]))
    }
    return `[${out.join(',')}]`
  }

  // Defaults, by the front end's fill rules (./front.mjs fillProc).
  const fills = []; const fillMemo = new Map(); const fillStack = new Set(); const reach = new Map()
  const reachesDefault = (n) => {
    if (!isObj(n)) return false
    if (reach.has(n)) return reach.get(n)
    reach.set(n, false)
    const props = isObj(n.properties) ? Object.values(n.properties) : []
    let yes = props.some((p) => isObj(p) && p.default !== undefined)
    const below = [...props, typeof n.$ref === 'string' ? resolve(n.$ref, n) : null, ...(Array.isArray(n.allOf) ? n.allOf : []), ...(Array.isArray(n.prefixItems) ? n.prefixItems : []), n.items, n.additionalProperties, ...(isObj(n.patternProperties) ? Object.values(n.patternProperties) : []), ...(isObj(n.dependentSchemas) ? Object.values(n.dependentSchemas) : [])]
    for (const b of below) if (!yes && reachesDefault(b)) yes = true
    reach.set(n, yes)
    return yes
  }
  function fill (n) {
    if (!isObj(n) || !reachesDefault(n)) return -1
    if (fillMemo.has(n)) return fillMemo.get(n)
    if (fillStack.has(n)) refuse('a cycle of defaults')
    if (reachesDefault(n.additionalProperties)) refuse('defaults under additionalProperties')
    fillStack.add(n)
    const i = fills.length; fills.push(null); fillMemo.set(n, i)
    const props = isObj(n.properties) ? n.properties : {}
    const defs = []
    for (const k of Object.keys(props)) if (isObj(props[k]) && props[k].default !== undefined) defs.push(lit(k), lit(props[k].default))
    const inner = []
    for (const k of Object.keys(props)) { const c = fill(props[k]); if (c !== -1) inner.push(lit(k), c) }
    const tuple = Array.isArray(n.prefixItems) ? n.prefixItems.map(fill) : []
    const each = fill(n.items)
    const deps = []
    if (isObj(n.dependentSchemas)) for (const k of Object.keys(n.dependentSchemas)) { const c = fill(n.dependentSchemas[k]); if (c !== -1) deps.push(lit(k), c) }
    const here = []
    if (typeof n.$ref === 'string') { const c = fill(resolve(n.$ref, n)); if (c !== -1) here.push(c) }
    if (Array.isArray(n.allOf)) for (const sub of n.allOf) { const c = fill(sub); if (c !== -1) here.push(c) }
    fillStack.delete(n)
    fills[i] = `[[${defs.join(',')}],[${inner.join(',')}],[${tuple.join(',')}],${each},[${deps.join(',')}],[${here.join(',')}]]`
    return i
  }

  try {
    node(root)
    if (opts.useDefaults !== false && fill(root) > 0) refuse('fill root')
  } catch (e) {
    if (e instanceof Refused) return null
    throw e
  }
  if (fills.length) uses.add('tableFill')
  if (sorts) uses.add('ordered')
  const P = `[${nodes.join(',')}]`; const F = `[${fills.join(',')}]`
  if (json) return { plan: () => ({ v: PLAN_VERSION, rich, P: JSON.parse(P), F: JSON.parse(F), rel: rich && ir.relate, sk: sorts ? orderSkeleton(ir.schema) : null, uses: [...uses].sort() }) }
  // Trailing arguments left out where they are empty.
  const a = ['P', fills.length ? F : '[]', fills.length ? 'tableFill' : 'null']
  if (rich) a.push(ir.relate ? '1' : '0')
  if (sorts) a.push('(e)=>ordered(SK,e)')
  while (a.length > 1 && (a[a.length - 1] === 'null' || a[a.length - 1] === '[]' || a[a.length - 1] === '0')) a.pop()
  const make = `${rich ? 'tableRich' : 'tablePlain'}(${a.join(',')})`
  const sk = sorts ? `const SK=JSON.parse(${JSON.stringify(JSON.stringify(orderSkeleton(ir.schema)))})\n` : ''
  return { module: () => `import {${[...uses].sort().join(',')}} from "ata-validator/kernels"
${consts.join('\n')}${consts.length ? '\n' : ''}${sk}const P=${P}
export const{isValid,validate}=${make}
` }
}
