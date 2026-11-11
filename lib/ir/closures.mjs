// The closure backend: a schema as calls that build one closure per node
// (lib/kernels/closures.mjs), for a browser bundle. A page pays for the
// kernels once and for each form a line of calls, and a check is a few
// branches rather than a walk over a plan.
//
// It covers what forms are made of: objects (properties, required,
// additionalProperties false), arrays (items, minItems, maxItems,
// uniqueItems) and values (type, enum and const of primitives, the string
// and number keywords, formats), plain errors only. Anything else, and any
// option but richErrors: false, assertFormat and useDefaults: false, returns
// null, and the caller writes the plan or the module instead. Nothing is
// guessed: tests/test_ir_closures.mjs holds every module it writes to the
// module writer's answers.
//
// The schema is read as the front end reads it. Each node's keywords run in
// the order the schema declares them, which is the order errors are
// reported in; where a loop repeats a body that is not a single leaf the
// module sorts, as the other backends do.
import { front, orderSkeleton, MEANINGFUL } from './front.mjs'
import { hasDefault } from './emit.mjs'
import { LEAVES } from '../kernels/leaves.mjs'
import * as KERNELS from '../kernels/index.mjs'

const SKIP = new Set(['$id', '$anchor', '$vocabulary', '$defs', 'definitions', 'contentMediaType', 'contentEncoding', 'contentSchema', '$schema', 'default', 'title', 'description', 'examples', '$comment', 'readOnly', 'writeOnly', 'deprecated'])
const LEAF = { minLength: 1, maxLength: 2, pattern: 3, format: 4, minimum: 5, maximum: 6, exclusiveMinimum: 7, exclusiveMaximum: 8, multipleOf: 9, enum: 10, const: 11 }
const BIT = { string: 1, number: 2, integer: 4, boolean: 8, null: 16, object: 32, array: 64 }
const OBJECT = new Set(['properties', 'required', 'additionalProperties'])
const ARRAY = new Set(['items', 'minItems', 'maxItems', 'uniqueItems'])
const TYPES = new Set(['string', 'number', 'integer', 'boolean', 'null', 'object', 'array'])
const OPTIONS = new Set(['richErrors', 'assertFormat', 'useDefaults'])
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v)
const prim = (v) => v === null || typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))
const count = (n) => Number.isInteger(n) && n >= 0
class Refused extends Error {}
const refuse = (why) => { throw new Refused(why) }
const lit = (v) => JSON.stringify(v)

