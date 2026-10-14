'use strict'

// draft-06 is read through the same rules: it differs from draft-07 only in
// lacking `if`/`then`/`else` (and the content and readOnly annotations), so a
// draft-06 schema is a draft-07 schema with those three keywords inert. Before
// this, a draft-06 schema was read under 2020-12 and its tuple `items`,
// `additionalItems` and `dependencies` were not applied: 30 cases of the
// official draft-06 suite accepted documents they must reject.
const { DRAFT7_SCHEMAS, DRAFT6_SCHEMAS, DRAFT4_SCHEMAS, DRAFT2019_SCHEMAS, draftCode } = require('./dialect')

function isDraft7(schema) {
  return !!(schema && typeof schema.$schema === 'string' && DRAFT7_SCHEMAS.has(schema.$schema))
}

function isDraft6(schema) {
  return !!(schema && typeof schema.$schema === 'string' && DRAFT6_SCHEMAS.has(schema.$schema))
}

// `force` applies the draft-07 rules to a document that declares no dialect
// of its own, which is how a retrieved schema inherits the root's draft.
// `draft6` says the document, or the root it inherits from, is draft-06.
// `draft4`: draft-04, read as draft-06 plus its own differences (below).
function normalizeDraft7(schema, force, draft6, draft4) {
  if (!force && !isDraft7(schema)) return schema
  const d4 = draft4 === true || (typeof schema.$schema === 'string' && DRAFT4_SCHEMAS.has(schema.$schema))
  _normalize(schema, d4 || draft6 === true || isDraft6(schema), d4)
  return schema
}

// Keywords that may sit next to `$ref` in draft-07 without being applied:
// definitions are addressable by pointer, annotations are inert.
const REF_SIBLINGS_KEPT = new Set(['$ref', '$defs', 'definitions', '$schema', '$comment', 'title', 'description', 'examples', 'default', 'readOnly', 'writeOnly'])

function _normalize(schema, d6, d4) {
  if (typeof schema !== 'object' || schema === null) return

  // draft-06 has no conditional: `if`, `then` and `else` are unknown keywords
  // there, so they are dropped rather than applied.
  if (d6) { delete schema.if; delete schema.then; delete schema.else }

  // draft-04 names a schema's identifier `id`, and has none of draft-06's
  // `const`, `contains` or `propertyNames`: unknown keywords there.
  if (d4) {
    delete schema.const; delete schema.contains; delete schema.propertyNames
    if (typeof schema.id === 'string' && schema.$id === undefined && typeof schema.$ref !== 'string') schema.$id = schema.id
    delete schema.id
  }

  // In draft-07 an object with `$ref` is that reference and nothing else:
  // sibling keywords, `$id` included, are ignored. Dropping them here gives
  // every engine the same reading without each having to know the draft.
  if (typeof schema.$ref === 'string') {
    for (const key of Object.keys(schema)) {
      if (!REF_SIBLINGS_KEPT.has(key)) delete schema[key]
    }
  }

  // A fragment-only `$id` is a plain-name anchor in draft-07; 2020-12 spells
  // it `$anchor`, which every engine already resolves.
  if (typeof schema.$id === 'string' && /^#[A-Za-z][A-Za-z0-9_.:-]*$/.test(schema.$id)) {
    if (schema.$anchor === undefined) schema.$anchor = schema.$id.slice(1)
    delete schema.$id
  }

  // definitions → $defs
  if (schema.definitions && !schema.$defs) {
    schema.$defs = schema.definitions
    delete schema.definitions
  }

  // dependencies → dependentSchemas + dependentRequired
  if (schema.dependencies) {
    for (const [key, value] of Object.entries(schema.dependencies)) {
      // defineProperty: a dependency on a property named "__proto__" is an
      // own key here, where assignment would set the map's prototype.
      const target = Array.isArray(value) ? 'dependentRequired' : 'dependentSchemas'
      if (!schema[target]) schema[target] = {}
      Object.defineProperty(schema[target], key, { value, writable: true, enumerable: true, configurable: true })
    }
    delete schema.dependencies
  }

  // items (array form) → prefixItems + items/additionalItems swap
  if (Array.isArray(schema.items)) {
    schema.prefixItems = schema.items
    if (schema.additionalItems !== undefined) {
      schema.items = schema.additionalItems
      delete schema.additionalItems
    } else {
      delete schema.items
    }
  }

  // Recurse into object-valued sub-schemas
  for (const key of D7_OBJ_SUBS) {
    const m = schema[key]
    if (m && typeof m === 'object') {
      for (const k in m) {
        if (!Object.prototype.hasOwnProperty.call(m, k)) continue
        const v = m[k]
        if (typeof v === 'object' && v !== null) _normalize(v, d6, d4)
      }
    }
  }

  // Recurse into array-valued sub-schemas
  for (const key of D7_ARR_SUBS) {
    const a = schema[key]
    if (Array.isArray(a)) {
      for (let i = 0; i < a.length; i++) {
        const v = a[i]
        if (typeof v === 'object' && v !== null) _normalize(v, d6, d4)
      }
    }
  }

  // Recurse into single sub-schemas
  for (const key of D7_SINGLE_SUBS) {
    const v = schema[key]
    if (typeof v === 'object' && v !== null) _normalize(v, d6, d4)
  }
}
// The schema-bearing keywords _normalize walks, built once rather than per node.
const D7_OBJ_SUBS = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']
const D7_ARR_SUBS = ['allOf', 'anyOf', 'oneOf', 'prefixItems']
const D7_SINGLE_SUBS = ['items', 'contains', 'not', 'if', 'then', 'else', 'additionalProperties', 'propertyNames']

