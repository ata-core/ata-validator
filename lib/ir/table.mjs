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
  // A step: its handler (an export of lib/kernels/table.mjs) and arguments.
  const step = (h, ...a) => { uses.add(h); return `[${[h, ...a].join(',')}]` }

  function node (s) {
    if (memo.has(s)) return memo.get(s)
    const i = nodes.length
    memo.set(s, i); nodes.push(null)
    nodes[i] = steps(s)
    return i
  }
  function steps (s) {
    if (s === true) return '[]'
    if (s === false) { uses.add('tFalse'); return '[[tFalse]]' }
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
        const l = []
        for (const p of Object.keys(n)) l.push(lit(p), n[p] === true ? -1 : node(n[p]))
        propsAt = out.length; propNames = Object.keys(n)
        out.push(step('tProps', `[${l.join(',')}]`))
      } else if (k === 'required') { if (Array.isArray(n) && n.length) { reqAt.push(out.length); out.push(n) } }
      else if (k === 'dependentRequired') {
        if (!isObj(n)) refuse(k)
        out.push(step('tDepReq', `[${Object.keys(n).map((a) => `${lit(a)},${lit(n[a])}`).join(',')}]`))
      } else if (k === 'additionalProperties') {
        // The names it knows are those of the node's properties step, which
        // may come later in the schema: filled in below.
        if (n === false) { apAt.push(out.length); uses.add('tClosed'); out.push('[tClosed,') }
        else if (n !== true) { apAt.push(out.length); uses.add('tAddl'); out.push(`[tAddl,${node(n)},`) }
      } else if (k === 'items') { if (n !== true) out.push(step('tItems', node(n), Array.isArray(s.prefixItems) ? s.prefixItems.length : 0)) }
      else if (k === 'prefixItems') out.push(step('tTuple', `[${n.map(node).join(',')}]`))
      else if (k === 'allOf') out.push(step('tAll', `[${n.map(node).join(',')}]`))
      else if (k === '$ref') out.push(step('tRef', node(resolve(n, s))))
      else if (k === 'not') out.push(step('tNot', node(n)))
      else if (k === 'if') out.push(step('tIf', node(n), 'then' in s ? node(s.then) : -1, 'else' in s ? node(s.else) : -1))
      else if (k === 'format' && !assertFormat) continue
      else if (LEAVES[k]) {
        const K = LEAVES[k]
        if (k === 'format') {
          if (typeof n !== 'string' || K.prepare(n) === null) continue
          const fn = 'fmt_' + n.replace(/-/g, '_')
          if (!(fn in KERNELS)) refuse('format ' + n)
          const D = rich ? 'formatK' : 'formatP'
          uses.add(fn); uses.add(D)
          let hint = 'void 0'
          if (rich && FORMAT_HINTS[n]) {
            if (!hints.has(n)) { const h = 'H' + consts.length; consts.push(`const ${h}=(v)=>{const t=(${FORMAT_HINTS[n].toString()})(v);return t?{text:t,kind:"format"}:null}`); hints.set(n, h) }
            hint = hints.get(n)
          }
          out.push(step('tLeaf', D, lit(n), fn, lit(K.code(n)), hint))
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
        out.push(step('tLeaf', D, lit(n)))
      } else refuse('keyword ' + k)
    }
    for (const j of apAt) out[j] += propsAt + ']'
    // A required name the properties step lists is written as its position there.
    for (const j of reqAt) out[j] = step('tReq', `[${out[j].map((r) => { const i = propNames.indexOf(r); return i !== -1 && propsAt !== -1 && typeof r === 'string' ? i : lit(r) }).join(',')}]`, propsAt)
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
  // Trailing arguments left out where they are empty.
  const a = ['P', fills.length ? `[${fills.join(',')}]` : '[]', fills.length ? 'tableFill' : 'null']
  if (rich) a.push(ir.relate ? '1' : '0')
  if (sorts) a.push('(e)=>ordered(SK,e)')
  while (a.length > 1 && (a[a.length - 1] === 'null' || a[a.length - 1] === '[]' || a[a.length - 1] === '0')) a.pop()
  const make = `${rich ? 'tableRich' : 'tablePlain'}(${a.join(',')})`
  const sk = sorts ? `const SK=JSON.parse(${JSON.stringify(JSON.stringify(orderSkeleton(ir.schema)))})\n` : ''
  return `import {${[...uses].sort().join(',')}} from "ata-validator/kernels"
${consts.join('\n')}${consts.length ? '\n' : ''}${sk}const P=[${nodes.join(',')}]
export const{isValid,validate}=${make}
`
}
