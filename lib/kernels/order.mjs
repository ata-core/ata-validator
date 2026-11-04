// The errors into schema order, a module of its own so a page that never
// sorts (most forms) does not carry it, and ata-validator/plan can load it
// when a plan asks.
import { rankFor } from './rank.mjs'

// The errors in schema declaration order, as the current engine orders them:
// by the rank of each error's schemaPath in the root schema (rankFor of
// lib/schema-order.js, copied in ./rank.mjs; lib/aot-order.js sorts by it too), stable, and
// a collapsed error's branch errors the same way, in a copy.
const after = (a, b) => { const m = Math.min(a.length, b.length); for (let i = 0; i < m; i++) if (a[i] !== b[i]) return a[i] > b[i]; return a.length > b.length }
export function ordered (root, list) {
  const n = list.length
  if (n === 1 && !Array.isArray(list[0].branchErrors)) return list
  const out = new Array(n); const keys = new Array(n)
  for (let i = 0; i < n; i++) {
    let e = list[i]
    if (Array.isArray(e.branchErrors) && e.branchErrors.length) { const b = ordered(root, e.branchErrors); if (b !== e.branchErrors) e = Object.assign({}, e, { branchErrors: b }) }
    const k = rankFor(root, e.schemaPath) || []
    let j = i - 1
    while (j >= 0 && after(keys[j], k)) { keys[j + 1] = keys[j]; out[j + 1] = out[j]; j-- }
    keys[j + 1] = k; out[j + 1] = e
  }
  for (let i = 0; i < n; i++) if (out[i] !== list[i]) return out
  return list
}