// OpenAPI `nullable: true` is not JSON Schema. Convert it to a union with
// 'null' (`{ type: 'X', nullable: true }` -> `{ type: ['X', 'null'] }`), the
// same shape AJV produces under its `nullable` option. Recurses only through
// schema-bearing keywords so it never touches data values (default, const, etc.).

// draft-04 spelled the exclusive bounds as booleans modifying `minimum` and
// `maximum`; every dialect since spells them as the bound itself. The engines
// read the numeric form, and the codegen path compared the value against the
// boolean directly, so `true` became 1: a schema saying "below 5, exclusive"
// rejected 1 and a schema saying "above 3, exclusive" accepted 3. Rewriting
// the pair here gives every engine the same numeric keyword, which is also
// what makes the two agree.
function normalizeExclusiveBounds(schema) {
  _walkExclusive(schema, new Set())
  return schema
}

function _walkExclusive(node, seen) {
  if (typeof node !== 'object' || node === null) return
  if (Array.isArray(node)) {
    for (const item of node) _walkExclusive(item, seen)
    return
  }
  if (seen.has(node)) return
  seen.add(node)

  if (typeof node.exclusiveMinimum === 'boolean') {
    if (node.exclusiveMinimum === true && typeof node.minimum === 'number') {
      node.exclusiveMinimum = node.minimum
      delete node.minimum
    } else {
      // `false` restates the inclusive bound, and a boolean with no bound
      // beside it says nothing at all.
      delete node.exclusiveMinimum
    }
  }
  if (typeof node.exclusiveMaximum === 'boolean') {
    if (node.exclusiveMaximum === true && typeof node.maximum === 'number') {
      node.exclusiveMaximum = node.maximum
      delete node.maximum
    } else {
      delete node.exclusiveMaximum
    }
  }

  for (const key of Object.keys(node)) _walkExclusive(node[key], seen)
}

function normalizeNullable(schema) {
  if (typeof schema !== 'object' || schema === null) return schema
  const st = { seen: new Set(), refs: [] }
  _normalizeNullable(schema, st)
  // A local `$ref` can point anywhere in the document, an OpenAPI
  // `components` section among them, where the walk over subschema keywords
  // does not go. A schema reached that way is a schema all the same, and its
  // `nullable` is folded too.
  while (st.refs.length > 0) {
    const target = _localTarget(schema, st.refs.pop())
    if (typeof target === 'object' && target !== null && !Array.isArray(target)) _normalizeNullable(target, st)
  }
  return schema
}

