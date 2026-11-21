'use strict'

// minLength and maxLength count code points. A high surrogate is half of a
// pair only when a low surrogate follows it; otherwise it is a code point of
// its own. "\ud800b" is two code points, so maxLength 1 rejects it and
// minLength 2 accepts it. A counter that skipped the unit after any high
// surrogate counted it as one and accepted the over-long string.
//
// Every string here, alone and inside longer strings that cross the bounds,
// is checked at count - 1.5 to count + 1.5 in half steps for minLength,
// maxLength and both, at the root and under a property, on every engine and
// entry, through every method. `[...s].length` is the oracle. The 1.x Validator and the 2.0
// entries run again in a process with code generation from strings blocked,
// and again with the small twin off (as tests/run.js runs the suite).

const assert = require('node:assert')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
const { pathToFileURL } = require('node:url')

const ROOT = path.join(__dirname, '..')
const CHILD = process.argv[2] === '--child'
// The counters take a fast path where String.prototype.isWellFormed exists;
// a child runs without it, as an engine that predates it would.
if (CHILD && process.env.ATA_TEST_NO_WELL_FORMED === '1') delete String.prototype.isWellFormed

const BASE = ['\ud800b', '\ud800', '\udc00\ud800', 'a\u{1F642}\ud83d', '\u{1F642}', '\u{10FFFF}', '\ud800\ud800']
const STRINGS = [...BASE]
// Long strings mixing them, so the length sits between the bound and twice
// the bound and the counter has to run.
for (let k = 0; k < BASE.length; k++) {
  let s = ''
  for (let i = 0; s.length < 70 + 9 * k; i++) s += BASE[(i * 3 + k) % BASE.length] + (i % 4 === 0 ? 'x' : '')
  STRINGS.push(s)
}
STRINGS.push('\ud800b'.repeat(40), '\ud800'.repeat(65), 'b\ud800'.repeat(33) + '\udc00', '\u{1F642}'.repeat(50) + '\ud800')

const SCHEMAS = []
for (const s of STRINGS) {
  const n = [...s].length
  // Whole bounds and fractional ones, at half steps around the count.
  for (const b of [n - 1.5, n - 1, n - 0.5, n, n + 0.5, n + 1, n + 1.5]) {
    if (b < 0) continue
    SCHEMAS.push([{ type: 'string', maxLength: b }, s, n <= b])
    SCHEMAS.push([{ type: 'string', minLength: b }, s, n >= b])
  }
  SCHEMAS.push([{ type: 'string', minLength: n, maxLength: n }, s, true])
  SCHEMAS.push([{ type: 'string', minLength: n + 1, maxLength: n + 1 }, s, false])
  SCHEMAS.push([{ type: 'string', minLength: Math.max(0, n - 1), maxLength: n - 1 }, s, false])
  SCHEMAS.push([{ type: 'string', minLength: Math.max(0, n - 0.5), maxLength: n + 0.5 }, s, true])
  SCHEMAS.push([{ type: 'string', minLength: n + 0.5, maxLength: n + 1.5 }, s, false])
}
// The same checks under a required property.
for (const [schema, s, want] of SCHEMAS.slice()) {
  SCHEMAS.push([{ type: 'object', properties: { a: schema }, required: ['a'] }, { a: s }, want])
}

let paths = 0
let checks = 0
const failed = []
function run (name, make) {
  paths++
  let bad = 0
  for (const [schema, doc, want] of SCHEMAS) {
    const where = `${name}: ${JSON.stringify(schema)} on ${JSON.stringify(doc)} (${[...(typeof doc === 'string' ? doc : doc.a)].length} code points)`
    const check = make(schema)
    // The first calls and the calls after warm-up can be answered by
    // different code, so both are asked.
    for (let i = 0; i < 12; i++) {
      const got = check(doc)
      checks++
      if (got !== want) { if (bad++ === 0) failed.push(`${where}: call ${i + 1} answered ${got}, want ${want}`); break }
    }
  }
  if (bad) failed.push(`${name}: ${bad} schemas answered wrongly`)
}

