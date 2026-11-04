// ata-validator/plan-rich: fromPlan for plans with ata's rich errors (code,
// expected, received, detail, suggestion), and with plain ones. A separate
// entry so a page reading plain plans carries none of this: the descriptors
// that carry the rich fields, and the format hints the module writer writes
// into its modules (lib/ir/emit-deps.mjs).
import { tableRich } from './table.mjs'
import { fromPlan as fromAnyPlan, PLAN_VERSION } from './plan.mjs'
import { type, required, additionalProperties, enumK, constK, formatK, minLength, maxLength, minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf, pattern, minItems, maxItems, minProperties, maxProperties } from './kernels.mjs'
import { FORMAT_HINTS } from '../ir/emit-deps.mjs'

const RICH = { tableRich, type, required, additionalProperties, enumK, constK, formatK, minLength, maxLength, minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf, pattern, minItems, maxItems, minProperties, maxProperties }
// A format's hint, as the module writer builds it from the same source.
const hint = (name) => { const h = Object.prototype.hasOwnProperty.call(FORMAT_HINTS, name) ? FORMAT_HINTS[name] : null; return h === null ? undefined : (v) => { const t = h(v); return t ? { text: t, kind: 'format' } : null } }

export { PLAN_VERSION }
// The validator for a plan, rich or plain.
export const fromPlan = (plan) => fromAnyPlan(plan, { RICH, hint, tableRich })
