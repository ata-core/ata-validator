'use strict'

// The email format check must not cost several times the hostname check inside it.
//
// `email` is a local part plus a domain, and the domain half is `hostname`, which
// is already a single pass. The local half was not: the function sliced the input
// twice to split it at the '@', ran `indexOf('..')` over the local part, and
// tested every character against a chain of ten comparisons. This file's own
// comment says why that is the wrong shape here, "nine `===` tests per character
// more than doubled the cost of the scan they guarded", which is the lesson the
// other formats already learned.
//
// It showed up as the one place ata loses. On a 1000-user array, `format: email`
// against ajv-formats measured ata 57 microseconds to ajv 37; the same array with
// a plain `minLength` string in place of the format measured ata 3 to ajv 34, and
// with no format at all ata 3 to ajv 8. The whole gap was this one function.
//
// The budget is a ratio to the hostname check on the same domains, so machine
// speed does not matter, and both sides move together if the scan primitives
// change. Measured: 3.45x before, about 2x after, gate between them.

const f = require('../lib/formats.js')

const emails = []
for (let i = 0; i < 2000; i++) emails.push('user' + i + '.name+tag@mail' + (i % 17) + '.example.com')
const domains = emails.map((e) => e.slice(e.lastIndexOf('@') + 1))

// Answers first: a ratio on a broken check means nothing.
const accept = [
  'simple@example.com',
  'very.common@example.com',
  "disposable.style.email.with+symbol@example.com",
  'other.email-with-hyphen@and.subdomains.example.com',
  'user.name+tag@mail3.example.com',
  'x@example.com',
  'admin@mailserver1',
  'user@[192.168.2.1]',
  'user@[IPv6:2001:db8::1]',
  '"quoted local"@example.com',
]
const reject = [
  'Abc.example.com',
  'A@b@c@example.com',
  '.leading@example.com',
  'trailing.@example.com',
  'double..dot@example.com',
  'no-at-sign',
  'spaces in@example.com',
  'user@-leadinghyphen.com',
  'user@trailinghyphen-.com',
  'user@',
  '@example.com',
  'user@[999.1.1.1]',
]
for (const s of accept) {
  if (!f.email(s)) { console.error(`FAIL email format: rejected ${JSON.stringify(s)}`); process.exit(1) }
}
for (const s of reject) {
  if (f.email(s)) { console.error(`FAIL email format: accepted ${JSON.stringify(s)}`); process.exit(1) }
}

const median = (a) => a.sort((x, y) => x - y)[a.length >> 1]
function med (fn, iters) {
  for (let i = 0; i < 50; i++) fn()
  const runs = []
  for (let r = 0; r < 9; r++) {
    const t = process.hrtime.bigint()
    for (let i = 0; i < iters; i++) fn()
    runs.push(Number(process.hrtime.bigint() - t) / iters)
  }
  return median(runs)
}

const N = 2000
const BUDGET = 2.6
require('./_ratio_gate').ratioGate(() => {
  let i = 0
  const emailNs = med(() => f.email(emails[(i++) % N]), N)
  i = 0
  const hostNs = med(() => f.hostname(domains[(i++) % N]), N)
  const ratio = emailNs / hostNs
  const failures = ratio > BUDGET ? [`FAIL email format cost: email is ${ratio.toFixed(2)}x the hostname check it contains (${emailNs.toFixed(0)} ns vs ${hostNs.toFixed(0)} ns), over the ${BUDGET}x budget`] : []
  return { failures, ratio }
}, (r) => `email format cost: ${r.ratio.toFixed(2)}x the hostname check it contains (budget ${BUDGET})`)
