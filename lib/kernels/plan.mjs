// ata-validator/plan: validators for schemas that arrive at run time, as
// plans a server writes with tablePlan (ata-validator/ir) instead of schemas.
// The heavy work (references, dialects, normalization) is done where the plan
// is written; the page carries the table interpreter and, loaded when a plan
// names them, the format checks, the error order and the rich error shape.
// The verdicts, errors and filled defaults are those of the server's
// validator for the same schema. This entry reads plans with plain errors
// (richErrors: false); ata-validator/plan-rich reads both, and only a page
// that imports it carries the rich error shape.
//
//   const v = await fromPlan(await (await fetch('/plans/signup.json')).json())
//   v.validate(data)
//
// A plan names kernels in fixed places only (each step's handler, a leaf's
// descriptor, check and hint); every other value is the schema's own data
// and is used as data.
import { tablePlain, tableFill, tType, tProps, tReq, tClosed, tAddl, tPats, tPropNames, tLeaf, tItems, tTuple, tAll, tAny, tOne, tRef, tNot, tIf, tDepReq, tFalse } from './table.mjs'
import { typeP, requiredP, additionalP, enumP, constP, formatP, uniqueItems, minLengthP, maxLengthP, minimumP, maximumP, exclusiveMinimumP, exclusiveMaximumP, multipleOfP, patternP, minItemsP, maxItemsP, minPropertiesP, maxPropertiesP } from './kernels.mjs'

import ATA_VERSION from '../version.js'

const CORE = { tablePlain, tableFill, tType, tProps, tReq, tClosed, tAddl, tPats, tPropNames, tLeaf, tItems, tTuple, tAll, tAny, tOne, tRef, tNot, tIf, tDepReq, tFalse, typeP, requiredP, additionalP, enumP, constP, formatP, uniqueItems, minLengthP, maxLengthP, minimumP, maximumP, exclusiveMinimumP, exclusiveMaximumP, multipleOfP, patternP, minItemsP, maxItemsP, minPropertiesP, maxPropertiesP }
export const PLAN_VERSION = 1

const warned = new Set()
const fail = (why) => { throw new Error('ata-validator/plan: ' + why) }
// Names an object literal would reorder or treat specially; a plan never
// carries them (lib/ir/table.mjs refuses such schemas).
const safeName = (k) => k !== '__proto__' && !/^(0|[1-9][0-9]*)$/.test(k)

const HANDLERS = new Set(['tType', 'tProps', 'tReq', 'tClosed', 'tAddl', 'tPats', 'tPropNames', 'tLeaf', 'tItems', 'tTuple', 'tAll', 'tAny', 'tOne', 'tRef', 'tNot', 'tIf', 'tDepReq', 'tFalse'])
const isInt = (n) => Number.isInteger(n) && n >= 0
const isStrings = (a) => Array.isArray(a) && a.every((x) => typeof x === 'string')

// Every step checked as it is read, so a plan that is not one the writer
// makes is refused here, by what is wrong with it, and never runs.
function decode (P, K, hints) {
  if (!Array.isArray(P) || P.length === 0) fail('a plan has at least its root node')
  const kernel = (n) => typeof n === 'string' && K[n] !== undefined ? K[n] : fail(`unknown kernel ${JSON.stringify(n)}`)
  const descriptor = (n) => { const D = kernel(n); return D !== null && typeof D === 'object' && typeof D.kw === 'string' && (typeof D.ok === 'function' || typeof D.fail === 'function') ? D : fail(`${JSON.stringify(n)} is not a keyword descriptor`) }
  const ref = (r) => typeof r === 'number' ? (isInt(r) && r < P.length ? r : fail('a node index out of range')) : node(r)
  // A list of patterns, each one a u-flag RegExp compiles, or none.
  const patterns = (l) => { if (l === undefined) return; if (!isStrings(l)) fail('a pattern list is not one'); for (const q of l) { try { new RegExp(q, 'u') } catch { fail(`a pattern ${JSON.stringify(q)} a plan cannot carry`) } } }
  // The node's properties step, for tReq, tClosed and tAddl to name.
  const propsStep = (N, j) => j === -1 || (isInt(j) && j < N.length && Array.isArray(N[j]) && N[j][0] === 'tProps') ? j : fail('a step names a properties step that is not one')
  function node (N) {
    if (!Array.isArray(N)) fail('a node is not a list of steps')
    return N.map((t) => step(t, N))
  }
  function step (t, N) {
    if (!Array.isArray(t) || !HANDLERS.has(t[0])) fail(`a step whose handler is ${JSON.stringify(Array.isArray(t) ? t[0] : t)}`)
    const out = t.slice(); out[0] = kernel(t[0])
    switch (t[0]) {
      // A list may hold what draft 3 allowed there; the check only reads it.
      case 'tType': if (!(typeof t[1] === 'string' || Array.isArray(t[1]))) fail('tType takes a type or a list'); break
      case 'tProps': {
        if (t[1] === null || typeof t[1] !== 'object' || Array.isArray(t[1])) fail('tProps takes an object')
        const o = {}
        for (const k of Object.keys(t[1])) { if (!safeName(k)) fail(`a property name ${JSON.stringify(k)} a plan cannot carry`); o[k] = ref(t[1][k]) }
        out[1] = o; break
      }
      case 'tReq':
        if (isStrings(t[1])) break
        if (!(isInt(t[1]) && t[1] < 2 ** 31)) fail('tReq takes names or a mask')
        if (propsStep(N, t[2]) === -1) fail('a required mask with no properties step'); break
      case 'tClosed': propsStep(N, t[1]); patterns(t[2]); break
      case 'tAddl': out[1] = ref(t[1]); propsStep(N, t[2]); patterns(t[3]); break
      case 'tPats':
        if (!Array.isArray(t[1]) || !t[1].every((q) => Array.isArray(q) && q.length === 2)) fail('tPats takes patterns and nodes')
        patterns(t[1].map((q) => q[0])); out[1] = t[1].map((q) => [q[0], ref(q[1])]); break
      case 'tPropNames': out[1] = ref(t[1]); break
      case 'tItems': out[1] = ref(t[1]); if (!isInt(t[2])) fail('tItems takes a first index'); break
      case 'tRef': case 'tNot': out[1] = ref(t[1]); break
      case 'tTuple': case 'tAll': if (!Array.isArray(t[1])) fail(t[0] + ' takes a list of nodes'); out[1] = t[1].map(ref); break
      // The titles are read as data, one per branch, into a message.
      case 'tAny': case 'tOne':
        if (!Array.isArray(t[1]) || t[1].length === 0 || !Array.isArray(t[2]) || t[2].length !== t[1].length) fail(t[0] + ' takes branches and their titles')
        out[1] = t[1].map(ref); break
      case 'tIf': out[1] = ref(t[1]); out[2] = t[2] === -1 ? -1 : ref(t[2]); out[3] = t[3] === -1 ? -1 : ref(t[3]); break
      case 'tDepReq':
        if (!Array.isArray(t[1]) || t[1].length % 2 !== 0) fail('tDepReq takes names and lists of names')
        for (let j = 0; j < t[1].length; j += 2) if (typeof t[1][j] !== 'string' || !isStrings(t[1][j + 1])) fail('tDepReq takes names and lists of names')
        break
      case 'tFalse': break
      case 'tLeaf':
        out[1] = descriptor(t[1])
        if (t.length === 6) {
          if (out[1].kw !== 'format' || typeof t[3] !== 'string' || !/^fmt_\w+$/.test(t[3]) || typeof t[4] !== 'string') fail('a format step is not one')
          out[3] = kernel(t[3]); out[5] = t[5] == null ? undefined : hints(t[5])
        } else if (t.length !== 3) fail('a leaf step has a descriptor and its argument')
        break
    }
    return out
  }
  return P.map(node)
}

