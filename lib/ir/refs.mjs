// $ref resolution inside one document. The index maps every resource
// ($id, resolved against its parent) and every $anchor to its schema; a JSON
// pointer is read from the resource it is relative to. A reference that
// leaves the document is refused, never passed over.

import { isObj } from '../kernels/rt.mjs'

// A base for a root without $id. Any absolute URI works; this one cannot
// collide with a real $id.
const ROOT = 'https://ata.invalid/root.json'

// A reference that names nothing this index holds. The front end turns it
// into the current engine's error for it (ATA5001) where the reference runs.
const unresolved = (message) => Object.assign(new Error(message), { unresolved: true })

const strip = (u) => { const i = u.indexOf('#'); return i === -1 ? u : u.slice(0, i) }
const resolveUri = (ref, base) => new URL(ref, base).href

// Keywords whose values are subschemas, and how to reach them, for the walk
// that finds $id and $anchor. Values of other keywords (const, enum,
// examples, default) are data and are not searched.
const ONE = ['additionalProperties', 'propertyNames', 'items', 'contains', 'not', 'if', 'then', 'else', 'unevaluatedProperties', 'unevaluatedItems', 'contentSchema']
const MAP = ['properties', 'patternProperties', 'dependentSchemas', '$defs', 'definitions']
const LIST = ['prefixItems', 'allOf', 'anyOf', 'oneOf']

// `registry`: more documents (the `schemas` option), keyed by the URI each
// was retrieved from; each is also addressable by the $id it declares.
// `external(uri)`: a document to load when a reference names one the index
// does not hold (the metaschemas), or undefined.
export function buildIndex (root, registry = null, external = null) {
  const resources = new Map() // uri without fragment -> schema
  const anchors = new Map() // uri#anchor -> schema
  const dynAnchors = new Map() // uri#name -> schema, for $dynamicRef
  const baseOf = new Map() // schema object -> its base uri
  const walk = (s, base) => {
    if (!isObj(s)) return
    // An $id with a fragment (`#/definitions/x`, which SchemaStore writes)
    // names no resource: it neither opens one nor moves the base, as in the
    // current engine. Registering its stripped URI replaced the document
    // that held it.
    if (typeof s.$id === 'string' && !/#./.test(s.$id)) {
      base = strip(resolveUri(s.$id, base))
      resources.set(base, s)
    }
    baseOf.set(s, base)
    if (typeof s.$anchor === 'string') anchors.set(base + '#' + s.$anchor, s)
    // A $dynamicAnchor is also a plain anchor for $ref and for the static
    // first step of $dynamicRef.
    if (typeof s.$dynamicAnchor === 'string') { dynAnchors.set(base + '#' + s.$dynamicAnchor, s); if (!anchors.has(base + '#' + s.$dynamicAnchor)) anchors.set(base + '#' + s.$dynamicAnchor, s) }
    for (const k of ONE) if (k in s) walk(s[k], base)
    for (const k of MAP) if (isObj(s[k])) for (const p in s[k]) walk(s[k][p], base)
    for (const k of LIST) if (Array.isArray(s[k])) for (const x of s[k]) walk(x, base)
  }
  const rootBase = isObj(root) && typeof root.$id === 'string' && !/#./.test(root.$id) ? strip(resolveUri(root.$id, ROOT)) : ROOT
  if (!resources.has(rootBase)) resources.set(rootBase, root)
  walk(root, ROOT)
  baseOf.set(root, rootBase)
  const addDoc = (uri, doc) => {
    // A document registered under a relative name (`shared`, as Fastify
    // registers them) is addressed from the root's base, where a reference
    // to `shared#` from the root lands.
    const at = strip(resolveUri(uri, rootBase))
    if (!resources.has(at)) resources.set(at, doc)
    walk(doc, at)
  }
  if (registry !== null) for (const [uri, doc] of registry) addDoc(uri, doc)

  return {
    baseOf: (s) => baseOf.get(s) || rootBase,
    dynAnchor: (base, name) => dynAnchors.get(base + '#' + name),
    // Every resource that declares $dynamicAnchor `name`: the candidates a
    // $dynamicRef to it can land on, by base.
    dynCandidates: (name) => [...dynAnchors].filter(([k]) => k.endsWith('#' + name) && k.slice(0, k.length - name.length - 1).indexOf('#') === -1).map(([k, v]) => [k.slice(0, k.length - name.length - 1), v]),
    resolve (ref, base) {
      const abs = resolveUri(ref, base)
      const doc = strip(abs)
      const frag = abs.length > doc.length ? abs.slice(doc.length + 1) : ''
      let res = resources.get(doc)
      if (res === undefined && external !== null) {
        const d = external(doc)
        if (d !== undefined) { addDoc(doc, d); res = resources.get(doc) }
      }
      if (res === undefined) throw unresolved(`ir: $ref "${ref}" leaves the document`)
      if (frag === '') return res
      if (!frag.startsWith('/')) {
        const a = anchors.get(doc + '#' + frag)
        if (a === undefined) throw unresolved(`ir: $ref "${ref}" names an unknown anchor`)
        return a
      }
      let cur = res
      for (const raw of frag.slice(1).split('/')) {
        const segm = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~')
        if (cur === null || typeof cur !== 'object') throw unresolved(`ir: $ref "${ref}" points at nothing`)
        // Normalization (lib/draft7.js) renames definitions to $defs and
        // tuple items to prefixItems but leaves pointers as written, so the
        // old names read as the new ones, as the current engine reads them.
        let name = segm
        if (!(name in cur)) {
          const alias = name === 'definitions' ? '$defs' : name === '$defs' ? 'definitions' : name === 'items' && Array.isArray(cur.prefixItems) ? 'prefixItems' : null
          if (alias === null || !(alias in cur)) throw unresolved(`ir: $ref "${ref}" points at nothing`)
          name = alias
        }
        cur = cur[name]
      }
      return cur
    },
  }
}
