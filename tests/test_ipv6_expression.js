'use strict'
// The email check a compiled module carries reads an address literal
// (`a@[IPv6:...]`, `a@[1.2.3.4]`) with two expressions, IPV6_RE in
// lib/email-literal.js and IPV4 in lib/formats.js, where the runtime uses the ipv6() and ipv4() parsers. Held
// here to the same answers: the expressions against the parsers on generated
// near-addresses, and the emitted email check against formats.email() on
// literals built from them.
const assert = require('assert')
const f = { ...require('../lib/formats'), IPV6_RE: require('../lib/email-literal').IPV6_RE }
const { compiledModuleFor } = require('../build')
const fs = require('fs')
const os = require('os')
const path = require('path')

let seed = 0x1b6
const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 }
const hex = '0123456789abcdefABCDEFg'
const v6like = () => {
  const g = 1 + Math.floor(rnd() * 9); const parts = []
  for (let j = 0; j < g; j++) { const L = Math.floor(rnd() * 6); let s = ''; for (let k = 0; k < L; k++) s += hex[Math.floor(rnd() * (rnd() < 0.97 ? 22 : 23))]; parts.push(s) }
  let s = parts.join(':')
  if (rnd() < 0.3) s = s.replace(/:/, '::')
  if (rnd() < 0.2) s += ':' + [0, 0, 0, 0].map(() => Math.floor(rnd() * 300)).join('.')
  if (rnd() < 0.05) s = ':' + s
  if (rnd() < 0.05) s += ':'
  return s
}
const v4like = () => [0, 0, 0, 0].slice(0, 3 + Math.floor(rnd() * 3)).map(() => rnd() < 0.1 ? '0' + Math.floor(rnd() * 99) : String(Math.floor(rnd() * 300))).join('.')
const corners = ['::', '::1', '1::', '1:2:3:4:5:6:7:8', '1:2:3:4:5:6:7::', '::2:3:4:5:6:7:8', '1::8', '::ffff:1.2.3.4', '1:2:3:4:5:6:1.2.3.4', '1::1.2.3.4', '1:2:3:4:5:6:7:1.2.3.4', ':::', '1:::2', '1::2::3', '12345::', 'g::', '::1.2.3', '1:2:3:4:5:6:7:8:9', '0:0:0:0:0:0:0:0', '', '1:2:3:4:5:6:7::8', 'a:b:c:d:e:f:a:b::']

let n = 0
for (let i = 0; i < 400000; i++) {
  const s = v6like(); n++
  assert.strictEqual(f.IPV6_RE.test(s), f.ipv6(s), `IPV6_RE and ipv6() differ on ${JSON.stringify(s)}`)
  const q = v4like()
  assert.strictEqual(f.IPV4.test(q), f.ipv4(q), `IPV4 and ipv4() differ on ${JSON.stringify(q)}`)
}
for (const s of corners) assert.strictEqual(f.IPV6_RE.test(s), f.ipv6(s), `corner ${JSON.stringify(s)}`)

// The emitted email check, against the runtime's, on literals.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-ip6-'))
const file = path.join(dir, 'm.cjs')
fs.writeFileSync(file, compiledModuleFor({ type: 'string', format: 'email' }, { format: 'cjs' }))
const mod = require(file)
let m = 0
for (let i = 0; i < 100000; i++) {
  const lit = rnd() < 0.5 ? `[IPv6:${v6like()}]` : rnd() < 0.5 ? `[${v4like()}]` : `[ipv6:${v6like()}]`
  const addr = `user${i % 7}@${lit}`; m++
  assert.strictEqual(mod.isValid(addr), f.email(addr), `emitted email and formats.email differ on ${JSON.stringify(addr)}`)
}
for (const s of corners) for (const addr of [`a@[IPv6:${s}]`, `a@[${s}]`]) assert.strictEqual(mod.isValid(addr), f.email(addr), addr)
assert.strictEqual(mod.isValid('a@[IPv6:' + '1:'.repeat(400) + '1]'), false)

// A browser's generator checks the literal with the parsers instead
// (lib/email-literal.js maps to nothing there): both forms, on a literal's inside.
const node = new Function('_in', require('../lib/email-literal')() + ';return true')
const browser = new Function('_in', require('../lib/formats-source')._literalByParsers() + ';return true')
for (let i = 0; i < 100000; i++) {
  const inside = rnd() < 0.5 ? `IPv6:${v6like()}` : rnd() < 0.5 ? v4like() : `ipv6:${v6like()}`
  assert.strictEqual(browser(inside), node(inside), `the two literal checks differ on ${JSON.stringify(inside)}`)
}
fs.rmSync(dir, { recursive: true, force: true })
console.log(`ok: IPV6_RE and IPV4 answer as ipv6() and ipv4() on ${n} pairs each; the emitted email check as formats.email on ${m} literals`)
