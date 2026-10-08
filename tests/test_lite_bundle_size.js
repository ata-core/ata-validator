'use strict'

// What ata-validator/lite costs a browser page: the entry bundled the way a
// page bundler does it (browser platform, minified, ESM) and gzipped. The
// budget is the measured size plus a little room, so growth shows up here
// rather than on someone's page. The bundle must also leave out every module
// that generates source, since that is what lite is for.

const assert = require('assert')
const path = require('path')
const zlib = require('zlib')
const esbuild = require('esbuild')

// bytes gzipped by zlib level 9. Measured 45009 on 2026-09-28 at 1.35.0, 45863 at
// 1.36.1, and 46034 once `~standard.jsonSchema` (Standard JSON Schema) was added.
// 46317 once the regex engine became one function whose text the standalone
// emitter embeds, which removed its generated copy from the package. 46520
// once branch errors were ordered and shaped the same whichever engine answers,
// 46826 once a rejection read its errors in one layer instead of three, and
// 47059 once `verbose` moved into the core: lite, which is the interpreted
// engine only, ignored the option before. 47159 on CI (47138 here) once
// normalization decodes percent-encoded `$ref` fragments, which the interpreter
// in lite resolved already but the other engines did not. 47457 once reading
// errors got faster: shared error literals are marked rather than found with
// Object.isFrozen, enrichment keeps the fields fixed per literal, and a
// validator whose errors are read switches to one-pass validation. Lite gains
// little of that itself; the markers on its own shared errors are needed for
// the copy they get.
// 47591 with the wiring for errors built enriched in generated code (41
// bytes); the generated-code half lives in lib/enrich-site.js, which lite
// does not reach.
// 47697 with the read-path dispatch (which builder serves a validator's
// errors, and the switch to a generated validate()), which sits in the core
// both builds share.
// 47837 once the switch to one-pass validation after errors are read joined
// that dispatch; the one-pass function itself is built in index.js.
// 47881 with the interpreter's resolver exported for compile-time reference
// resolution (normalizeRefs), which lite carries because it carries the
// interpreter.
// 47904 with `_ataRaw()` handing out the plain shape (no ordering key).
// 47984 with the multi-match oneOf error as a function of its own
// (`__ataMulti`), which generated code builds from a branch count instead of
// running the branches; lite carries it because it carries the collapse.
// 48090 with the compile and preprocess caches bounded (_boundedSet in
// lib/validator-core.js): unbounded, they kept 1.2 GB after compiling each
// SchemaStore schema once. 48200 because the same tree measures 48090 bytes
// on an Apple M4 Pro and 48109 on the CI runners (Node 20 and 22), and the
// budget is for weight added, not for the toolchain's rounding.
// 48300 with validateJSON handing the document it parsed to its rejection,
// so reading the errors does not parse the text again.
// 48400 with the banded edit distance, which made reading the errors of
// SchemaStore's negative samples 8% cheaper where typo hints run.
// 48500 with validateJSON errors in validate()'s order without enrichment, and
// draft-07 dependencies on a property named "__proto__" kept (a silent accept).
// 48800 with enum membership and uniqueItems by Set and Map in the interpreted
// engine, which is lite's engine: SchemaStore's valid samples check 36% faster.
// 49200 with uniqueItems through a structural hash shared with generated code
// (lib/unique-items.js), in place of a canonical string per item.
// 49400 with the interpreter asking a leaf child for its verdict before
// building the paths for its errors: tsconfig's samples collect 42% faster.
// 49500 with the environment reads and the one `new Function` site behind
// two small modules (lib/env.js, lib/compile-fn.js): 28 bytes.
const BUDGET = 49500

const result = esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'lite.mjs')],
  bundle: true,
  minify: true,
  platform: 'browser',
  format: 'esm',
  write: false,
  metafile: true,
  logLevel: 'error',
})

const inputs = Object.keys(result.metafile.inputs)
const generators = inputs.filter((f) => /lib\/(js-compiler|codegen-[a-z-]+|scan-compiler|clone-emit|aot|ts-gen|render-[a-z]+|output-format)\.js$/.test(f))
assert.deepStrictEqual(generators, [], 'the lite bundle carries modules it should not: ' + generators.join(', '))

const size = zlib.gzipSync(result.outputFiles[0].contents, { level: 9 }).length
assert.ok(size <= BUDGET, `ata-validator/lite is ${size} bytes gzipped, over its ${BUDGET} byte budget`)
console.log(`ok: ata-validator/lite bundles to ${size} bytes gzipped (budget ${BUDGET}), no code generator in it`)
