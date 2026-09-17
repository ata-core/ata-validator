// The harness behind the request-cost figures on ata-validator.com/docs/benchmarks.
// One signup-body schema, medians of nine interleaved rounds in a single process
// after a warmup. Run it twice to see both columns of the blocked table:
//
//   node benchmark/bench_docs_site.mjs
//   node --disallow-code-generation-from-strings benchmark/bench_docs_site.mjs
import { createRequire } from 'node:module'
const require = createRequire(import.meta.url)
const { Validator } = require('../index.js')

const schema = {
  type: 'object',
  required: ['email', 'name', 'age'],
  additionalProperties: false,
  properties: {
    email: { type: 'string', format: 'email', maxLength: 128 },
    name: { type: 'string', minLength: 1, maxLength: 80 },
    age: { type: 'integer', minimum: 13, maximum: 130 },
    tags: { type: 'array', items: { type: 'string' }, maxItems: 10 },
    address: {
      type: 'object',
      required: ['city', 'country'],
      properties: {
        city: { type: 'string' },
        country: { type: 'string', minLength: 2, maxLength: 2 },
        zip: { type: 'string', pattern: '^[0-9]{5}$' },
      },
    },
  },
}

const valid = {
  email: 'ada@example.com',
  name: 'Ada',
  age: 36,
  tags: ['beta'],
  address: { city: 'London', country: 'GB', zip: '12345' },
}
const invalid = { ...valid, age: 7 }

const v = new Validator(schema)
if (!v.validate(valid).valid || v.validate(invalid).valid) throw new Error('sanity')
console.log('engine:', v.engine())

const cases = [
  ['accepts the body, verdict        ', () => v.isValidObject(valid)],
  ['rejects it, verdict only         ', () => v.isValidObject(invalid)],
  ['accepts via validate()           ', () => v.validate(valid).valid],
  ['rejects via validate(), no read  ', () => v.validate(invalid).valid],
  ['rejects it, error list read      ', () => v.validate(invalid).errors.length],
]

const N = 200000
for (const [, f] of cases) for (let i = 0; i < 50000; i++) f()
const acc = new Map(cases.map(([n]) => [n, []]))
for (let r = 0; r < 9; r++) {
  for (const [n, f] of cases) {
    const s = process.hrtime.bigint()
    for (let i = 0; i < N; i++) f()
    acc.get(n).push(Number(process.hrtime.bigint() - s) / N)
  }
}
for (const [n, xs] of acc) {
  xs.sort((a, b) => a - b)
  console.log(n, xs[4].toFixed(1).padStart(8), 'ns')
}

// Ten route schemas constructed and through their first validation, the cold
// cost a server pays before it can serve. Fresh schema objects each round so
// nothing is answered from a cache.
const routes = []
for (let i = 0; i < 10; i++) {
  const s = structuredClone(schema)
  s.properties[`extra_${i}`] = { type: 'string' }
  routes.push(s)
}
const docs = routes.map(() => structuredClone(valid))
const boot = []
for (let r = 0; r < 200; r++) {
  const fresh = routes.map((s) => structuredClone(s))
  const s = process.hrtime.bigint()
  for (let i = 0; i < 10; i++) new Validator(fresh[i]).validate(docs[i])
  boot.push(Number(process.hrtime.bigint() - s) / 1e6)
}
boot.sort((a, b) => a - b)
console.log('ten route schemas ready ', boot[100].toFixed(2).padStart(8), 'ms')
