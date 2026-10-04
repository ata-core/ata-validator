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
const BUDGET = 47650

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
