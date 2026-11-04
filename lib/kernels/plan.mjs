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
import { tablePlain, tableFill, tType, tProps, tReq, tClosed, tAddl, tLeaf, tItems, tTuple, tAll, tRef, tNot, tIf, tDepReq, tFalse } from './table.mjs'
import { typeP, requiredP, additionalP, enumP, constP, formatP, uniqueItems, minLengthP, maxLengthP, minimumP, maximumP, exclusiveMinimumP, exclusiveMaximumP, multipleOfP, patternP, minItemsP, maxItemsP, minPropertiesP, maxPropertiesP } from './kernels.mjs'

const CORE = { tablePlain, tableFill, tType, tProps, tReq, tClosed, tAddl, tLeaf, tItems, tTuple, tAll, tRef, tNot, tIf, tDepReq, tFalse, typeP, requiredP, additionalP, enumP, constP, formatP, uniqueItems, minLengthP, maxLengthP, minimumP, maximumP, exclusiveMinimumP, exclusiveMaximumP, multipleOfP, patternP, minItemsP, maxItemsP, minPropertiesP, maxPropertiesP }
export const PLAN_VERSION = 1

const fail = (why) => { throw new Error('ata-validator/plan: ' + why) }
// Names an object literal would reorder or treat specially; a plan never
// carries them (lib/ir/table.mjs refuses such schemas).
const safeName = (k) => k !== '__proto__' && !/^(0|[1-9][0-9]*)$/.test(k)

function decode (P, K, hints) {
  const kernel = (n) => typeof n === 'string' && K[n] !== undefined ? K[n] : fail(`unknown kernel ${JSON.stringify(n)}`)
  const ref = (r) => typeof r === 'number' ? (r >= 0 && r < P.length ? r : fail('a node index out of range')) : node(r)
  const node = (N) => Array.isArray(N) ? N.map(step) : fail('a node is not a list of steps')
  function step (t) {
    if (!Array.isArray(t) || t.length === 0) fail('a step is not a list')
    const out = t.slice(); out[0] = kernel(t[0])
    switch (t[0]) {
      case 'tProps': {
        const o = {}
        for (const k of Object.keys(t[1])) { if (!safeName(k)) fail(`a property name ${JSON.stringify(k)} a plan cannot carry`); o[k] = ref(t[1][k]) }
        out[1] = o; break
      }
      case 'tAddl': case 'tItems': case 'tRef': case 'tNot': out[1] = ref(t[1]); break
      case 'tTuple': case 'tAll': out[1] = t[1].map(ref); break
      case 'tIf': out[1] = ref(t[1]); out[2] = t[2] === -1 ? -1 : ref(t[2]); out[3] = t[3] === -1 ? -1 : ref(t[3]); break
      case 'tLeaf':
        out[1] = kernel(t[1])
        if (t.length > 3) { out[3] = kernel(t[3]); out[5] = t[5] == null ? undefined : hints(t[5]) }
        break
    }
    return out
  }
  return P.map(node)
}

// The validator for a plan, once the kernels it names are loaded. `rich`:
// what ata-validator/plan-rich passes in.
export async function fromPlan (plan, rich = null) {
  if (plan === null || typeof plan !== 'object' || plan.v !== PLAN_VERSION) fail(`a plan of version ${PLAN_VERSION} is expected`)
  const uses = Array.isArray(plan.uses) ? plan.uses : fail('the plan does not list its kernels')
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
  const F = Array.isArray(plan.F) ? plan.F : []
  const fill = F.length ? tableFill : null
  return plan.rich ? rich.tableRich(P, F, fill, plan.rel, order) : tablePlain(P, F, fill, order)
}
