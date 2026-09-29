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
assert.ok(cases > 1000, 'only ' + cases + ' cases')
console.log('ok: without the native addon the buffer APIs agree with validate() on ' + cases + ' suite cases over ' + schemas + ' schemas')
`
const r = spawnSync(process.execPath, ['-e', child], { encoding: 'utf8', env: { ...process.env, ATA_NO_NATIVE: '1' } })
process.stdout.write(r.stdout)
process.stderr.write(r.stderr)
if (r.status !== 0) process.exit(1)
