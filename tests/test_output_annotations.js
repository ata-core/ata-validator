'use strict'

// The official suite's annotation tests, under `tests/suite/annotations/`,
// checked the way Bowtie checks them. Each assertion names an instance
// location and a keyword, and the annotations produced for that pair have to
// match the expected set exactly: an empty set asserts that nothing was
// produced there. Expected locations are schema locations relative to the
// root, with the keyword appended and percent-decoded.
//
// toOutput reports `keywordLocation` as the evaluation path, which goes
// through `$ref`, and `absoluteKeywordLocation` as the place in the schema
// resource. The suite asks about the second, so that is what is compared.

const fs = require('node:fs')
const path = require('node:path')
const assert = require('node:assert')
const { Validator } = require('..')
const { toOutput } = require('../lib/output-format')

const SUITE = path.join(__dirname, 'suite', 'annotations', 'tests')
const ROOT = 'https://example.com/annotation-test'

// Release number per dialect, for the suite's `compatibility` field.
const DIALECTS = {
  'draft-07': ['http://json-schema.org/draft-07/schema#', 7],
  '2019-09': ['https://json-schema.org/draft/2019-09/schema', 2019],
  '2020-12': ['https://json-schema.org/draft/2020-12/schema', 2020],
}

if (!fs.existsSync(SUITE)) {
  console.log('output annotations: suite not checked out, skipped')
  process.exit(0)
}

// "7" means 7 and later, "=2020" only 2020, "<=2019" up to 2019, and a
// comma joins conditions. Absent means every dialect.
function compatible (release, compat) {
  if (compat === undefined) return true
  return String(compat).split(',').every((c) => {
    const m = /^(<=|=)?(\d+)$/.exec(c.trim())
    if (!m) return false
    const n = Number(m[2])
    if (m[1] === '=') return release === n
    if (m[1] === '<=') return release <= n
    return release >= n
  })
}

// Where each schema resource embedded in the root sits, by URI, as Bowtie's
// `Annotation.relative_to` maps them. Any other URI is the root resource.
function embedded (schema, base, ptr, map) {
  if (schema === null || typeof schema !== 'object') return map
  if (!Array.isArray(schema) && typeof schema.$id === 'string') {
    base = new URL(schema.$id, base).href.split('#')[0]
    if (ptr !== '') map.set(base, ptr)
  }
  for (const k of Object.keys(schema)) {
    if (k === 'const' || k === 'enum' || k === 'default' || k === 'examples') continue
    embedded(schema[k], base, ptr + '/' + String(k).replace(/~/g, '~0').replace(/\//g, '~1'), map)
  }
  return map
}

function rootLocation (unit, resources) {
  const abs = unit.absoluteKeywordLocation
  if (typeof abs !== 'string') return '#' + unit.keywordLocation
  const i = abs.indexOf('#')
  const at = resources.get(abs.slice(0, i))
  return '#' + (at === undefined ? '' : at) + abs.slice(i + 1)
}

function keywordOf (unit) {
  const segs = unit.keywordLocation.split('/')
  return segs[segs.length - 1].replace(/~1/g, '/').replace(/~0/g, '~')
}

function run (only) {
  const counts = {}
  const failures = []
  for (const [name, [uri, release]] of Object.entries(DIALECTS)) {
    if (only && only !== name) continue
    let total = 0
    let passed = 0
    for (const file of fs.readdirSync(SUITE).filter((f) => f.endsWith('.json')).sort()) {
      for (const c of JSON.parse(fs.readFileSync(path.join(SUITE, file), 'utf8')).suite) {
        if (!compatible(release, c.compatibility)) continue
        const schema = typeof c.schema === 'object' && c.schema !== null && !('$schema' in c.schema)
          ? { $schema: uri, ...c.schema }
          : c.schema
        for (const t of c.tests) {
          total++
          const where = `${name} ${file} :: ${c.description} :: ${JSON.stringify(t.instance)}`
          let out
          try {
            const v = new Validator(schema, { assertFormat: false, useDefaults: false, baseURI: ROOT })
            out = toOutput(v, t.instance)
          } catch (e) {
            failures.push(`${where}\n    threw: ${e.message}`)
            continue
          }
          if (!out.valid) {
            failures.push(`${where}\n    reported invalid`)
            continue
          }
          const resources = embedded(schema, ROOT, '', new Map())
          const bad = []
          for (const a of t.assertions) {
            const expected = {}
            for (const [loc, value] of Object.entries(a.expected)) expected[decodeURIComponent(loc + '/' + a.keyword)] = value
            const got = {}
            for (const u of out.annotations || []) {
              if (u.instanceLocation === (a.location || '') && keywordOf(u) === a.keyword) got[decodeURIComponent(rootLocation(u, resources))] = u.annotation
            }
            try { assert.deepStrictEqual(got, expected) } catch {
              bad.push(`${a.keyword} at '${a.location || ''}': expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`)
            }
          }
          if (bad.length) failures.push(`${where}\n    ${bad.join('\n    ')}`)
          else passed++
        }
      }
    }
    counts[name] = [passed, total]
  }
  return { counts, failures }
}

// Shapes the suite does not reach. A branch is judged in place, with the root
// and registry it was written against and in its own dialect; `format` stays
// an annotation when it is not asserted.
function extras () {
  const failures = []
  const check = (name, schema, data, opts, expected) => {
    const got = (toOutput(new Validator(schema, opts), data).annotations || [])
      .map((u) => [u.keywordLocation, u.annotation])
    try { assert.deepStrictEqual(got, expected) } catch {
      failures.push(`${name}\n    expected ${JSON.stringify(expected)}, got ${JSON.stringify(got)}`)
    }
  }
  check('draft-07 anyOf branch through $ref to definitions',
    { $schema: 'http://json-schema.org/draft-07/schema#', definitions: { n: { type: 'number', title: 'N' } }, anyOf: [{ $ref: '#/definitions/n' }, { type: 'string', title: 'S' }] },
    5, undefined, [['/anyOf/0/$ref/title', 'N']])
  check('oneOf branch through $ref to a registered schema',
    { oneOf: [{ $ref: 'https://example.com/a' }, { type: 'string', title: 'S' }] },
    3, { schemas: [{ $id: 'https://example.com/a', type: 'number', title: 'A' }] }, [['/oneOf/0/$ref/title', 'A']])
  check('format under assertFormat: false, schema given as text',
    JSON.stringify({ format: 'email', title: 'T' }), 'not an email', { assertFormat: false },
    [['/format', 'email'], ['/title', 'T']])
  return failures
}

if (require.main === module) {
  const result = run(process.argv[2])
  const counts = result.counts
  const failures = result.failures.concat(process.argv[2] ? [] : extras())
  for (const f of failures) console.error('  ' + f + '\n')
  const line = Object.entries(counts).map(([n, [p, t]]) => `${n} ${p} of ${t}`).join(', ')
  if (failures.length && !process.env.ANNOTATIONS_REPORT) {
    console.error(`FAIL output annotations: ${line}`)
    process.exit(1)
  }
  console.log(`output annotations: ${line}`)
}

module.exports = { run }
