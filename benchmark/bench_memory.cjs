// Retained heap per validator instance, the figures on the site's benchmarks
// page: two forced collections around 2000 instances of a ten-key object
// schema. Modes:
//   idle  one shared schema object, never called
//   own   each instance with its own schema object, never called
//   used  each instance with its own schema, validated once, so each compiles
//
//   node --expose-gc benchmark/bench_memory.cjs idle|own|used
const { Validator } = require(process.argv[3] || '..')
const mode = process.argv[2]
const schemaFor = (i) => ({ type: 'object', required: ['k0', 'k1', 'k2'], properties: Object.fromEntries(Array.from({ length: 10 }, (_, j) => [`k${j}`, j % 3 === 0 ? { type: 'string', minLength: 1 } : j % 3 === 1 ? { type: 'integer', minimum: 0 } : { type: 'boolean' }])), $comment: mode === 'idle' ? undefined : 's' + i })
const shared = schemaFor(0)
const doc = { k0: 'a', k1: 1, k2: true, k3: 'b', k4: 2, k5: false, k6: 'c', k7: 3, k8: true, k9: 'd' }
new Validator(schemaFor(99999)).validate(doc)
const N = 2000, keep = []
global.gc(); global.gc()
const before = process.memoryUsage().heapUsed
for (let i = 0; i < N; i++) {
  const v = new Validator(mode === 'idle' ? shared : schemaFor(i))
  if (mode === 'used') v.validate(doc)
  keep.push(v)
}
global.gc(); global.gc()
const after = process.memoryUsage().heapUsed
console.log(((after - before) / N / 1024).toFixed(2))
if (keep.length !== N) throw new Error()
