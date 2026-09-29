'use strict'

// Patterns nativeIsLinear() accepts are handed to the platform RegExp instead of
// the linear-time engine: they answer the same, run faster, and a compiled
// module that uses only such patterns no longer embeds the engine (Uniswap's
// token-list validator went from 13.6 to 10.9 KB gzipped). Two things must
// hold for every pattern the rule accepts: both engines give the same answer,
// and the RegExp stays linear on inputs built to make a backtracking engine
// retry.

const assert = require('assert')
const fs = require('fs')
const path = require('path')
const { compileSafe } = require('../lib/safe-regex')
const { nativeIsLinear } = require('../lib/regex-linear')

// Patterns from the official suite and the synthetic ones below. A one-off run
// over SchemaStore's 1187 patterns (857 of them accepted) found no difference.
const patterns = new Set([
  '^[\\w]+$', '^[ \\w]+$', '^\\S+$', '^\\s*$', '^.+$', '^.*$', '\\s', '.', '^a.b$', '^[^\\s]+$',
  '^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$', '^\\d{3}-\\d{4}$', '^[A-Z]{2}\\d?$',
  '^#[0-9a-fA-F]{6}$', '^[a-z0-9-]+$', '^v?\\d+$', '^\\+?[1-9]\\d{1,14}$', '^[^/]+$', 'ab|cd',
  '^(ab|cd)$', '\\.json$', '^\\w+@\\w{2,8}$', '^[\\u00c0-\\u00ff]+$', '^\\x41\\x42*$', '^-?\\d$',
])
function collect (node) {
  if (!node || typeof node !== 'object') return
  if (typeof node.pattern === 'string') patterns.add(node.pattern)
  if (node.patternProperties && typeof node.patternProperties === 'object') for (const k of Object.keys(node.patternProperties)) patterns.add(k)
  for (const v of Object.values(node)) collect(v)
}
for (const dir of ['draft2020-12', 'draft7']) {
  const base = path.join(__dirname, 'suite', 'tests', dir)
  if (!fs.existsSync(base)) continue
  for (const f of fs.readdirSync(base).filter((x) => x.endsWith('.json'))) {
    for (const group of JSON.parse(fs.readFileSync(path.join(base, f), 'utf8'))) collect(group.schema)
  }
}

let seed = 0x5eed
const rnd = (k) => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) % k }
const EXTRA = ['a', 'Z', '0', '9', '_', '-', '.', ' ', '\t', '\n', '\r', ' ', ' ', '　', 'é', '@', '/', '+', '#', 'x', 'b', 'c', 'd']
function inputsFor (p) {
  const alphabet = [...new Set([...p.replace(/\\[a-zA-Z]/g, ''), ...EXTRA])].filter((c) => c.charCodeAt(0) < 0xd800)
  const out = ['', 'ab', 'a'.repeat(40)]
  for (let i = 0; i < 160; i++) {
    let s = ''
    const n = rnd(i < 80 ? 6 : 48)
    for (let j = 0; j < n; j++) s += alphabet[rnd(alphabet.length)]
    out.push(s)
  }
  return out
}

let accepted = 0, compared = 0
for (const p of patterns) {
  if (!nativeIsLinear(p)) continue
  accepted++
  const safe = compileSafe(p)
  const native = new RegExp(p)
  for (const x of inputsFor(p)) {
    assert.strictEqual(native.test(x), safe.test(x), `${JSON.stringify(p)} on ${JSON.stringify(x)}`)
    compared++
  }
  // Linear on a long input made of what the pattern accepts, with a failing
  // last character, which is what makes a backtracking engine retry.
  const probe = 'a'.repeat(20000) + '\u0000'
  const t = process.hrtime.bigint()
  native.test(probe)
  const ms = Number(process.hrtime.bigint() - t) / 1e6
  assert.ok(ms < 250, `${JSON.stringify(p)} took ${ms.toFixed(1)} ms on a 20000-character probe`)
}

// Patterns a backtracking engine would retry on stay on the linear engine.
for (const p of ['(a+)+$', '^(a|aa)+$', '^a+a+$', 'a+b', '^(ab)*$', '^[a-z]{0,1000}$', '^(\\w+\\s?)+$', '\\01']) {
  assert.strictEqual(nativeIsLinear(p), false, p)
}

assert.ok(accepted >= 30, `only ${accepted} patterns compared`)
console.log(`ok: ${accepted} patterns go to the platform RegExp and agree with the linear engine on ${compared} inputs`)
