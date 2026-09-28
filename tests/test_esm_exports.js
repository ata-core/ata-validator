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
})().catch((e) => { console.error(e); process.exit(1) })
