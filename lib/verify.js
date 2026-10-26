'use strict'
// `ata verify`: the proof that a compiled module answers as the runtime
// Validator does, run against a project's own schemas. For every schema the
// module written by `ata build` is loaded, documents are made from the schema
// (valid ones, and ones with one rule broken) and read from the project's
// samples, and both the module and a Validator built from the schema at
// verification time answer each one; the verdicts and the error lists have to
// agree. The module's schema hash is checked against the schema as it is now,
// so a module built from an older schema is reported stale.
//
// A validator that wrongly rejects gets a bug report; one that wrongly accepts
// does not. This command exists so a build-time module gets checked in CI the
// way the engine is checked here, on every change.

const fs = require('fs')
const path = require('path')
const { pathToFileURL } = require('url')

// A small deterministic generator (xorshift32), so a run can be repeated.
function rng (seed) {
  let x = (seed >>> 0) || 0x9e3779b9
  const next = () => { x ^= x << 13; x ^= x >>> 17; x ^= x << 5; return (x >>> 0) / 4294967296 }
  return { next, int: (n) => Math.floor(next() * n), pick: (a) => a[Math.floor(next() * a.length)], chance: (p) => next() < p }
}

const WORDS = ['ada', 'Zoë', 'order', 'x', 'north-west', 'a b', 'ÄÖÜ', 'sku-1001', 'TENOFF', 'hello world', '', '0', 'null', '😀', 'line\nbreak', '  ']
// Strings tried against a `pattern` the generator cannot read: the common
// shapes of identifiers, codes, addresses, dates and numbers.
const PATTERN_CANDIDATES = [
  'a', 'ab', 'abc', 'abc-123', 'ABC', 'A1', 'x_y', 'hello', 'Hello World', 'sku-1001', 'SKU-1001', 'TENOFF',
  'zoe@example.com', 'a@b.co', 'user.name+tag@example.org', '2026-10-25', '2026-10-25T10:00:00Z', '10:00:00',
  '0', '1', '42', '-7', '3.14', '1e3', '0001', '+905551112233', '555-1234', '#fff', '#a1b2c3',
  'https://example.com/path', 'http://x.io', 'example.com', '/a/b/c', 'v1.2.3', '1.2.3', 'en-US', 'TR',
  '123e4567-e89b-12d3-a456-426614174000', '192.168.0.1', '::1', 'true', 'null', 'aaaaaaaaaaaaaaaa', 'ÄÖÜ', 'çş'
]
const FORMAT_EXAMPLES = {
  email: ['zoe@example.com', 'a@b.co', 'not an email', 'x@', '@y.com'],
  'date-time': ['2026-10-25T10:00:00Z', '2026-10-25T10:00:00+03:00', '2026-10-25 10:00', 'yesterday'],
  date: ['2026-10-25', '2026-13-01', '2026-2-5'],
  time: ['10:00:00Z', '25:00:00Z', '10:00'],
  uuid: ['123e4567-e89b-12d3-a456-426614174000', '123e4567-e89b-12d3-a456', 'not-a-uuid'],
  uri: ['https://example.com/a?b=1', 'example.com', '/relative', 'mailto:a@b.co'],
  'uri-reference': ['https://example.com', '/path', '#frag', ' spaced'],
  ipv4: ['192.168.0.1', '256.1.1.1', '1.2.3'],
  ipv6: ['::1', '2001:db8::1', '2001:db8:::1', '1.2.3.4'],
  hostname: ['example.com', 'a-b.c', '-bad.com', 'x'.repeat(70)],
  regex: ['^a+$', '([', '\\d+'],
  'json-pointer': ['/a/b', 'a/b', '/a~1b', '/a~2'],
}

