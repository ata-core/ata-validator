'use strict'
// The formatsOff feature, `assertFormat: false` for the 2.0 Validator: the
// root and the registry without their formats, wherever a schema can be.
// A document with a format is copied once; with a registry the root is the
// validator's own object (lib/schema-order.js keeps one registry per root).
const DATA = ['enum', 'const', 'default', 'examples']
const NAMES = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas', 'dependentRequired', 'dependencies', 'propertyDependencies']
function strip (node, names) {
  if (node === null || typeof node !== 'object') return
  if (!names && typeof node.format === 'string') delete node.format
  for (const k of Object.keys(node)) if (names || !DATA.includes(k)) strip(node[k], !names && NAMES.includes(k))
}

const kept = new WeakMap()
function without (doc, clone) {
  if (!doc || typeof doc !== 'object') return doc
  let c = kept.get(doc)
  if (!c) {
    c = doc
    if (JSON.stringify(doc).includes('"format"')) strip(c = clone(doc))
    kept.set(doc, c)
  }
  return c
}

function formatsOff (schema, map, clone) {
  let root = without(schema, clone)
  if (map) {
    map = new Map(map)
    for (const [id, doc] of map) map.set(id, without(doc, clone))
    if (root === schema && root && typeof root === 'object') root = { ...root }
  }
  return [root, map]
}

module.exports = { formatsOff }