function _localTarget(root, ref) {
  if (ref === '#') return root
  if (!ref.startsWith('#/')) return undefined
  let node = root
  for (const raw of ref.slice(2).split('/')) {
    let seg = raw.replace(/~1/g, '/').replace(/~0/g, '~')
    if (seg.includes('%')) { try { seg = decodeURIComponent(seg) } catch { return undefined } }
    if (node === null || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(node, seg)) return undefined
    node = node[seg]
  }
  return node
}

function _normalizeNullable(schema, st) {
  if (typeof schema !== 'object' || schema === null) return
  if (st.seen.has(schema)) return
  st.seen.add(schema)

  if (schema.nullable === true && schema.type !== undefined) {
    if (Array.isArray(schema.type)) {
      if (!schema.type.includes('null')) schema.type = schema.type.concat('null')
    } else {
      schema.type = [schema.type, 'null']
    }
  }
  if ('nullable' in schema) delete schema.nullable
  // A JSON Pointer in a URI fragment is percent-encoded, so a definition named
  // `Node<Row>` is reached by `#/definitions/Node%3CRow%3E` (RFC 6901, section
  // 6). The interpreter decodes the fragment; the code generator compared the
  // encoded text with the definition names and declined the whole document, so
  // one such reference sent every validator built from it to the interpreter and
  // made `ata compile` refuse it. Rewritten here to the decoded pointer, every
  // engine reads the same text. A decoded form still holding a `%` is left
  // alone: the engines decode once more, and `100%` must not be decoded twice.
  // This walk is the one every normalization runs, so it costs no second pass;
  // a reference it does not reach keeps the old behaviour, the interpreter.
  if (typeof schema.$ref === 'string' && schema.$ref.charCodeAt(0) === 35 && schema.$ref.indexOf('%') > 0) {
    try {
      const decoded = decodeURIComponent(schema.$ref)
      if (!decoded.includes('%')) schema.$ref = decoded
    } catch {}
  }
  if (typeof schema.$ref === 'string' && schema.$ref.charCodeAt(0) === 35) st.refs.push(schema.$ref)

  for (const key of D7_OBJ_SUBS) {
    const m = schema[key]
    if (m && typeof m === 'object') {
      for (const k in m) {
        if (!Object.prototype.hasOwnProperty.call(m, k)) continue
        const v = m[k]
        if (typeof v === 'object' && v !== null) _normalizeNullable(v, st)
      }
    }
  }
  for (const key of D7_ARR_SUBS) {
    const a = schema[key]
    if (Array.isArray(a)) {
      for (let i = 0; i < a.length; i++) {
        const v = a[i]
        if (typeof v === 'object' && v !== null) _normalizeNullable(v, st)
      }
    }
  }
  for (const key of NULLABLE_SINGLE_SUBS) {
    const v = schema[key]
    if (typeof v === 'object' && v !== null) _normalizeNullable(v, st)
  }
}
const NULLABLE_SINGLE_SUBS = ['items', 'contains', 'not', 'if', 'then', 'else', 'additionalProperties', 'propertyNames', 'unevaluatedItems', 'unevaluatedProperties']

// Draft 2020-12 treats `format` as an annotation unless the assertion
// vocabulary is in use. Removing the keyword is exactly that reading, and it
// keeps every engine in agreement without each one growing its own switch.
// Walks schema-bearing keywords only, so a property or definition named
// "format" is untouched.
function stripFormatAssertions(schema) {
  if (typeof schema !== 'object' || schema === null) return schema
  _stripFormat(schema, new Set())
  return schema
}

function _stripFormat(schema, seen) {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return
  if (seen.has(schema)) return
  seen.add(schema)

  if (typeof schema.format === 'string') delete schema.format

  const objSubs = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']
  for (const key of objSubs) {
    if (schema[key] && typeof schema[key] === 'object' && !Array.isArray(schema[key])) {
      for (const v of Object.values(schema[key])) _stripFormat(v, seen)
    }
  }
  const arrSubs = ['allOf', 'anyOf', 'oneOf', 'prefixItems']
  for (const key of arrSubs) {
    if (Array.isArray(schema[key])) {
      for (const s of schema[key]) _stripFormat(s, seen)
    }
  }
  const singleSubs = ['items', 'additionalItems', 'contains', 'not', 'if', 'then', 'else',
                      'additionalProperties', 'propertyNames', 'unevaluatedItems',
                      'unevaluatedProperties', 'contentSchema']
  for (const key of singleSubs) {
    if (Array.isArray(schema[key])) {
      for (const s of schema[key]) _stripFormat(s, seen)
    } else {
      _stripFormat(schema[key], seen)
    }
  }
}