// A value meant to satisfy `schema`, built from its keywords; where the
// schema says little, something plausible of the kind.
function makeValid (schema, r, defs, depth) {
  if (schema === true || schema === undefined) return r.pick([1, 'x', true, null, {}, []])
  if (schema === false) return undefined
  if (typeof schema !== 'object' || schema === null) return null
  if (schema.$ref !== undefined && typeof schema.$ref === 'string') {
    const t = resolveLocal(schema.$ref, defs)
    if (t !== undefined && depth < 6) return makeValid(t, r, defs, depth + 1)
  }
  if (schema.const !== undefined) return clone(schema.const)
  if (Array.isArray(schema.enum) && schema.enum.length) return clone(r.pick(schema.enum))
  if (Array.isArray(schema.oneOf) && schema.oneOf.length) return makeValid(r.pick(schema.oneOf), r, defs, depth + 1)
  if (Array.isArray(schema.anyOf) && schema.anyOf.length) return makeValid(r.pick(schema.anyOf), r, defs, depth + 1)
  if (Array.isArray(schema.allOf) && schema.allOf.length) return makeValid(mergeAllOf(schema), r, defs, depth + 1)
  let type = schema.type
  if (Array.isArray(type)) type = r.pick(type)
  if (type === undefined) {
    if (schema.properties || schema.required || schema.additionalProperties !== undefined) type = 'object'
    else if (schema.items || schema.prefixItems || schema.minItems !== undefined) type = 'array'
    else if (schema.minLength !== undefined || schema.maxLength !== undefined || schema.pattern !== undefined || schema.format !== undefined) type = 'string'
    else if (schema.minimum !== undefined || schema.maximum !== undefined || schema.multipleOf !== undefined) type = 'number'
    else type = r.pick(['string', 'number', 'object', 'array', 'boolean', 'null'])
  }
  switch (type) {
    case 'null': return null
    case 'boolean': return r.chance(0.5)
    case 'integer':
    case 'number': {
      let lo = schema.minimum !== undefined ? schema.minimum : schema.exclusiveMinimum !== undefined && typeof schema.exclusiveMinimum === 'number' ? schema.exclusiveMinimum + 1 : -1000
      let hi = schema.maximum !== undefined ? schema.maximum : schema.exclusiveMaximum !== undefined && typeof schema.exclusiveMaximum === 'number' ? schema.exclusiveMaximum - 1 : 1000
      if (hi < lo) hi = lo
      let v = lo + r.next() * (hi - lo)
      if (type === 'integer' || r.chance(0.6)) v = Math.round(v)
      if (typeof schema.multipleOf === 'number' && schema.multipleOf > 0) v = Math.round(v / schema.multipleOf) * schema.multipleOf
      if (v < lo) v = lo
      if (v > hi) v = hi
      return v
    }
    case 'string': {
      if (schema.format && FORMAT_EXAMPLES[schema.format]) return r.pick(FORMAT_EXAMPLES[schema.format])
      const min = schema.minLength || 0
      const max = schema.maxLength !== undefined ? schema.maxLength : Math.max(min, 12)
      if (schema.pattern) {
        const simple = /^\^?\[([a-zA-Z0-9-]+)\]([+*])?\$?$/.exec(schema.pattern)
        if (simple) {
          const set = simple[1].includes('a-z') ? 'abcdefgh' : simple[1].includes('0-9') ? '0123456789' : simple[1].includes('A-Z') ? 'ABCDEFGH' : simple[1].replace(/-/g, '')
          let s = ''
          const n = Math.max(min, Math.min(max, 1 + r.int(8)))
          for (let i = 0; i < n; i++) s += set[r.int(set.length)]
          return s
        }
        // Any other pattern: a candidate that matches, when one does, so the
        // generated documents reach past the pattern; else a word, which the
        // schema then refuses, and that is a document too.
        let re = null
        try { re = new RegExp(schema.pattern, 'u') } catch {}
        if (re) {
          const matching = PATTERN_CANDIDATES.filter((c) => re.test(c) && [...c].length >= min && [...c].length <= max)
          if (matching.length) return r.pick(matching)
        }
      }
      let s = r.pick(WORDS)
      while ([...s].length < min) s += 'a'
      if ([...s].length > max) s = [...s].slice(0, max).join('')
      return s
    }
    case 'array': {
      const min = schema.minItems || 0
      const max = schema.maxItems !== undefined ? schema.maxItems : Math.max(min, 4)
      const n = depth > 4 ? min : min + r.int(Math.max(1, max - min + 1))
      const out = []
      for (let i = 0; i < n; i++) {
        const sub = Array.isArray(schema.prefixItems) && i < schema.prefixItems.length ? schema.prefixItems[i] : Array.isArray(schema.items) ? (schema.items[i] !== undefined ? schema.items[i] : schema.additionalItems) : schema.items
        if (sub === false) break
        out.push(makeValid(sub === undefined ? true : sub, r, defs, depth + 1))
      }
      if (schema.uniqueItems) return out.filter((v, i, a) => a.findIndex((w) => JSON.stringify(w) === JSON.stringify(v)) === i)
      return out
    }
    case 'object':
    default: {
      const out = {}
      const props = schema.properties && typeof schema.properties === 'object' ? schema.properties : {}
      const required = new Set(Array.isArray(schema.required) ? schema.required : [])
      for (const k of Object.keys(props)) {
        if (k === '__proto__') continue
        if (required.has(k) || r.chance(0.7)) out[k] = makeValid(props[k], r, defs, depth + 1)
      }
      for (const k of required) if (!(k in out) && k !== '__proto__') out[k] = makeValid(props[k] === undefined ? true : props[k], r, defs, depth + 1)
      if (schema.additionalProperties !== false && !schema.patternProperties && r.chance(0.2) && depth < 4) out[`extra${r.int(3)}`] = makeValid(typeof schema.additionalProperties === 'object' ? schema.additionalProperties : true, r, defs, depth + 1)
      if (schema.patternProperties && r.chance(0.5)) {
        for (const [p, sub] of Object.entries(schema.patternProperties)) {
          const m = /^\^?([a-zA-Z_]+)/.exec(p)
          if (m) out[m[1] + r.int(9)] = makeValid(sub, r, defs, depth + 1)
        }
      }
      return out
    }
  }
}

