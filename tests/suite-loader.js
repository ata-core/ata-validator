'use strict'

// The official JSON Schema Test Suite, read from its unified layout. This is
// the only file that knows how the suite is laid out on disk; every runner and
// differential test goes through it.
//
// Since json-schema-org/JSON-Schema-Test-Suite e2a68a1 the suite keeps one
// tree, `validation/tests`, for every dialect. A test case names the dialects
// it applies to in `compatibility`, the format behaviour it expects in
// `tags`, and the documents its schema refers to in `externalSchemas`. The
// `remotes` directory is gone, and the same retrieval URI can mean different
// documents in different cases, so a registry is built per case, never once
// for the whole suite.
//
// Anything this file does not understand throws: an unparseable
// `compatibility`, a tag other than the two the suite defines, or a file
// without a `tests` array. A filter that quietly returned false would drop
// cases from every figure without anyone seeing it.

const fs = require('node:fs')
const path = require('node:path')

const ROOT = path.join(__dirname, 'suite', 'validation', 'tests')
const HAVE_SUITE = fs.existsSync(ROOT)

// The suite's release numbers. v1 is not released yet, and the suite marks
// the cases written for it, and for anything specified but unreleased, 9999.
const DIALECTS = {
  draft4: { release: 4, uri: 'http://json-schema.org/draft-04/schema#' },
  draft6: { release: 6, uri: 'http://json-schema.org/draft-06/schema#' },
  draft7: { release: 7, uri: 'http://json-schema.org/draft-07/schema#' },
  'draft2019-09': { release: 2019, uri: 'https://json-schema.org/draft/2019-09/schema' },
  'draft2020-12': { release: 2020, uri: 'https://json-schema.org/draft/2020-12/schema' },
  v1: { release: 9999, uri: 'https://json-schema.org/v1' },
}

const TAGS = new Set(['format-assertion', 'format-annotation'])

function dialectOf (name) {
  const d = DIALECTS[name]
  if (!d) throw new Error(`unknown dialect "${name}" (expected one of: ${Object.keys(DIALECTS).join(', ')})`)
  return d
}

// The algorithm in validation/README.md, early break included: constraints
// are ordered smallest to largest, and the first one at or above the release
// under test decides.
function compatible (compatibility, release) {
  if (compatibility === undefined) return true
  if (typeof compatibility !== 'string') throw new Error(`compatibility is not a string: ${JSON.stringify(compatibility)}`)
  let ok = true
  for (const c of compatibility.split(',')) {
    const m = /^(<=|=)?(\d+)$/.exec(c.trim())
    if (!m) throw new Error(`unparseable compatibility "${compatibility}"`)
    const n = Number(m[2])
    if (m[1] === '=') ok = release === n
    else if (m[1] === '<=') ok = release <= n
    else ok = release >= n
    if (release <= n) break
  }
  return ok
}

// The suite writes schemas without `$schema` and leaves the dialect to the
// runner. External documents need it too: without it a draft-07 remote would
// be read in ata's default dialect, not the one under test. A document that
// declares its own dialect keeps it (optional/cross-draft.json relies on it).
function withDialect (schema, uri) {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return schema
  return '$schema' in schema ? schema : { $schema: uri, ...schema }
}

function readFile (file) {
  const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!doc || !Array.isArray(doc.tests)) throw new Error(`${file}: no tests array`)
  return doc.tests
}

// One test case, ready to run under `dialect`:
//   file, description, tags, tests ({ description, data, valid }),
//   schema           the case's schema with `$schema` for the dialect,
//   externalSchemas  { retrievalUri: schema } with `$schema` inserted, or null.
function prepare (raw, file, uri) {
  const tags = raw.tags || []
  for (const t of tags) if (!TAGS.has(t)) throw new Error(`${file}: unknown tag "${t}" in "${raw.description}"`)
  let ext = null
  if (raw.externalSchemas !== undefined) {
    ext = {}
    for (const [k, s] of Object.entries(raw.externalSchemas)) ext[k] = withDialect(s, uri)
  }
  return {
    file,
    description: raw.description,
    tags,
    schema: withDialect(raw.schema, uri),
    externalSchemas: ext,
    tests: raw.tests,
  }
}

// Which cases to keep, by their format tag:
//   'required'   untagged and format-annotation cases, run with format as an
//                annotation (assertFormat: false). The headline figures.
//   'assertion'  format-assertion cases, run with assertFormat: true.
//   'all'        both.
function keep (c, which) {
  const assertion = c.tags.includes('format-assertion')
  if (which === 'all') return true
  if (which === 'assertion') return assertion
  if (which === 'required') return !assertion
  throw new Error(`unknown selection "${which}"`)
}

// The files of one directory under validation/tests ('' for the top level,
// 'optional', 'proposals/propertyDependencies'), each with the cases that
// apply to `dialect`. Files with no applicable case are left out.
//   [{ file, cases: [case, ...] }, ...]
function files (dialect, { dir = '', which = 'required', only = null } = {}) {
  const { release, uri } = dialectOf(dialect)
  const at = path.join(ROOT, dir)
  const out = []
  for (const name of fs.readdirSync(at).filter((f) => f.endsWith('.json')).sort()) {
    if (only && !only(name)) continue
    const file = dir ? `${dir}/${name}` : name
    const cases = []
    for (const raw of readFile(path.join(at, name))) {
      if (!compatible(raw.compatibility, release)) continue
      const c = prepare(raw, file, uri)
      if (keep(c, which)) cases.push(c)
    }
    if (cases.length) out.push({ file, cases })
  }
  return out
}

// Every case for `dialect` in one directory, flattened.
function cases (dialect, opts) {
  return files(dialect, opts).flatMap((f) => f.cases)
}

// The format-assertion cases for one format, which the old layout kept in
// optional/format/<name>.json. The unified suite names the file
// format-<name>.json at the top level.
function formatCases (dialect, name) {
  const file = `format-${name}.json`
  if (!fs.existsSync(path.join(ROOT, file))) throw new Error(`no ${file} in the suite`)
  return cases(dialect, { which: 'assertion', only: (f) => f === file })
}

// A case's external documents as a fresh object, for `schemas:`. Each call
// returns a new one, so nothing registered for one case reaches another.
function registry (c) {
  return c.externalSchemas ? { ...c.externalSchemas } : {}
}

// The same as a Map, for the entry points that take one.
function registryMap (c) {
  return new Map(Object.entries(registry(c)))
}

module.exports = {
  ROOT,
  HAVE_SUITE,
  DIALECTS,
  compatible,
  files,
  cases,
  formatCases,
  registry,
  registryMap,
}
