'use strict'

// An emitted module must not walk the whole document to frame two errors.
//
// A module built with `{ positions: true }` embeds the position-map builder and
// calls it when validation fails, to turn each error's instancePath into a line
// and a column. It embedded the builder that records an entry for every node, so
// on a 149 KB config the frame read cost 8.70x a JSON.parse of the same text,
// while the runtime had already moved to building only the pointers the errors
// name and sat at 3.68x.
//
// That gap is the one that matters for adoption: a consumer on the build step runs
// the emitted module, not the runtime, so none of the runtime's work reaches them.
//
// The emitted module looks up exactly one pointer per error, `e.instancePath` or
// `e.path`, so the wanted set is those pointers and nothing else. The targeted
// builder is also 125 characters smaller than the full one, so this does not cost
// emitted bytes.
//
// The budget is a ratio to JSON.parse on the same text, so machine speed drops out.

const assert = require('node:assert')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { toStandaloneModule } = require('../build.js')

const schema = {
  type: 'object',
  required: ['version'],
  properties: {
    version: { type: 'string', pattern: '^[0-9]+\\.[0-9]+\\.[0-9]+$' },
    sections: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: {
          entries: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                weight: { type: 'number', minimum: 0 },
                nested: { type: 'object', properties: { retries: { type: 'integer', maximum: 10 } } },
              },
            },
          },
        },
      },
    },
  },
}

const src = toStandaloneModule(schema, { format: 'cjs', abortEarly: false, positions: true })
assert.ok(!src.includes('require('), 'the emitted module still imports nothing')

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-aot-pos-'))
const file = path.join(dir, 'mod.cjs')
fs.writeFileSync(file, src)
const mod = require(file)
fs.rmSync(dir, { recursive: true, force: true })

function makeConfig (bad, tag) {
  const cfg = { version: bad ? 'nope' : '1.0.0', sections: {}, _t: tag }
  for (let s = 0; s < 20; s++) {
    const entries = []
    for (let i = 0; i < 60; i++) entries.push({ id: 'e' + i, weight: i, nested: { retries: 3 } })
    cfg.sections['s' + s] = { entries }
  }
  return cfg
}
const good = [], bad = [], deep = []
for (let i = 0; i < 40; i++) {
  good.push(JSON.stringify(makeConfig(false, i), null, 2))
  bad.push(JSON.stringify(makeConfig(true, i), null, 2))
  const d = makeConfig(false, i)
  d.sections.s19.entries[59].nested.retries = 99   // the last node in the document
  deep.push(JSON.stringify(d, null, 2))
}

// Frames first: a pointer near the front, one at the very back, a valid document
// and a broken one. A targeted walk that stops early is exactly where a frame
// would quietly go missing.
{
  const r = mod.validateJSON(bad[0])
  assert.strictEqual(r.valid, false)
  assert.strictEqual(r.errors.length, 1)
  assert.strictEqual(r.errors[0].instancePath, '/version')
  assert.strictEqual(r.errors[0].dataFrame.line, 2, 'a frame near the front')

  const d = mod.validateJSON(deep[0])
  assert.strictEqual(d.valid, false)
  assert.strictEqual(d.errors.length, 1)
  assert.strictEqual(d.errors[0].instancePath, '/sections/s19/entries/59/nested/retries')
  assert.ok(d.errors[0].dataFrame.line > 3000, `a frame at the back, got line ${d.errors[0].dataFrame.line}`)
  const frame = d.errors[0].dataFrame
  assert.strictEqual(deep[0].slice(frame.byteOffset, frame.byteOffset + frame.length), '99', 'and it spans the offending value')

  assert.strictEqual(mod.validateJSON(good[0]).valid, true, 'a clean document is valid')

  const broken = mod.validateJSON('{"version": ')
  assert.strictEqual(broken.valid, false)
  assert.strictEqual(broken.errors[0].code, 'ATA9001', 'a truncated document is one parse error')
  assert.ok(broken.errors[0].dataFrame.line === 1, 'with a frame on the document')
  console.log('ok: frames at the front, at the back, and on a broken document')
}

const median = (a) => a.sort((x, y) => x - y)[a.length >> 1]
function med (fn, iters) {
  for (let i = 0; i < 20; i++) fn()
  const runs = []
  for (let r = 0; r < 9; r++) {
    const t = process.hrtime.bigint()
    for (let i = 0; i < iters; i++) fn()
    runs.push(Number(process.hrtime.bigint() - t) / 1e3 / iters)
  }
  return median(runs)
}

const N = 20
let i = 0
const parseT = [], frameT = [], deepT = []
for (let r = 0; r < 5; r++) {
  parseT.push(med(() => JSON.parse(bad[(i++) % 40]), N))
  frameT.push(med(() => mod.validateJSON(bad[(i++) % 40]).errors[0].dataFrame.line, N))
  deepT.push(med(() => mod.validateJSON(deep[(i++) % 40]).errors[0].dataFrame.line, N))
}
const frontRatio = median(frameT) / median(parseT)
const backRatio = median(deepT) / median(parseT)

// The front case can stop early; the back case is the worst case for the
// technique and still has to reach the end, so it gets its own budget.
const FRONT_BUDGET = 5
const BACK_BUDGET = 7
let failed = false
if (frontRatio > FRONT_BUDGET) {
  console.error(`FAIL aot positions cost: framing an error near the front costs ${frontRatio.toFixed(2)}x JSON.parse, over the ${FRONT_BUDGET}x budget; the emitted module is recording every node`)
  failed = true
}
if (backRatio > BACK_BUDGET) {
  console.error(`FAIL aot positions cost: framing an error at the back costs ${backRatio.toFixed(2)}x JSON.parse, over the ${BACK_BUDGET}x budget`)
  failed = true
}
if (failed) process.exit(1)
console.log(`aot positions cost: front ${frontRatio.toFixed(2)}x JSON.parse (budget ${FRONT_BUDGET}), back ${backRatio.toFixed(2)}x (budget ${BACK_BUDGET})`)
