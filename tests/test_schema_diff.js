'use strict'
// `ata diff`: which documents change verdict between two schemas. A
// tightened bound shows up as documents the old schema accepts and the new
// one rejects, grouped by the rule; a dropped requirement as the reverse; the
// same schema twice changes nothing; a project's own sample is reported with
// its file. Then the command's exit status.
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')
const { diffSchemas, renderDiff, breaking } = require('../lib/schema-diff')

const user = { type: 'object', required: ['email', 'name', 'age'], additionalProperties: false, properties: { email: { type: 'string', format: 'email' }, name: { type: 'string', minLength: 1, maxLength: 80 }, age: { type: 'integer', minimum: 13, maximum: 130 }, newsletter: { type: 'boolean', default: false } } }
const older = JSON.parse(JSON.stringify(user)); older.properties.age.minimum = 18

// Tightened: a minimum of 13 becomes 18.
let r = diffSchemas(user, older)
assert.ok(r.documents > 300, `${r.documents} documents`)
assert.ok(breaking(r), 'raising a minimum is breaking')
const rule = r.nowRejected.rules.find((g) => g.rule === 'minimum@/age')
assert.ok(rule, JSON.stringify(r.nowRejected.rules))
assert.ok(rule.count >= 2, 'the bound on either side: 13 and 17 at least')
assert.ok(rule.example.age >= 13 && rule.example.age < 18, JSON.stringify(rule.example))
assert.strictEqual(r.nowAccepted.count, 0, 'nothing is accepted only by the tighter schema')
assert.ok(r.nowRejected.rules.every((g) => g.rule === 'minimum@/age'), 'only that rule bites: ' + r.nowRejected.rules.map((g) => g.rule).join(' '))

// Loosened: the reverse direction.
r = diffSchemas(older, user)
assert.ok(!breaking(r))
assert.ok(r.nowAccepted.rules.some((g) => g.rule === 'minimum@/age'), JSON.stringify(r.nowAccepted.rules))
assert.strictEqual(r.nowRejected.count, 0)

// A dropped requirement, and a dropped property.
const noName = JSON.parse(JSON.stringify(user)); noName.required = ['email', 'age']
r = diffSchemas(user, noName)
assert.ok(!breaking(r) && r.nowAccepted.rules.some((g) => g.rule === 'required@'), JSON.stringify(r.nowAccepted.rules))
const noNewsletter = JSON.parse(JSON.stringify(user)); delete noNewsletter.properties.newsletter
r = diffSchemas(user, noNewsletter)
assert.ok(breaking(r) && r.nowRejected.rules.some((g) => g.rule === 'additionalProperties@'), 'a key that was a property is now additional: ' + JSON.stringify(r.nowRejected.rules))

// The same schema twice.
r = diffSchemas(user, JSON.parse(JSON.stringify(user)))
assert.strictEqual(r.nowRejected.count + r.nowAccepted.count, 0)
assert.ok(renderDiff(r).includes('No document changed verdict.'))

// The project's own samples, reported with their file.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-diff-'))
fs.writeFileSync(path.join(dir, 'teen.json'), JSON.stringify({ email: 'kid@example.com', name: 'Kid', age: 15 }))
fs.writeFileSync(path.join(dir, 'adults.jsonl'), [{ email: 'a@b.co', name: 'A', age: 30 }, { email: 'c@d.co', name: 'C', age: 16 }].map((d) => JSON.stringify(d)).join('\n') + '\n')
r = diffSchemas(user, older, { samples: [dir] })
const text = renderDiff(r, { oldName: 'user.json', newName: 'user-v2.json' })
assert.ok(text.includes('rejected only by user-v2.json'), text)
assert.ok(/teen\.json|adults\.jsonl:2/.test(text), 'the sample that changes verdict names its file:\n' + text)
const asJson = JSON.parse(renderDiff(r, { json: true }))
assert.strictEqual(asJson.nowRejected.count, r.nowRejected.count)

// The command: exit 1 on a breaking change, 0 otherwise, 2 on bad input.
fs.writeFileSync(path.join(dir, 'old.json'), JSON.stringify(user))
fs.writeFileSync(path.join(dir, 'new.json'), JSON.stringify(older))
const cli = path.join(__dirname, '..', 'bin', 'ata.js')
let run = spawnSync(process.execPath, [cli, 'diff', path.join(dir, 'old.json'), path.join(dir, 'new.json'), '--samples', dir], { encoding: 'utf8' })
assert.strictEqual(run.status, 1, run.stdout + run.stderr)
assert.ok(run.stdout.includes('minimum@/age'), run.stdout)
run = spawnSync(process.execPath, [cli, 'diff', path.join(dir, 'new.json'), path.join(dir, 'old.json'), '--json'], { encoding: 'utf8' })
assert.strictEqual(run.status, 0, run.stdout + run.stderr)
assert.ok(JSON.parse(run.stdout).nowAccepted.count > 0)
run = spawnSync(process.execPath, [cli, 'diff', path.join(dir, 'old.json')], { encoding: 'utf8' })
assert.strictEqual(run.status, 2)
fs.rmSync(dir, { recursive: true, force: true })
console.log('ok: ata diff reports the documents a schema change rejects or admits, by rule, with the project samples and the exit status')
