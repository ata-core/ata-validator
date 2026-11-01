'use strict'

// A module that only declares its schemas imports `defineSchema` and nothing
// else. `defineSchema` returns its argument, so such a module must not carry
// the validator into a bundle. Until 1.62.2 every ES entry took it from the
// CommonJS core, and a bundler cannot see that a property of that object is
// pure: a form whose `new Validator(...)` the build plugin had compiled away
// still shipped the whole runtime through the `defineSchema(...)` line
// beside it, 54 KB gzipped plus the lazy code generator.
//
// Each entry a bundler can resolve `ata-validator` to is bundled here with
// esbuild and must stay small.

const esbuild = require('esbuild')
const path = require('path')

const root = path.join(__dirname, '..')

// index.mjs and lite.mjs are left out on purpose: Node before 22.10 and Deno
// load them at run time (bundlers match module, browser or workerd first), so
// they are written for load time. An extra module import in index.mjs cost
// Fastify's ten-route boot 0.15 ms, and lite.mjs reading the core directly
// made Node run its CommonJS lexer over the whole core: 5.3 to 8.1 ms.
const ENTRIES = [
  ['browser', 'index.browser.mjs'],
  ['workerd', 'index.edge.mjs'],
  ['module', 'index.bundle.mjs'],
]

// The helpers and the module they come from are a few hundred bytes. The
// smallest validator core is tens of kilobytes, so the limit separates the two
// without tracking exact sizes.
const LIMIT = 2048

const SOURCES = {
  'declared and exported': "import { defineSchema } from 'ata-validator'\nexport const User = defineSchema({ type: 'object', properties: { id: { type: 'integer' } } })\n",
  'declared and unused': "import { defineSchema } from 'ata-validator'\nconst User = defineSchema({ type: 'string' })\n",
  'declared and read': "import { defineSchema } from 'ata-validator'\nconst User = defineSchema({ type: 'string' })\nconsole.log(User.type)\n",
}

let failed = 0
const check = (cond, msg) => {
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${msg}`)
  if (!cond) failed++
}

for (const [label, file] of ENTRIES) {
  for (const [shape, contents] of Object.entries(SOURCES)) {
    const out = esbuild.buildSync({
      stdin: { contents, resolveDir: root, loader: 'js' },
      bundle: true,
      minify: true,
      format: 'esm',
      platform: 'browser',
      write: false,
      logLevel: 'silent',
      external: ['fs', 'path', 'node:*', 'pkg-prebuilds', 'yaml'],
      alias: { 'ata-validator': path.join(root, file) },
    }).outputFiles[0].text
    check(out.length < LIMIT, `${label} (${file}), ${shape}: ${out.length} bytes, under ${LIMIT}`)
  }
}

// The function every entry hands out is the same, and it still returns its
// argument.
const cjs = require(path.join(root, 'index.js'))
const schema = { type: 'string' }
check(cjs.defineSchema(schema) === schema, 'index.js defineSchema returns its argument')
check(require(path.join(root, 'lite.js')).defineSchema(schema) === schema, 'lite.js defineSchema returns its argument')
const message = (fn) => { try { fn() } catch (e) { return e.message } return null }
const cjsMessage = message(cjs.schemaOf)
check(cjsMessage !== null && cjsMessage.includes('schemaOf<T>()'), 'schemaOf still throws when the build did not replace it')

;(async () => {
  for (const file of [...ENTRIES.map((e) => e[1]), 'index.mjs', 'lite.mjs']) {
    const m = await import(path.join(root, file))
    check(m.defineSchema(schema) === schema, `${file} defineSchema returns its argument`)
    check(m.default.defineSchema(schema) === schema, `${file} default export defineSchema returns its argument`)
    check(message(m.schemaOf) === cjsMessage, `${file} schemaOf throws the CommonJS message`)
  }
  if (failed) {
    console.log(`\n${failed} failed`)
    process.exit(1)
  }
  console.log('\nall passed')
})()
