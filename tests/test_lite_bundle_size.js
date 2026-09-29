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
// emitter embeds, which removed its generated copy from the package.
const BUDGET = 46400

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