function mergeAllOf (schema) {
  const merged = {}
  for (const b of schema.allOf) if (typeof b === 'object' && b !== null) Object.assign(merged, b, { properties: { ...(merged.properties || {}), ...(b.properties || {}) }, required: [...(merged.required || []), ...(b.required || [])] })
  for (const k of Object.keys(schema)) if (k !== 'allOf' && merged[k] === undefined) merged[k] = schema[k]
  return merged
}

function resolveLocal (ref, defs) {
  const m = /^#\/(\$defs|definitions)\/([^/]+)$/.exec(ref)
  if (!m || !defs[m[1]]) return undefined
  const key = decodeURIComponent(m[2].replace(/~1/g, '/').replace(/~0/g, '~'))
  return Object.prototype.hasOwnProperty.call(defs[m[1]], key) ? defs[m[1]][key] : undefined
}

function clone (v) { return v === undefined ? v : JSON.parse(JSON.stringify(v)) }

// One rule broken somewhere in `doc`: a kind swapped, a key dropped or added,
// a number pushed out of range, a string lengthened or emptied, an array
// emptied or an element duplicated. The point is a document the schema is
// likely to refuse, so both engines get to disagree on refusals too.
function mutate (doc, r) {
  const paths = []
  const walk = (v, p) => {
    paths.push(p)
    if (Array.isArray(v)) v.forEach((x, i) => walk(x, [...p, i]))
    else if (v && typeof v === 'object') for (const k of Object.keys(v)) walk(v[k], [...p, k])
  }
  walk(doc, [])
  const p = r.pick(paths)
  const get = (o, q) => q.reduce((a, k) => (a == null ? a : a[k]), o)
  const set = (o, q, val) => { if (q.length === 0) return val; const parent = get(o, q.slice(0, -1)); if (parent != null) parent[q[q.length - 1]] = val; return o }
  const del = (o, q) => { const parent = get(o, q.slice(0, -1)); if (Array.isArray(parent)) parent.splice(q[q.length - 1], 1); else if (parent) delete parent[q[q.length - 1]]; return o }
  const v = get(doc, p)
  switch (r.int(8)) {
    case 0: return set(doc, p, r.pick([null, true, 'str', 0, [], {}]))
    case 1: return p.length ? del(doc, p) : set(doc, p, null)
    case 2: if (v && typeof v === 'object' && !Array.isArray(v)) { v[`unexpected${r.int(5)}`] = r.pick([1, 'x', null]); return doc } return set(doc, p, 'unexpected')
    case 3: return set(doc, p, typeof v === 'number' ? r.pick([v * 1000 + 1, -v - 1, v + 0.5, Number.MAX_SAFE_INTEGER, -1]) : -1)
    case 4: return set(doc, p, typeof v === 'string' ? r.pick(['', v.repeat(40), v + ' ', '😀' + v, v.toUpperCase()]) : '')
    case 5: if (Array.isArray(v)) { if (v.length && r.chance(0.5)) v.push(clone(v[0])); else v.length = 0; return doc } return set(doc, p, [])
    case 6: return set(doc, p, typeof v === 'boolean' ? !v : typeof v === 'number' ? String(v) : typeof v === 'string' ? Number(v) || 7 : v)
    default: return JSON.parse(JSON.stringify(doc).replace(/"([a-zA-Z]+)":/, '"$1_":'))
  }
}

