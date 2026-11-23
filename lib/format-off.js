'use strict'
// `assertFormat: false` for the 2.0 Validator: the root and the registry
// (the `schemas` option, addSchema(), the meta-schemas) without their
// formats. A document that holds one is copied once (`clone` is the
// caller's) and the copy kept, so validators over one registry hold the same
// documents. With a registry the root is this validator's own object:
// lib/schema-order.js keeps one registry per root.
// normalizeExclusiveBounds with its second argument is the removal
// (lib/draft7.js); a normalized schema's bounds are numbers already.
const { normalizeExclusiveBounds } = require('./draft7')

const kept = new WeakMap()
function without (doc, clone) {
  if (!doc || typeof doc !== 'object') return doc
  let c = kept.get(doc)
  if (!c) {
    c = doc
    if (JSON.stringify(doc).includes('"format"')) normalizeExclusiveBounds(c = clone(doc), true)
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
