'use strict'

// Both ESM entries export every public name the CommonJS entry does. They
// listed names by hand and fell behind: `import { toTypeScript } from
// 'ata-validator'` threw a SyntaxError under Node ESM, as did compile,
// parseJSON, toOutput, toRetryMessage and describeSchema, all of them in
// index.d.ts, and the browser entry had no defineSchema, which failed a Vite
// build that imported it.

const assert = require('assert')
const fs = require('fs')
const path = require('path')

const INTERNAL = new Set(['attachSuggestions'])
const cjs = Object.keys(require('..')).filter((k) => !INTERNAL.has(k))
for (const file of ['index.mjs', 'index.browser.mjs']) {
  const src = fs.readFileSync(path.join(__dirname, '..', file), 'utf8')
  const m = src.match(/export const \{([^}]*)\}/)
  const names = m ? m[1].split(',').map((s) => s.trim()).filter(Boolean) : []
  assert.deepStrictEqual(cjs.filter((k) => !names.includes(k)), [], `${file} does not export everything index.js does`)
}

;(async () => {
  const esm = await import('../index.mjs')
  for (const k of cjs) assert.notStrictEqual(esm[k], undefined, `index.mjs ${k}`)
  console.log(`ok: both ESM entries export the ${cjs.length} public names of index.js`)
  // The subpath entries list their names by hand too. build.mjs lacked
  // compiledModuleFor, which 1.35.0 introduced for bundler plugins, and
  // schemaHash, which build.d.ts declares.
  const SUBPATH_INTERNAL = { compat: new Set(['attachDataFrames']) }
  let checked = 0
  for (const sub of ['build', 'compiled', 'aot', 'compat', 't', 'lite']) {
    const skip = SUBPATH_INTERNAL[sub] || new Set()
    const names = Object.keys(require(`../${sub}.js`)).filter((k) => k !== 'default' && !skip.has(k))
    const mod = await import(`../${sub}.mjs`)
    for (const k of names) assert.notStrictEqual(mod[k], undefined, `${sub}.mjs does not export ${k}`)
    checked += names.length
  }
  console.log(`ok: the six subpath ESM entries export the ${checked} names of their CommonJS entries`)
})().catch((e) => { console.error(e); process.exit(1) })