// The values on either side of each bound the schema states, for the value
// at one place: a module that wrote a bound off by one (`< 12` for a minimum
// of 13) answers every random document as the runtime does, and differs only
// here. A bound is where a hand edit, a stale module or a generator bug shows.
function boundaryValues (schema, type) {
  const out = []
  const int = type === 'integer'
  const step = int ? 1 : 0.5
  const num = (b) => typeof b === 'number' && Number.isFinite(b)
  if (type === 'integer' || type === 'number') {
    if (num(schema.minimum)) out.push(schema.minimum, schema.minimum - step)
    if (num(schema.maximum)) out.push(schema.maximum, schema.maximum + step)
    if (num(schema.exclusiveMinimum)) out.push(schema.exclusiveMinimum, schema.exclusiveMinimum + step)
    if (num(schema.exclusiveMaximum)) out.push(schema.exclusiveMaximum, schema.exclusiveMaximum - step)
    if (num(schema.multipleOf) && schema.multipleOf > 0) out.push(schema.multipleOf, schema.multipleOf * 1.5)
  }
  if (type === 'string') {
    const str = (n) => 'abcdefghij'.repeat(Math.ceil(n / 10) + 1).slice(0, n)
    if (num(schema.minLength)) { out.push(str(schema.minLength)); if (schema.minLength > 0) out.push(str(schema.minLength - 1)) }
    if (num(schema.maxLength) && schema.maxLength < 4096) out.push(str(schema.maxLength), str(schema.maxLength + 1))
  }
  return out
}

// Documents that differ from a valid one at a single place, by a value on
// either side of a bound stated there: properties, nested objects, the first
// element of an array, through local references. At most `limit` of them.
function boundaryDocs (schema, r, defs, limit, accepts) {
  // A base the runtime accepts, where the caller can say, so that a bound
  // read wrong changes the verdict and not only the error list.
  let base = makeValid(schema, r, defs, 0)
  if (accepts) for (let i = 0; i < 50 && base !== undefined && !accepts(base); i++) base = makeValid(schema, r, defs, 0)
  if (base === undefined) return []
  const out = []
  const visit = (sub, path, depth) => {
    if (out.length >= limit || depth > 8 || !sub || typeof sub !== 'object') return
    if (typeof sub.$ref === 'string') { const t = resolveLocal(sub.$ref, defs); if (t !== undefined) visit(t, path, depth + 1); return }
    if (Array.isArray(sub.allOf)) { visit(mergeAllOf(sub), path, depth + 1); return }
    const types = Array.isArray(sub.type) ? sub.type : sub.type !== undefined ? [sub.type] : []
    for (const t of types.length ? types : ['integer', 'number', 'string']) {
      for (const val of boundaryValues(sub, t)) {
        if (out.length >= limit) return
        const d = clone(base)
        if (path.length === 0) { out.push(val); continue }
        let o = d
        for (let i = 0; i < path.length - 1; i++) {
          if (o[path[i]] === undefined || o[path[i]] === null || typeof o[path[i]] !== 'object') o[path[i]] = typeof path[i + 1] === 'number' ? [] : {}
          o = o[path[i]]
        }
        o[path[path.length - 1]] = val
        out.push(d)
      }
    }
    if (sub.properties && typeof sub.properties === 'object') {
      for (const k of Object.keys(sub.properties)) if (k !== '__proto__') visit(sub.properties[k], [...path, k], depth + 1)
    }
    const item = Array.isArray(sub.prefixItems) ? sub.prefixItems[0] : sub.items && typeof sub.items === 'object' && !Array.isArray(sub.items) ? sub.items : null
    if (item) visit(item, [...path, 0], depth + 1)
  }
  visit(schema, [], 0)
  return out
}

