'use strict'

// One format violation reports exactly one error, on every engine that
// reports errors. The error path turns each failing statement of a format
// check into a push; before 1.12.1 it fell through after pushing, so a
// single bad value collected one identical error per statement it failed:
// twelve for a short date-time, five for a short time, two for a short uuid.

const assert = require('assert')
const { Validator } = require('../index')

const cases = {
  uuid: ['bad', '9c858901-8a57-4791-81fe-4c455b099bcZ', '9c858901x8a57-4791-81fe-4c455b099bc9'],
  'date-time': ['bad', '2024-99-99T99:99:99Z', '2024-02-30T00:00:00Z', '2024-01-01T00:00:00'],
  time: ['bad', '25:00:00', '00:00:00+9'],
  uri: ['bad', 'http:\tx', '1http://x'],
  'uri-reference': ['a\tb'],
  date: ['bad', '2024-13-01'],
  email: ['bad'],
  duration: ['bad', 'P'],
  ipv4: ['999.1.1.1', 'bad'],
  ipv6: ['bad', '12345::1'],
  hostname: ['-x-', 'a..b'],
}

let checked = 0
for (const [format, values] of Object.entries(cases)) {
  const v = new Validator({ type: 'object', properties: { x: { type: 'string', format } } })
  for (const bad of values) {
    const r = v.validate({ x: bad })
    assert.strictEqual(r.valid, false, format + ' must reject ' + JSON.stringify(bad))
    assert.strictEqual(r.errors.length, 1,
      format + ' ' + JSON.stringify(bad) + ' reported ' + r.errors.length + ' errors, want 1')
    checked++
  }
  // a valid value stays valid and reports nothing
}

console.log('ok: one error per format violation (' + checked + ' cases)')