// The module source, or null where this backend does not cover the schema
// or an option.
export function closureModule (schema, opts = {}) {
  for (const k of Object.keys(opts)) if (opts[k] !== undefined && !OPTIONS.has(k)) return null
  if (opts.richErrors !== false) return null
  if (opts.useDefaults !== false && hasDefault(schema)) return null
  const assertFormat = opts.assertFormat !== false
  let ir
  try { ir = front(schema, { assertFormat }) } catch { return null }
  if (ir.dynamic || ir.custom || ir.ctx) return null
  const uses = new Set(['cRun'])
  let sorts = false
  const call = (name, ...a) => { uses.add(name); return `${name}(${a.join(',')})` }
  // A type as the kernels take it: one type's bit, or the list of names.
  const typeOf = (n) => typeof n === 'string' && TYPES.has(n) ? String(BIT[n]) : Array.isArray(n) && n.length > 0 && n.every((t) => typeof t === 'string' && TYPES.has(t)) ? lit(n) : refuse('type')
  const leaves = new Set()

  // The keywords of a node that mean something, in the schema's order.
  function keys (s) {
    const out = []
    for (const k of Object.keys(s)) {
      if (SKIP.has(k) || !MEANINGFUL.has(k)) continue
      if (k === 'format' && !assertFormat) continue
      out.push(k)
    }
    return out
  }

  function leaf (s, ks) {
    const c = []
    for (const k of ks) {
      const n = s[k]
      if (k === 'type') c.push(0, typeOf(n))
      else if (k === 'format') {
        // A format the engine does not know asserts nothing.
        if (typeof n !== 'string' || LEAVES.format.prepare(n) === null) continue
        const base = 'fmt_' + n.replace(/-/g, '_')
        // The small check with the scanner's answers, where there is one
        // (lib/kernels/formats-small.mjs).
        const fn = base + '_s' in KERNELS ? base + '_s' : base
        if (!(fn in KERNELS)) refuse('format ' + n)
        uses.add(fn)
        c.push(4, `[${fn},${lit(n)}]`)
      } else if (k === 'pattern') {
        if (typeof n !== 'string') refuse(k)
        try { new RegExp(n, 'u') } catch { refuse('pattern ' + n) }
        c.push(3, lit(n))
      } else if (k === 'enum') { if (!Array.isArray(n) || !n.every(prim)) refuse(k); c.push(10, lit(n)) }
      else if (k === 'const') { if (!prim(n)) refuse(k); c.push(11, lit(n)) }
      else if (k === 'minLength' || k === 'maxLength') { if (!count(n)) refuse(k); c.push(LEAF[k], n) }
      else if (LEAF[k] !== undefined) { if (typeof n !== 'number' || !Number.isFinite(n)) refuse(k); c.push(LEAF[k], lit(n)) }
      else refuse('keyword ' + k)
    }
    return c
  }

  function node (s) {
    if (s === true) { uses.add('cTrue'); return 'cTrue' }
    if (!isObj(s)) refuse('not a schema this backend writes')
    const ks = keys(s)
    if (ks.length === 0) { uses.add('cTrue'); return 'cTrue' }
    if (new Set(ks).size !== ks.length) refuse('a keyword twice')
    if (ks.some((k) => OBJECT.has(k))) {
      let order = ''; let props = '[]'; let names = []; let req
      for (const k of ks) {
        const n = s[k]
        if (k === 'type') order += 't'
        else if (k === 'properties') {
          if (!isObj(n)) refuse(k)
          names = Object.keys(n)
          props = `[${names.map((p) => `${lit(p)},${node(n[p])}`).join(',')}]`
          order += 'p'
        } else if (k === 'required') {
          if (!Array.isArray(n) || !n.every((r) => typeof r === 'string')) refuse(k)
          if (n.length) { req = n; order += 'r' }
        } else if (k === 'additionalProperties') { if (n === false) order += 'c'; else if (n !== true) refuse('additionalProperties as a schema') }
        else refuse('keyword ' + k + ' on an object node')
      }
      // Required names that are the properties' own, in their order, as a
      // mask of their positions; otherwise the names.
      let r = 'void 0'
      if (req !== undefined) {
        const pos = req.map((x) => names.indexOf(x))
        r = names.length <= 31 && pos.every((i, x) => i !== -1 && (x === 0 || i > pos[x - 1])) ? String(pos.reduce((m, i) => m | (1 << i), 0)) : lit(req)
      }
      const a = [lit(order), props, r]
      if ('type' in s && typeOf(s.type) !== '32') a.push(typeOf(s.type))
      while (a[a.length - 1] === 'void 0') a.pop()
      return call('cObj', ...a)
    }
    if (ks.some((k) => ARRAY.has(k))) {
      const c = []
      for (const k of ks) {
        const n = s[k]
        if (k === 'type') c.push(0, typeOf(n))
        else if (k === 'minItems' || k === 'maxItems') { if (!count(n)) refuse(k); c.push(k === 'minItems' ? 12 : 13, n) }
        else if (k === 'uniqueItems') { if (n === true) { uses.add('dupPair'); c.push(14, 'dupPair') } else if (n !== false) refuse(k) }
        else if (k === 'items') {
          if (n === true) continue
          const body = node(n)
          // A body of value checks alone reports in schema order by itself
          // (cVal, code 15); any other is sorted.
          if (!leaves.has(body)) sorts = true
          c.push(15, body)
        } else refuse('keyword ' + k + ' on an array node')
      }
      return call('cVal', `[${c.join(',')}]`)
    }
    const src = call('cVal', `[${leaf(s, ks).join(',')}]`)
    leaves.add(src)
    return src
  }

  let root
  try { root = node(ir.schema) } catch (e) { if (e instanceof Refused) return null; throw e }
  let sk = ''
  let run = `cRun(${root})`
  if (sorts) { uses.add('ordered'); sk = `const SK=JSON.parse(${JSON.stringify(JSON.stringify(orderSkeleton(ir.schema)))})\n`; run = `cRun(${root},(e)=>ordered(SK,e))` }
  return `import {${[...uses].sort().join(',')}} from "ata-validator/kernels"
${sk}export const{isValid,validate}=${run}
`
}
