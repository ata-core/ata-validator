'use strict'

// Reading an error's source frame must not cost a walk of the whole document.
//
// The position map records an entry for every node in the document. A rejection
// names two or three pointers, and those are the only entries anything reads, so
// on a 149 KB config with two errors the map was 1330 microseconds of a 2457
// microsecond error read: the dominant term, nearly all of it spent recording
// positions for nodes nobody asks about.
//
// Given the pointers the errors name, a subtree that cannot contain one of them
// is scanned to its end and never walked. The budget is a ratio to JSON.parse on
// the same text, not a time, so machine speed does not matter. Measured on this
// fixture: the full-map regime is 13x parse, the targeted one is about 3x, and
// the gate sits between them. The worst case for the technique, a single pointer
// at the very end of the document, still measured 3.7x faster than the full map.

const { Validator } = require('..')

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
                tags: { type: 'array', items: { type: 'string' } },
                nested: {
                  type: 'object',
                  properties: { retries: { type: 'integer', maximum: 10 }, url: { type: 'string' } },
                },
              },
            },
          },
        },
      },
    },
  },
}

const cfg = { version: 'nope', sections: {} }
for (let s = 0; s < 20; s++) {
  const entries = []
  for (let i = 0; i < 60; i++) {
    entries.push({ id: 'e' + i, weight: i, tags: ['a', 'b', 'c'], nested: { retries: 3, url: 'https://example.com/' + i } })
  }
  cfg.sections['s' + s] = { entries }
}
cfg.sections.s0.entries[0].nested.retries = 99
const raw = JSON.stringify(cfg, null, 2)

const v = new Validator(schema)

// Frames must be right before a ratio means anything.
{
  const errs = v.validateJSON(raw).errors
  if (errs.length !== 2) {
    console.error(`FAIL targeted positions: expected 2 errors, got ${errs.length}`)
    process.exit(1)
  }
  const byPath = Object.fromEntries(errs.map((e) => [e.instancePath, e]))
  const version = byPath['/version']
  const retries = byPath['/sections/s0/entries/0/nested/retries']
  if (!version || !retries) {
    console.error('FAIL targeted positions: expected /version and the deep retries error, got ' + Object.keys(byPath))
    process.exit(1)
  }
  for (const [path, e] of Object.entries(byPath)) {
    if (!e.dataFrame || !(e.dataFrame.line > 0) || !e.anchor || !(e.anchor.keyLine > 0)) {
      console.error(`FAIL targeted positions: ${path} lost its frame: ${JSON.stringify(e.dataFrame)} ${JSON.stringify(e.anchor)}`)
      process.exit(1)
    }
    const slice = raw.slice(e.dataFrame.byteOffset, e.dataFrame.byteOffset + e.dataFrame.length)
    if (slice !== JSON.stringify(path === '/version' ? 'nope' : 99)) {
      console.error(`FAIL targeted positions: ${path} frame spans ${JSON.stringify(slice)}`)
      process.exit(1)
    }
  }
}

const median = (a) => a.sort((x, y) => x - y)[a.length >> 1]
function med (fn, iters) {
  for (let i = 0; i < 15; i++) fn()
  const runs = []
  for (let r = 0; r < 9; r++) {
    const t = process.hrtime.bigint()
    for (let i = 0; i < iters; i++) fn()
    runs.push(Number(process.hrtime.bigint() - t) / 1e3 / iters)
  }
  return median(runs)
}

const N = 20
const frames = med(() => v.validateJSON(raw).errors[0].dataFrame.line, N)
const parse = med(() => JSON.parse(raw), N)
const ratio = frames / parse

const BUDGET = 8
if (ratio > BUDGET) {
  console.error(`FAIL targeted positions: reading a frame costs ${ratio.toFixed(1)}x JSON.parse, over the ${BUDGET}x budget; the map is walking the whole document again`)
  process.exit(1)
}
console.log(`targeted positions: frame read is ${ratio.toFixed(1)}x JSON.parse (budget ${BUDGET})`)
