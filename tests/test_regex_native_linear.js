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
const { compileSafe, parse } = require('../lib/safe-regex')
const { nativeIsLinear } = require('../lib/regex-linear')

// Patterns from the official suite and the synthetic ones below. A one-off run
// over SchemaStore's 1187 patterns (857 of them accepted) found no difference.
const patterns = new Set([
  '^[\\w]+$', '^[ \\w]+$', '^\\S+$', '^\\s*$', '^.+$', '^.*$', '\\s', '.', '^a.b$', '^[^\\s]+$',
  '^(0x[a-fA-F0-9]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})$', '^\\d{3}-\\d{4}$', '^[A-Z]{2}\\d?$',
  '^#[0-9a-fA-F]{6}$', '^[a-z0-9-]+$', '^v?\\d+$', '^\\+?[1-9]\\d{1,14}$', '^[^/]+$', 'ab|cd',
  '^(ab|cd)$', '\\.json$', '^\\w+@\\w{2,8}$', '^[\\u00c0-\\u00ff]+$', '^\\x41\\x42*$', '^-?\\d$',
  // Finite repeats of a group, which the rule accepts when the group holds no
  // unbounded quantifier (a SHA-256 fingerprint, a dotted quad, a tag list).
  '^(?:[A-F0-9]{2}:){31}[A-F0-9]{2}$', '^(?:\\d{1,3}\\.){3}\\d{1,3}$', '^([a-z]{2}-){1,3}[a-z]{2}$', '^(?:(ab)?c){2}$',
  // Accepted by the deterministic rule: unbounded quantifiers over groups
  // where the next character always decides the way on (dotted identifiers,
  // `[^/]+/[^/]+`, version numbers, `(ab)*`).
  '^[^/]+/[^/]+$', '^\\d+(\\.\\d+)*$', '^[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)*$', '^(?:ab)*$', '^(a|b)*c$',
  '^[a-z0-9]+(-[a-z0-9]+)*$', '^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)$', '^\\w+@\\w+\\.\\w+$', '^did:[a-z0-9]+:.+$',
  // Still declined: a loop whose body splits two ways, nesting, and a loop
  // whose first character the continuation shares.
  '^([A-Za-z]{1}[A-Za-z\\d_]*\\.)+[A-Za-z][A-Za-z\\d_]*$', '^(a+)+$', '^(\\w+\\s?)*$',
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

function leaves (p) {
  const out = []
  ;(function walk (n) {
    if (!n || typeof n !== 'object') return
    if (n.t === 'char' || n.t === 'class' || n.t === 'any') out.push(n)
    if (n.child) walk(n.child)
    if (n.parts) n.parts.forEach(walk)
    if (n.opts) n.opts.forEach(walk)
  })(parse(p))
  return out
}
function sampleChar (leaf) {
  if (leaf.t === 'char') return String.fromCharCode(leaf.c)
  if (leaf.t === 'any') return 'a'
  if (!leaf.neg && leaf.ranges[0]) return String.fromCharCode(leaf.ranges[0][0])
  for (let c = 97; c < 123; c++) if (!leaf.ranges.some(([lo, hi]) => c >= lo && c <= hi)) return String.fromCharCode(c)
  return 'a'
}
function probesFor (p) {
  const out = ['a'.repeat(20000) + '\u0000']
  const ls = leaves(p).slice(0, 6).map(sampleChar)
  for (const ch of ls) out.push(ch.repeat(20000) + '\u0000')
  if (ls.length >= 2) {
    out.push((ls[0] + ls[1]).repeat(10000) + '\u0000')
    out.push((ls[0].repeat(50) + ls[1]).repeat(400) + '\u0000')
    out.push((ls[1].repeat(50) + ls[0]).repeat(400) + '\u0000')
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
  // Linear on long inputs made of what the pattern accepts, with a failing
  // last character, which is what makes a backtracking engine retry: a run
  // of one character for each of the pattern's first few leaves, two of them
  // alternating, and a long run broken by the other.
  for (const probe of probesFor(p)) {
    const t = process.hrtime.bigint()
    native.test(probe)
    const ms = Number(process.hrtime.bigint() - t) / 1e6
    assert.ok(ms < 250, `${JSON.stringify(p)} took ${ms.toFixed(1)} ms on a ${probe.length}-character probe`)
  }
}

// Patterns a backtracking engine would retry on stay on the linear engine:
// nested loops, a loop body that splits two ways, a loop the continuation
// shares its characters with, and unanchored loops.
for (const p of ['(a+)+$', '^(a+)+$', '^(a|aa)+$', '^a+a+$', '^a*a*$', 'a+b', '^[a-z]{0,1000}$', '^(\\w+\\s?)+$', '^(\\w+\\s?)*$', '\\01',
  '^(a*)*b$', '^(a?)+$', '^(.*a){10}$', '^[a-z]+[a-z0-9]+$', '^(\\w+\\s?){5}$', '\\w+(,\\w+)*', '^([a-z]+\\.?)+$']) {
  assert.strictEqual(nativeIsLinear(p), false, p)
}
// And the deterministic rule takes what the simple one cannot.
for (const p of ['^[^/]+/[^/]+$', '^\\d+(\\.\\d+)*$', '^(?:ab)*$', '^[A-Za-z_][A-Za-z0-9_]*(\\.[A-Za-z_][A-Za-z0-9_]*)*$', '^(a|b)*c$']) {
  assert.strictEqual(nativeIsLinear(p), true, p)
}

assert.ok(accepted >= 30, `only ${accepted} patterns compared`)
console.log(`ok: ${accepted} patterns go to the platform RegExp and agree with the linear engine on ${compared} inputs`)
