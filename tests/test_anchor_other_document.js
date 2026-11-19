'use strict'

// A plain-name `$ref` ("#frag") resolves against the base of the resource
// that holds it, so it never names an anchor declared in another registered
// document (issue #123). The three code generators merged every registered
// document's anchors into the root's under "#name", so the generated code
// checked the value against the other document's subschema and accepted
// what the interpreted engine, which reports the reference as unresolved,
// rejects. Each entry point now answers as the interpreted engine does; the
// root's own anchor and a full reference into the other document still
// resolve.

const assert = require('assert')
const { Validator } = require('..')

const root = () => ({ $id: 'urn:root', type: 'object', properties: { x: { $ref: '#frag' } } })
const others = [
  { 'urn:other': { $anchor: 'frag', type: 'number' } },
  { 'urn:other': { $id: '#frag', type: 'number' } },
  { 'urn:other': { $id: 'urn:other', $defs: { f: { $dynamicAnchor: 'frag', type: 'number' } } } },
]
const hot = (v) => { for (let i = 0; i < 80; i++) v.isValidObject({ x: 1 }); return v }

for (const schemas of others) {
  for (const make of [() => new Validator(root(), { schemas }), () => hot(new Validator(root(), { schemas })), () => new Validator(root(), { schemas, engine: 'interpreter' }), () => new Validator(root(), { schemas, richErrors: false })]) {
    const v = make()
    assert.strictEqual(v.validate({ x: 1 }).valid, false, 'validate: #frag does not reach the other document')
    assert.strictEqual(v.isValidObject({ x: 1 }), false, 'isValidObject')
    assert.strictEqual(v.validateJSON('{"x":1}').valid, false, 'validateJSON')
    assert.strictEqual(v.isValidJSON('{"x":1}'), false, 'isValidJSON')
  }
}

// The root's own anchor resolves.
{
  const own = { $id: 'urn:root', $defs: { f: { $anchor: 'frag', type: 'number' } }, type: 'object', properties: { x: { $ref: '#frag' } } }
  const v = new Validator(own, { schemas: others[0] })
  assert.strictEqual(v.validate({ x: 1 }).valid, true)
  assert.strictEqual(v.validate({ x: 'a' }).valid, false)
}

// A full reference into the other document resolves there.
{
  const cross = { $id: 'urn:root', type: 'object', properties: { x: { $ref: 'urn:other#frag' } } }
  const schemas = { 'urn:other': { $id: 'urn:other', $defs: { f: { $anchor: 'frag', type: 'number' } } } }
  for (const o of [{}, { engine: 'interpreter' }]) {
    const v = new Validator(cross, { schemas, ...o })
    assert.strictEqual(v.validate({ x: 1 }).valid, true)
    assert.strictEqual(v.validate({ x: 'a' }).valid, false)
  }
}

console.log('ok: a plain-name $ref does not resolve to another document\'s anchor on any path')
