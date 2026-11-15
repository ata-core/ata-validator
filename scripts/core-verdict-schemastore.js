'use strict'

// The verdict core (lib/core/verdict.js) on SchemaStore: every schema with
// sample documents, the documents and three copies of each changed in one
// place (the generator scripts/gate.js uses), compared with the interpreter's
// walk on the schema and arguments the Validator hands it, and with the
// Validator's own verdict (default engine, defaults off). Not part of npm
// test: it needs a SchemaStore checkout.
//
// Usage: node scripts/core-verdict-schemastore.js <schemastore checkout>
// Exits 1 on any difference.

const fs = require('fs')
const path = require('path')
const im = require('../lib/interpreter.js')
const real = im.createInterpreter
let cap = null
im.createInterpreter = (schema, args) => { cap = { schema, args }; return real(schema, args) }
const { Validator } = require('..')
const { createVerdict } = require('../lib/core/verdict.js')

const root = process.argv[2]
if (!root || !fs.existsSync(path.join(root, 'src/schemas/json'))) { console.error('usage: node scripts/core-verdict-schemastore.js <schemastore checkout>'); process.exit(2) }

let seed = 11
const rnd = (n) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return (seed >>> 12) % n }
const BAD = ['', ' ', 'not a uri', 'x y', '2026-13-45', '::::', 'a..b', '-x-', '9'.repeat(40)]
const mutate = (doc) => {
  const c = structuredClone(doc); const slots = []
  const walk = (n, depth) => { if (depth > 7 || n === null || typeof n !== 'object') return; for (const k of Object.keys(n)) { slots.push([n, k]); walk(n[k], depth + 1) } }
  walk(c, 0)
  if (slots.length === 0) return 12345
  const [o, k] = slots[rnd(slots.length)]; const r = rnd(9)
  if (r === 0) o[k] = 12345; else if (r === 1) o[k] = 'zz'; else if (r === 2) o[k] = null; else if (r === 3) o[k] = [1, 'a']; else if (r === 4) o[k] = { bogus: 1 }
  else if (r === 5) { if (Array.isArray(o)) o.splice(+k, 1); else delete o[k] } else if (r === 6) { if (!Array.isArray(o)) o['zzUnknown' + rnd(9)] = true } else if (r === 7 && typeof o[k] === 'string') o[k] = BAD[rnd(BAD.length)]; else o[k] = o[k] === true ? false : true
  return c
}

const dir = path.join(root, 'src/schemas/json')
let schemas = 0, taken = 0, declined = 0, skipped = 0, docs = 0, differ = 0
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json')).sort()) {
  const name = f.slice(0, -5)
  let schema; try { schema = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')) } catch { continue }
  const list = []
  for (const t of ['src/test', 'src/negative_test']) {
    const td = path.join(root, t, name)
    if (!fs.existsSync(td)) continue
    for (const x of fs.readdirSync(td).filter((x) => x.endsWith('.json'))) { try { list.push(JSON.parse(fs.readFileSync(path.join(td, x), 'utf8'))) } catch {} }
  }
  if (list.length === 0) continue
  for (const d of list.slice()) for (let i = 0; i < 3; i++) list.push(mutate(d))
  schemas++
  cap = null
  let full
  try { new Validator(schema, { engine: 'interpreter', useDefaults: false }).isValidObject(null); full = new Validator(schema, { useDefaults: false }) } catch { skipped++; continue }
  if (cap === null) { skipped++; continue }
  const walk = real(cap.schema, { ...cap.args, tier: Infinity })
  let core
  try { core = createVerdict(cap.schema, cap.args) } catch (e) { console.log(`${name}: core threw on the schema: ${e.message}`); differ++; continue }
  if (core === null) { declined++; continue }
  taken++
  for (const d of list) {
    docs++
    let want; try { want = walk.validate(d).valid } catch (e) { want = 'throws' }
    let other; try { other = full.isValidObject(structuredClone(d)) } catch (e) { other = 'throws' }
    let got; try { got = core(d) } catch (e) { got = 'throws' }
    if (got !== want || (other !== want && got !== other)) {
      differ++
      if (differ <= 20) console.log(`${name}: core ${got}, walk ${want}, Validator ${other}: ${JSON.stringify(d).slice(0, 120)}`)
    }
  }
}
console.log(`SchemaStore: ${schemas} schemas with documents, ${taken} taken, ${declined} declined, ${skipped} the Validator refused; ${docs} documents on taken schemas, ${differ} differences`)
process.exit(differ === 0 ? 0 : 1)
