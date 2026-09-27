'use strict'

// Generated code asks whether an object's prototype is Object.prototype before
// it trusts `in` for presence, and reads that prototype through `__proto__`
// where the accessor exists and Object.getPrototypeOf where it does not, as in
// Deno. Both reads must give the answers the interpreted engine gives, on
// objects whose keys are their own and on objects whose keys come through a
// prototype. This compares every object entry point against the interpreter
// over seeded random schemas, once as the process starts and once, in a child
// process, with the accessor deleted the way Deno deletes it.

const assert = require('assert')
const { spawnSync } = require('child_process')

const withoutAccessor = process.argv[2] === '--no-accessor'
if (withoutAccessor) {
  delete Object.prototype.__proto__
  assert.strictEqual(({}).__proto__, undefined, 'the accessor is gone')
}
const { Validator } = require('..')

let x = 0x9e3779b1
const rnd = (k) => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) % k }
const pick = (a) => a[rnd(a.length)]
const NAMES = ['a', 'b', 'c', 'd']

function leaf () {
  return pick([{ type: 'number' }, { type: 'string' }, { type: 'boolean' }, {}, { minimum: 0 }])
}
function objectSchema (depth) {
  const props = {}
  for (const k of NAMES) if (rnd(3) > 0) props[k] = depth > 0 && rnd(3) === 0 ? objectSchema(depth - 1) : leaf()
  const s = { type: 'object', properties: props }
  const keys = Object.keys(props)
  if (keys.length) s.required = keys.filter(() => rnd(2) === 0)
  if (rnd(4) === 0) s.additionalProperties = false
  return s
}
function value (sub, depth) {
  if (sub && sub.type === 'object' && depth > 0) return doc(sub, depth - 1)
  return pick([1, -1, 's', true, null])
}
class Box {}
// The same keys and values, placed on the object itself or on its prototype.
function doc (schema, depth) {
  const own = {}
  const inherited = {}
  for (const k of Object.keys(schema.properties || {})) {
    if (rnd(4) === 0) continue
    ;(rnd(3) === 0 ? inherited : own)[k] = value(schema.properties[k], depth)
  }
  const kind = rnd(4)
  let o
  if (kind === 0) o = Object.create(inherited)
  else if (kind === 1) o = Object.assign(Object.create(null), inherited)
  else if (kind === 2) o = Object.assign(new Box(), inherited)
  else o = Object.assign({}, inherited)
  return Object.assign(o, own)
}

let compared = 0
let inheritedDocs = 0
let bad = 0
const report = (m) => { if (bad++ < 10) console.error(m) }
for (let i = 0; i < 1500; i++) {
  const schema = objectSchema(2)
  const text = JSON.stringify(schema)
  const v = new Validator(JSON.parse(text))
  const ref = new Validator(JSON.parse(text), { engine: 'interpreter' })
  for (let j = 0; j < 8; j++) {
    const d = doc(schema, 2)
    if (Object.getPrototypeOf(d) !== Object.prototype && Object.getPrototypeOf(d) !== null) inheritedDocs++
    const want = ref.validate(d).valid
    const got = [v.isValidObject(d), v.validate(d).valid]
    compared++
    if (got[0] !== want || got[1] !== want) {
      report(`isValidObject ${got[0]}, validate ${got[1]}, interpreter ${want}: ${text} on ${JSON.stringify(d)} (prototype keys ${JSON.stringify(Object.getPrototypeOf(d) && Object.keys(Object.getPrototypeOf(d)))})`)
    }
  }
}

assert.strictEqual(bad, 0, `${bad} disagreements with the interpreter${withoutAccessor ? ' without the __proto__ accessor' : ''}`)
assert.ok(compared > 10000 && inheritedDocs > 2000, `compared ${compared}, ${inheritedDocs} with a prototype of their own: too few`)
console.log(`ok: ${compared} documents agree with the interpreter${withoutAccessor ? ' without the __proto__ accessor' : ''}, ${inheritedDocs} of them with keys on a prototype`)

if (!withoutAccessor) {
  const child = spawnSync(process.execPath, [__filename, '--no-accessor'], { encoding: 'utf8' })
  process.stdout.write(child.stdout)
  process.stderr.write(child.stderr)
  assert.strictEqual(child.status, 0, 'the run without the accessor failed')
}
