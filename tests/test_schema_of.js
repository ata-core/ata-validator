'use strict'

// schemaOf<T>() is a build-time placeholder: @ata-project/unplugin writes the
// JSON Schema of the type in its place. It has no run-time form, so every
// entry exports it and every entry's copy throws, naming the plugin, rather
// than returning a schema that would accept anything.

const assert = require('node:assert')
const path = require('node:path')

for (const entry of ['..', '../lite.js', '../lib/public-api.js']) {
  const mod = require(entry)
  assert.strictEqual(typeof mod.schemaOf, 'function', entry + ' exports schemaOf')
  assert.throws(() => mod.schemaOf(), (e) => e instanceof Error && /@ata-project\/unplugin/.test(e.message) && /no run-time form/.test(e.message), entry + ' throws with the plugin named')
}
const d = require('fs').readFileSync(path.join(__dirname, '..', 'index.d.ts'), 'utf8')
assert.match(d, /export declare function schemaOf<T>\(\): JSONSchema;/, 'declared for TypeScript')

console.log('ok: schemaOf throws at run time in every entry and is declared')
