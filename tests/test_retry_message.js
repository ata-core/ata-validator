'use strict'

// toRetryMessage builds the string that goes back to a model when its
// structured output failed validation. The property under test is not the
// wording, it is that every line carries enough to act on: what was expected
// and what arrived.
//
// This is measured rather than assumed. Feeding the conventional error text
// back, paired so the same failing output went to both arms, one model:
// constraints the model could infer from context recovered 40 of 40 either
// way, and constraints it could not recover 0 of 30 with the conventional text
// against 30 of 30 with the expected values named. So the lines below are held
// to naming the values, not to any particular phrasing.

const assert = require('node:assert')
const { spawnSync } = require('node:child_process')
const { Validator, toRetryMessage } = require('..')

let checks = 0
function ok (name, cond) { assert.strictEqual(cond, true, name); checks++ }

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['status', 'name'],
  properties: {
    status: { enum: ['AWAITING_CLEARANCE', 'PART_SETTLED', 'CLOSED_OUT'] },
    name: { type: 'string' },
    total: { type: 'number', multipleOf: 0.01 },
    tags: { type: 'array', items: { type: 'string' } },
  },
}
const BAD = { status: 'paid in part', total: 1000.005, tags: [1], extra: 1 }

const msg = toRetryMessage(new Validator(SCHEMA).validate(BAD).errors)
const lines = msg.split('\n')

// The case the measurement turned on: an enum whose values cannot be guessed.
const enumLine = lines.find((l) => l.startsWith('/status'))
ok('the enum line names every allowed value',
  ['AWAITING_CLEARANCE', 'PART_SETTLED', 'CLOSED_OUT'].every((v) => enumLine.includes(v)))
ok('the enum line names what arrived', enumLine.includes('paid in part'))

ok('additionalProperties names the property', lines.some((l) => l.includes('extra')))
ok('required names the property', lines.some((l) => /missing required/.test(l) && l.includes('name')))
ok('a numeric failure names the value', lines.some((l) => l.startsWith('/total') && l.includes('1000.005')))
ok('a nested failure carries its path', lines.some((l) => l.startsWith('/tags/0')))

// A prompt pays for every token, so the two obvious wastes are checked.
ok('no line repeats the value twice', lines.every((l) => {
  const m = l.match(/found ("(?:[^"\\]|\\.)*")/)
  return !m || l.split(m[1]).length - 1 === 1
}))
ok('no line carries a container size summary', lines.every((l) => !/\[(object|array)[,\]]/.test(l)))

// Shape and edges.
ok('empty errors give an empty string', toRetryMessage([]) === '')
ok('missing errors give an empty string', toRetryMessage(undefined) === '' && toRetryMessage(null) === '')
{
  const many = Array.from({ length: 30 }, (_, i) => ({ instancePath: '/f' + i, message: 'bad' }))
  const capped = toRetryMessage(many, { limit: 5 }).split('\n')
  ok('limit caps the lines', capped.length === 6)
  ok('the cap says how many were left out', capped[5] === 'and 25 more')
}

// Everything this repo fixed this week was about the two engines agreeing on
// what they report, so the message a model gets must not depend on whether the
// realm allows code generation.
{
  const script = `
    const { Validator, toRetryMessage } = require(${JSON.stringify(require.resolve('..'))})
    const s = ${JSON.stringify(SCHEMA)}
    process.stdout.write(toRetryMessage(new Validator(s).validate(${JSON.stringify(BAD)}).errors))
  `
  const run = (args) => spawnSync(process.execPath, [...args, '-e', script],
    { encoding: 'utf8', env: { ...process.env, ATA_NO_NATIVE: '1' } })
  const normal = run([])
  const blocked = run(['--disallow-code-generation-from-strings'])
  ok('the message is produced with code generation blocked', blocked.status === 0 && blocked.stdout.length > 0)
  ok('the message is identical either way', normal.stdout === blocked.stdout)
}

console.log(`retry message: ${checks} checks passed`)
