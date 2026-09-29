'use strict'

// Without the native addon the buffer APIs (isValid(buffer), isValidPrepadded,
// isValidNDJSON, isValidParallel, countValid) answer through validate(). They
// threw before, which made the addon a requirement for five methods where it is
// an accelerator everywhere else. Run in a child with the addon disabled, over
// every case of the official suite, each answer must be validate()'s.

const { spawnSync } = require('child_process')
const path = require('path')

const child = `
const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { Validator, createPaddedBuffer } = require(${JSON.stringify(path.join(__dirname, '..'))})
const base = ${JSON.stringify(path.join(__dirname, 'suite', 'tests', 'draft2020-12'))}
let cases = 0, schemas = 0
for (const f of fs.readdirSync(base).filter((x) => x.endsWith('.json'))) {
  for (const group of JSON.parse(fs.readFileSync(path.join(base, f), 'utf8'))) {
    let v
    try { v = new Validator(group.schema); v.validate(null) } catch { continue }
    schemas++
    const lines = []
    const want = []
    for (const t of group.tests) {
      const text = JSON.stringify(t.data)
      if (text === undefined) continue
      const expected = v.validate(JSON.parse(text)).valid
      assert.strictEqual(v.isValid(Buffer.from(text)), expected, f + ' ' + group.description + ' ' + t.description)
      const p = createPaddedBuffer(text)
      assert.strictEqual(v.isValidPrepadded(p.buffer, p.length), expected, 'prepadded ' + f)
      lines.push(text); want.push(expected)
      cases++
    }
    const nd = Buffer.from(lines.join('\\n') + '\\n')
    assert.deepStrictEqual(v.isValidNDJSON(nd), want, 'ndjson ' + f + ' ' + group.description)
    assert.deepStrictEqual(v.isValidParallel(nd), want, 'parallel ' + f)
    assert.strictEqual(v.countValid(nd), want.filter(Boolean).length, 'countValid ' + f)
  }
}
const v = new Validator({ type: 'object' })
assert.strictEqual(v.isValid(Buffer.from('{bad')), false, 'text that does not parse is invalid')
// The options that change what validate() sees: coercion, defaults, removal,
// and a custom keyword. The buffer answer must follow each of them.
const shaped = { type: 'object', properties: { n: { type: 'integer', minimum: 2 }, s: { type: 'string', default: 'x', minLength: 1 }, b: { type: 'boolean' } }, required: ['n', 's'], additionalProperties: false }
const texts = ['{"n":"3"}', '{"n":3}', '{"n":1,"s":"a"}', '{"n":"x"}', '{"n":3,"s":""}', '{"n":3,"extra":1}', '{"n":3,"s":"a","b":"true"}', '[]', 'null', '{"n":3.0,"s":"ok"}']
let optionCases = 0
for (const options of [{ coerceTypes: true }, { useDefaults: true }, { removeAdditional: true }, { coerceTypes: true, useDefaults: true, removeAdditional: 'all' }, { keywords: { even: { validate: (s, d) => typeof d !== 'number' || d % 2 === 0 } } }]) {
  const sch = options.keywords ? { ...shaped, properties: { ...shaped.properties, n: { ...shaped.properties.n, even: true } } } : shaped
  const w = new Validator(sch, options)
  for (const text of texts) {
    const expected = w.validate(JSON.parse(text)).valid
    assert.strictEqual(w.isValid(Buffer.from(text)), expected, JSON.stringify(options) + ' ' + text)
    assert.deepStrictEqual(w.isValidNDJSON(Buffer.from(text + '\\n' + text + '\\n')), [expected, expected], 'ndjson ' + JSON.stringify(options) + ' ' + text)
    optionCases++
  }
}
assert.ok(cases > 1000, 'only ' + cases + ' cases')
console.log('ok: without the native addon the buffer APIs agree with validate() on ' + cases + ' suite cases over ' + schemas + ' schemas and ' + optionCases + ' cases under coercion, defaults, removal and a custom keyword')
`
const r = spawnSync(process.execPath, ['-e', child], { encoding: 'utf8', env: { ...process.env, ATA_NO_NATIVE: '1' } })
process.stdout.write(r.stdout)
process.stderr.write(r.stderr)
if (r.status !== 0) process.exit(1)