// Documents for `schema`: `count` made, half of them with one rule broken,
// then the documents on either side of each bound (up to `count` more).
function generate (schema, count, seed, accepts) {
  const r = rng(seed)
  const defs = { $defs: schema && schema.$defs, definitions: schema && schema.definitions }
  const docs = []
  for (let i = 0; i < count; i++) {
    let d = makeValid(schema, r, defs, 0)
    if (i % 2 === 1 && d !== undefined) d = mutate(clone(d), r)
    docs.push(d)
  }
  for (const d of boundaryDocs(schema, r, defs, count, accepts)) docs.push(d)
  return docs
}

// The project's own documents: a JSON file is one document, a JSON Lines
// file one per line, a JSON array is taken as one document, not several.
function readSamples (paths) {
  const docs = []
  const files = []
  for (const p of paths) {
    if (!fs.existsSync(p)) continue
    if (fs.statSync(p).isDirectory()) {
      for (const f of fs.readdirSync(p).sort()) if (/\.(json|jsonl|ndjson)$/.test(f)) files.push(path.join(p, f))
    } else files.push(p)
  }
  for (const f of files) {
    const text = fs.readFileSync(f, 'utf8')
    if (/\.(jsonl|ndjson)$/.test(f)) {
      text.split('\n').forEach((line, i) => { if (line.trim()) { try { docs.push({ source: `${f}:${i + 1}`, doc: JSON.parse(line) }) } catch {} } })
    } else {
      try { docs.push({ source: f, doc: JSON.parse(text) }) } catch { docs.push({ source: f, doc: undefined, bad: true }) }
    }
  }
  return docs
}

function errorKey (e) { return `${e.keyword || ''}@${e.instancePath || ''}` }
function summarize (result) {
  if (!result || typeof result !== 'object') return 'no result'
  const errs = Array.isArray(result.errors) ? result.errors.map(errorKey).sort() : []
  return `${result.valid ? 'valid' : 'invalid'} ${errs.join(' ')}`
}

async function loadModule (file) {
  if (/\.cjs$/.test(file)) { delete require.cache[require.resolve(file)]; return require(file) }
  return import(pathToFileURL(file).href + `?t=${Date.now()}`)
}