// The defaults table: [defaults [k, v, ...], properties [k, f, ...],
// prefixItems [f or -1, ...], items f or -1, dependentSchemas [k, f, ...],
// in place [f, ...]], every f an index into it.
function checkFill (F) {
  if (!Array.isArray(F)) fail('the defaults table is not a list')
  const f = (i) => i === -1 || (isInt(i) && i < F.length) || fail('a defaults index out of range')
  const pairs = (a, idx) => { if (!Array.isArray(a) || a.length % 2 !== 0) fail('a defaults entry is not pairs'); for (let j = 0; j < a.length; j += 2) { if (typeof a[j] !== 'string') fail('a defaults name is not a string'); if (idx) f(a[j + 1]) } }
  for (const e of F) {
    if (!Array.isArray(e) || e.length !== 6) fail('a defaults entry has six parts')
    pairs(e[0], false); pairs(e[1], true)
    if (!Array.isArray(e[2])) fail('a defaults entry is not well formed'); e[2].forEach(f)
    f(e[3]); pairs(e[4], true)
    if (!Array.isArray(e[5])) fail('a defaults entry is not well formed'); e[5].forEach(f)
  }
  return F
}

// The validator for a plan, once the kernels it names are loaded. `rich`:
// what ata-validator/plan-rich passes in.
export async function fromPlan (plan, rich = null) {
  if (plan === null || typeof plan !== 'object' || plan.v !== PLAN_VERSION) fail(`a plan of version ${PLAN_VERSION} is expected`)
  const uses = Array.isArray(plan.uses) ? plan.uses : fail('the plan does not list its kernels')
  // The page and the server decide alike when both run the same ata-validator.
  if (typeof plan.ata === 'string' && plan.ata !== ATA_VERSION && !warned.has(plan.ata)) {
    warned.add(plan.ata)
    console.warn(`ata-validator/plan: this plan was written by ata-validator ${plan.ata} and is read by ${ATA_VERSION}; a page and a server agree on every document only on the same version.`)
  }
  const K = Object.assign(Object.create(null), CORE)
  const loads = []
  if (plan.rich) { if (rich === null) fail('this plan has rich errors: read it with ata-validator/plan-rich'); Object.assign(K, rich.RICH) }
  if (uses.some((n) => /^fmt_\w+_s$/.test(n))) loads.push(import('./formats-small.mjs').then((m) => Object.assign(K, m)))
  if (uses.some((n) => /^fmt_\w+$/.test(n) && !/_s$/.test(n))) loads.push(import('./formats.mjs').then((m) => Object.assign(K, m)))
  let order
  if (plan.sk) loads.push(import('./order.mjs').then((m) => { order = (e) => m.ordered(plan.sk, e) }))
  await Promise.all(loads)
  for (const n of uses) if (n !== 'ordered' && K[n] === undefined) fail(`this plan needs "${n}", which this version of ata-validator does not have`)
  const P = decode(plan.P, K, (name) => rich ? rich.hint(name) : undefined)
  const F = checkFill(plan.F === undefined ? [] : plan.F)
  const fill = F.length ? tableFill : null
  return plan.rich ? rich.tableRich(P, F, fill, plan.rel, order) : tablePlain(P, F, fill, order)
}