function v1 (V, opts) {
  run(`1.x Validator${opts ? ' ' + JSON.stringify(opts) : ''} isValidObject`, (s) => { const v = new V(s, opts); return (d) => v.isValidObject(d) })
  run(`1.x Validator${opts ? ' ' + JSON.stringify(opts) : ''} validate`, (s) => { const v = new V(s, opts); return (d) => v.validate(d).valid })
  run(`1.x Validator${opts ? ' ' + JSON.stringify(opts) : ''} validateJSON`, (s) => { const v = new V(s, opts); return (d) => v.validateJSON(JSON.stringify(d)).valid })
  // The text with the surrogates written raw rather than escaped.
  run(`1.x Validator${opts ? ' ' + JSON.stringify(opts) : ''} validateJSON raw`, (s) => { const v = new V(s, opts); return (d) => v.validateJSON(raw(d)).valid })
  run(`1.x Validator${opts ? ' ' + JSON.stringify(opts) : ''} isValidJSON`, (s) => { const v = new V(s, opts); return (d) => v.isValidJSON(JSON.stringify(d)) })
}

// JSON text with every string written out as is, lone surrogates included.
const raw = (d) => typeof d === 'string' ? '"' + d + '"' : '{"a":"' + d.a + '"}'

function v2 (name, V) {
  run(`${name} isValidObject`, (s) => { const v = new V(s); return (d) => v.isValidObject(d) })
  run(`${name} validate`, (s) => { const v = new V(s); return (d) => v.validate(d).valid })
  run(`${name} validateJSON`, (s) => { const v = new V(s); return (d) => v.validateJSON(JSON.stringify(d)).valid })
  run(`${name} validateJSON raw`, (s) => { const v = new V(s); return (d) => v.validateJSON(raw(d)).valid })
}

async function main () {
  const { Validator } = require('..')
  v1(Validator)
  v1(Validator, { engine: 'interpreter' })

  if (!CHILD || process.env.ATA_TEST_NO_WELL_FORMED === '1') {
    // The engines on their own.
    for (const f of ['engine-small.js', 'engine-full.js']) {
      const { createSmall } = require(path.join(ROOT, 'lib', f))
      run(`lib/${f} isValid`, (s) => { const e = createSmall(s, {}); return (d) => e.isValid(d) })
      run(`lib/${f} validate`, (s) => { const e = createSmall(s, {}); return (d) => e.validate(d).valid })
    }
    const { createEngine } = require(path.join(ROOT, 'lib/core/engine.js'))
    run('lib/core/engine.js isValid', (s) => { const e = createEngine(s, {}); return (d) => e.isValid(d) })
    run('lib/core/engine.js validate', (s) => { const e = createEngine(s, {}); return (d) => e.validate(d).valid })
    const { createVerdict } = require(path.join(ROOT, 'lib/core/verdict.js'))
    run('lib/core/verdict.js', (s) => { const f = createVerdict(s, {}); assert.ok(typeof f === 'function', 'the verdict core takes ' + JSON.stringify(s)); return f })
    const ic = require(path.join(ROOT, 'lib/interpreter.js'))
    run('lib/interpreter.js', (s) => { const w = ic.createInterpreter(s, { tier: Infinity }); return (d) => w.validate(d).valid })
  }

  const imp = (f) => import(pathToFileURL(path.join(ROOT, f)).href)
  v2('index.v2.browser.mjs', (await imp('index.v2.browser.mjs')).Validator)
  v2('index.v2.core.mjs', (await imp('index.v2.core.mjs')).Validator)
  v2('index.v2.edge.mjs', (await imp('index.v2.edge.mjs')).Validator)

  if (failed.length) { console.error(failed.join('\n')); process.exit(1) }
  if (!CHILD) {
    const modes = [
      [['--disallow-code-generation-from-strings'], {}],
      [[], { ATA_NO_SMALL_TWIN: '1' }],
      [['--disallow-code-generation-from-strings'], { ATA_NO_SMALL_TWIN: '1' }],
      [[], { ATA_TEST_NO_WELL_FORMED: '1' }],
      [['--disallow-code-generation-from-strings'], { ATA_TEST_NO_WELL_FORMED: '1', ATA_NO_SMALL_TWIN: '1' }]
    ]
    for (const [flags, env] of modes) {
      const r = spawnSync(process.execPath, [...flags, __filename, '--child'], { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...env } })
      if (r.status !== 0) assert.fail(`child ${flags.join(' ')} ${JSON.stringify(env)}: exit ${r.status}\n${r.stdout}${r.stderr}`)
      const m = /^paths (\d+) checks (\d+)$/m.exec(r.stdout)
      assert.ok(m, 'the child reports its counts')
      paths += +m[1]; checks += +m[2]
    }
    console.log(`code point pairs: ${paths} paths, ${SCHEMAS.length} schemas, ${checks} checks, all agree with [...s].length`)
  } else {
    console.log(`paths ${paths} checks ${checks}`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