// Verifies one schema against its module. Returns a report object.
async function verifyOne ({ schemaFile, moduleFile, schema, generate: count = 200, seed = 1, samples = [] }) {
  const { Validator } = require('..')
  const { schemaHash } = require('./schema-hash')
  const report = { schema: schemaFile, module: moduleFile, documents: 0, generated: 0, samples: 0, valid: 0, agree: 0, disagreements: [], stale: false, missing: false, ataVersion: null, error: null }
  if (!fs.existsSync(moduleFile)) { report.missing = true; return report }
  let mod
  try { mod = await loadModule(moduleFile) } catch (e) { report.error = `module does not load: ${e.message}`; return report }
  if (typeof mod.isValid !== 'function' || typeof mod.validate !== 'function') { report.error = 'module exports no isValid and validate'; return report }
  report.ataVersion = mod.ataVersion || null
  const hash = schemaHash(schema)
  if (mod.schemaHash !== undefined && mod.schemaHash !== hash) report.stale = true
  let runtime
  try { runtime = new Validator(schema, {}) } catch (e) { report.error = `schema does not compile: ${e.message}`; return report }
  const docs = generate(schema, count, seed, (d) => { try { return runtime.isValidObject(clone(d)) } catch { return false } }).map((d, i) => ({ source: `generated #${i + 1}`, doc: d }))
  report.generated = docs.length
  const sampleDocs = readSamples(samples)
  report.samples = sampleDocs.length
  for (const { source, doc, bad } of [...docs, ...sampleDocs]) {
    if (bad || doc === undefined) continue
    report.documents++
    const text = JSON.stringify(doc)
    const a = runtime.validate(JSON.parse(text))
    const b = mod.validate(JSON.parse(text))
    const aIs = runtime.isValidObject(JSON.parse(text))
    const bIs = mod.isValid(JSON.parse(text))
    if (a.valid) report.valid++
    const sa = summarize(a), sb = summarize(b)
    if (sa === sb && aIs === bIs && aIs === a.valid) { report.agree++; continue }
    if (report.disagreements.length < 20) report.disagreements.push({ source, document: text.length > 400 ? text.slice(0, 400) + '…' : text, runtime: sa, module: sb, runtimeIsValid: aIs, moduleIsValid: bIs })
    else report.disagreements.push(null)
  }
  report.disagreements = report.disagreements.filter(Boolean).concat(report.documents - report.agree > 20 ? [{ more: report.documents - report.agree - 20 }] : [])
  return report
}

function renderReport (reports, { json = false } = {}) {
  if (json) return JSON.stringify({ ok: reports.every(ok), schemas: reports }, null, 2)
  const lines = []
  for (const r of reports) {
    const name = path.relative(process.cwd(), r.schema) || r.schema
    if (r.missing) { lines.push(`${name}: no module at ${path.relative(process.cwd(), r.module)}; run ata build first`); continue }
    if (r.error) { lines.push(`${name}: ${r.error}`); continue }
    const dis = r.documents - r.agree
    lines.push(`${name}: ${r.documents} documents (${r.generated} generated, ${r.samples} from samples), ${r.valid} valid by the runtime, ${r.agree} agree, ${dis} disagree${r.stale ? '; STALE: the module was built from a different schema' : ''}${r.ataVersion ? ` (module from ata ${r.ataVersion})` : ''}`)
    for (const d of r.disagreements) {
      if (d.more) { lines.push(`    ... and ${d.more} more`); continue }
      lines.push(`    ${d.source}`)
      lines.push(`      document ${d.document}`)
      lines.push(`      runtime  ${d.runtime}${d.runtimeIsValid !== (d.runtime.startsWith('valid')) ? ` (isValidObject ${d.runtimeIsValid})` : ''}`)
      lines.push(`      module   ${d.module}${d.moduleIsValid !== (d.module.startsWith('valid')) ? ` (isValid ${d.moduleIsValid})` : ''}`)
    }
  }
  const bad = reports.filter((r) => !ok(r))
  lines.push(bad.length === 0
    ? `ata verify: ${reports.length} schema${reports.length === 1 ? '' : 's'}, every module answers as the runtime does`
    : `ata verify: ${bad.length} of ${reports.length} schema${reports.length === 1 ? '' : 's'} failed`)
  return lines.join('\n')
}

function ok (r) { return !r.missing && !r.error && !r.stale && r.documents === r.agree }

// A module given as source text (a plugin's inlined module) held against the
// runtime the same way: written to a temporary file, loaded, verified.
async function verifySource (schema, src, opts = {}) {
  const os = require('os')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-verify-src-'))
  const file = path.join(dir, `m.${opts.format === 'cjs' ? 'cjs' : 'mjs'}`)
  fs.writeFileSync(file, src)
  try {
    return await verifyOne({ schemaFile: opts.name || 'schema', moduleFile: file, schema, generate: opts.generate, seed: opts.seed, samples: opts.samples || [] })
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
}

module.exports = { verifyOne, verifySource, renderReport, generate, mutate, readSamples, ok }