// Draft 2019-09 differs from 2020-12, which every engine here reads, in two
// places: the array form of `items` with `additionalItems` (2020-12 spells
// them `prefixItems` and `items`), and `$recursiveRef`/`$recursiveAnchor`,
// which 2020-12 generalised into `$dynamicRef`/`$dynamicAnchor`. Both are
// rewritten to the 2020-12 spelling. Before, a 2019-09 schema was read as
// 2020-12 as written, and 38 cases of the official 2019-09 suite accepted
// documents they must reject.
//
// The recursive pair maps one to one: a resource whose root says
// `$recursiveAnchor: true` gets a `$dynamicAnchor` of a reserved name, and
// `$recursiveRef: "#"` becomes a `$dynamicRef` to that name when its resource
// carries the anchor, and a plain `$ref: "#"` when it does not, which is what
// 2019-09 says it means then. The outward search for the outermost anchored
// resource is the same rule in both drafts.
const RECURSIVE_ANCHOR = '__ata_recursive_anchor'

function isDraft2019(schema) {
  return !!(schema && typeof schema.$schema === 'string' && DRAFT2019_SCHEMAS.has(schema.$schema))
}

const SUB_OBJECT = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']
const SUB_ARRAY = ['allOf', 'anyOf', 'oneOf', 'prefixItems', 'items']
const SUB_SINGLE = ['items', 'additionalItems', 'contains', 'not', 'if', 'then', 'else', 'additionalProperties',
  'propertyNames', 'unevaluatedItems', 'unevaluatedProperties', 'contentSchema']

function normalizeDraft2019(schema, force) {
  if (!force && !isDraft2019(schema)) return schema
  _normalize2019(schema, schema, false)
  return schema
}

function _normalize2019(node, resourceRoot, isRoot) {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return
  // A subschema with its own `$id` starts a new resource.
  const root = !isRoot && typeof node.$id === 'string' && !node.$id.startsWith('#') ? node : resourceRoot
  if (node.$recursiveAnchor === true && node === root) node.$dynamicAnchor = RECURSIVE_ANCHOR
  delete node.$recursiveAnchor
  if (typeof node.$recursiveRef === 'string') {
    if (node.$recursiveRef === '#' && root.$dynamicAnchor === RECURSIVE_ANCHOR) node.$dynamicRef = '#' + RECURSIVE_ANCHOR
    else if (node.$ref === undefined) node.$ref = node.$recursiveRef
    delete node.$recursiveRef
  }
  // Recurse before the items rewrite, so tuple members are walked as members.
  for (const key of SUB_OBJECT) {
    const sub = node[key]
    if (sub && typeof sub === 'object') for (const v of Object.values(sub)) _normalize2019(v, root, false)
  }
  for (const key of SUB_ARRAY) {
    if (Array.isArray(node[key])) for (const v of node[key]) _normalize2019(v, root, false)
  }
  for (const key of SUB_SINGLE) {
    const sub = node[key]
    if (sub && typeof sub === 'object' && !Array.isArray(sub)) _normalize2019(sub, root, false)
  }
  if (Array.isArray(node.items)) {
    node.prefixItems = node.items
    if (node.additionalItems !== undefined) { node.items = node.additionalItems; delete node.additionalItems } else delete node.items
  } else {
    delete node.additionalItems
  }
}

// The draft a `$schema` value names, for the normalizers: 2 draft-06,
// 1 draft-07, 3 2019-09, 0 anything else. Takes the string so the caller
// reads the property once.
module.exports = { draftCode, isDraft7, isDraft6, isDraft2019, normalizeDraft2019, normalizeDraft7, normalizeNullable, normalizeExclusiveBounds, stripFormatAssertions }
