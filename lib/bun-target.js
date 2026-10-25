'use strict'
// `ata build --target bun`: the schema's rules as a TypeScript type for Bun's
// `validate<T>()` and `JSON.parse<T>()`, written with Bun's `Schema` tags, so
// that `bun build --compile --aot` checks them in machine code.
//
// A schema is split in two. The keywords a type can carry exactly (the JSON
// kind, properties and which are required, closed objects, items and tuples,
// lengths, counts, numeric bounds, literals, local definitions) become the
// type. Every other keyword (`format`, `oneOf`, `not`, `if`, pattern
// properties, `uniqueItems`, `contains`, custom keywords, among others) stays
// in a second schema, the residual, which keeps the structure needed to reach
// each keyword and nothing else; ata compiles it as it compiles any schema.
// The generated module accepts a document when Bun's check and the residual
// module both do, and asks the plain module for the errors otherwise.
//
// Keywords at one node of a JSON Schema are independent and conjunctive, so
// the split is exact, with the groups that see each other kept whole in the
// residual: `if`/`then`/`else`; `unevaluatedProperties` and `unevaluatedItems`
// with every sibling of theirs; `additionalProperties` with
// `patternProperties`; the `contains` family; `anyOf` whenever one branch has
// a residual, since a document may satisfy one branch's type and another's
// residual and neither branch. The type is therefore never looser than what
// the type and the residual check together, and the plain module stands
// behind both.
//
// A type is built as six sets, one per JSON kind, each a list of alternatives
// of that kind. A union adds the lists; an intersection pairs them kind by
// kind, so `{ foo: string } & unknown[]`, which Bun cannot check, is never
// written: an object rule and an array rule meet in no value.

// Annotations: no effect on a verdict, carried by nothing here.
const IGNORED = new Set([
  '$schema', '$id', '$comment', '$anchor', '$vocabulary', 'title', 'description',
  'examples', 'default', 'deprecated', 'readOnly', 'writeOnly', '$defs', 'definitions',
  'contentMediaType', 'contentEncoding', 'contentSchema'
])
const STRING_KEYS = ['minLength', 'maxLength', 'pattern']
const NUMBER_KEYS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf']
const OBJECT_KEYS = ['properties', 'required', 'additionalProperties']
const ARRAY_KEYS = ['items', 'prefixItems', 'minItems', 'maxItems']
const CONSTRAINT_KEYS = [...STRING_KEYS, ...NUMBER_KEYS, ...OBJECT_KEYS, ...ARRAY_KEYS]
// Keywords the type reads. Everything else at a node goes to the residual.
const TYPED = new Set(['type', 'enum', 'const', 'anyOf', 'allOf', '$ref', ...CONSTRAINT_KEYS])
// Keywords that take the whole node with them.
const WHOLE_NODE = new Set(['unevaluatedProperties', 'unevaluatedItems', '$dynamicRef', '$dynamicAnchor', '$recursiveRef', '$recursiveAnchor'])
const KINDS = ['string', 'number', 'boolean', 'null', 'object', 'array']
const UNIVERSAL = { string: 'string', number: 'number', boolean: 'boolean', null: 'null', object: 'Record<string, unknown>', array: 'unknown[]' }

class Declined extends Error {
  constructor (reason, pointer) {
    super(`${reason} at ${pointer}`)
    this.reason = reason
    this.pointer = pointer
  }
}

function fail (reason, ptr) { throw new Declined(reason, ptr) }

// The six sets. `alias` is a named type standing for a whole definition; it
// joins a union as a name and declines an intersection, whose members it
// would have to be distributed over.
function empty () { return { string: [], number: [], boolean: [], null: [], object: [], array: [], alias: [] } }
function universal () { const t = empty(); for (const k of KINDS) t[k].push(UNIVERSAL[k]); return t }
function single (kind, alt) { const t = empty(); t[kind].push(alt); return t }
function union (a, b) { const t = empty(); for (const k of [...KINDS, 'alias']) t[k] = dedupe([...a[k], ...b[k]]); return t }
function dedupe (xs) { return xs.filter((x, i) => xs.indexOf(x) === i) }
function isUniversal (t) { return t.alias.length === 0 && KINDS.every((k) => t[k].length === 1 && t[k][0] === UNIVERSAL[k]) }

// Intersection, or null where the two cannot be written as one type; the
// caller then keeps one side in the residual.
function intersect (a, b) {
  if (a.alias.length || b.alias.length) return null
  const t = empty()
  for (const k of KINDS) {
    for (const x of a[k]) {
      for (const y of b[k]) {
        const z = meet(k, x, y)
        if (z === undefined) return null
        if (z !== null) t[k].push(z)
      }
    }
    t[k] = dedupe(t[k])
  }
  return t
}

// Two alternatives of one kind: the alternative for both, null when no value
// satisfies both, undefined when the pair cannot be written.
function meet (kind, x, y) {
  if (x === UNIVERSAL[kind]) return y
  if (y === UNIVERSAL[kind]) return x
  if (x === y) return x
  const xl = isLiteral(x), yl = isLiteral(y)
  if (xl && yl) return null
  if (xl || yl) return undefined
  switch (kind) {
    case 'string': return `${x} & ${y.replace(/^string & /, '')}`
    case 'number': return `${x} & ${y.replace(/^number & /, '')}`
    case 'object':
      // Strict on one member of an intersection would have to see the
      // others' properties; whether Bun does is not pinned down.
      if (/Schema\.Strict\b/.test(x) || /Schema\.Strict\b/.test(y)) return undefined
      return `${x} & ${y}`
    default: return undefined
  }
}

function isLiteral (alt) { return /^(".*"|-?[0-9.eE+-]+|true|false|null)$/.test(alt) }

function render (t) {
  const alts = [...KINDS.flatMap((k) => t[k]), ...t.alias]
  if (alts.length === 0) return 'never'
  if (isUniversal(t)) return 'unknown'
  if (alts.length === 1) return alts[0]
  return alts.map((a) => /[&|]/.test(a) ? `(${a})` : a).join(' | ')
}

function literalOf (v) {
  if (typeof v === 'string') return single('string', JSON.stringify(v))
  if (typeof v === 'number' && Number.isFinite(v)) return single('number', String(v))
  if (typeof v === 'boolean') return single('boolean', String(v))
  if (v === null) return single('null', 'null')
  return null
}

function finite (v) { return typeof v === 'number' && Number.isFinite(v) }

// Bun's Pattern runs the expression without the unicode flag; JSON Schema's
// patterns are read with it. The two agree on what they accept unless an atom
// that can match half of a surrogate pair is counted: `^.{2}$` accepts one
// astral character without the flag and refuses it with it. The expressions
// carried are the ones where no such atom is counted: ASCII only, no escapes
// whose meaning depends on the flag, and `.`, a negated class, `\W`, `\S`
// and `\D` only under a greedy `+` or `*`. Returns null when the pattern is
// carried, else what rules it out.
function patternDiffers (p) {
  if (!/^[\x20-\x7e]*$/.test(p)) return 'with a character outside ASCII'
  for (let i = 0; i < p.length; i++) {
    const c = p[i]
    if (c === '\\') {
      const n = p[i + 1]
      if (n === undefined) return 'ending in a backslash'
      if ('pPuxbBk'.includes(n)) return `with \\${n}`
      if ('WSD'.includes(n) && !greedyUnbounded(p, i + 2)) return `with \\${n} outside a greedy + or *`
      i++
      continue
    }
    if (c === '.') { if (!greedyUnbounded(p, i + 1)) return 'with . outside a greedy + or *'; continue }
    if (c === '[') {
      const negated = p[i + 1] === '^'
      let j = i + 1 + (negated ? 1 : 0)
      if (p[j] === ']') j++
      for (; j < p.length && p[j] !== ']'; j++) {
        if (p[j] === '\\') {
          const n = p[j + 1]
          if ('pPuxWSDkbB'.includes(n || '')) return `with \\${n} in a class`
          j++
        }
      }
      if (j >= p.length) return 'with an unclosed class'
      if (negated && !greedyUnbounded(p, j + 1)) return 'with a negated class outside a greedy + or *'
      i = j
    }
  }
  return null
}
function greedyUnbounded (p, i) { return (p[i] === '+' || p[i] === '*') && p[i + 1] !== '?' }

// Names a definition must not take: they would shadow what the generated
// file refers to.
const RESERVED = new Set(['Schema', 'Record', 'Array', 'ReadonlyArray', 'Partial', 'Readonly', 'Pick', 'Omit', 'Required', 'Promise', 'Date', 'Object', 'String', 'Number', 'Boolean', 'Function', 'Symbol', 'JSON', 'Bun', 'ReturnType'])

// `name` must be an identifier TypeScript accepts.
function typeName (key, taken) {
  let base = key.replace(/[^A-Za-z0-9_$]/g, '_').replace(/^([0-9])/, '_$1') || 'Def'
  base = base.replace(/^([a-z])/, (m) => m.toUpperCase())
  if (RESERVED.has(base)) base += '_'
  let name = base
  for (let i = 2; taken.has(name); i++) name = base + i
  taken.add(name)
  return name
}

function isSchema (s) { return s === true || s === false || (typeof s === 'object' && s !== null && !Array.isArray(s)) }

// The type and the residual for `schema`. Returns { name, type, aliases,
// residual, carried }: `type` the source of the root type, `aliases` the
// [name, source] definitions it refers to, `residual` the schema of what the
// type does not check (null when the type checks everything), `carried` the
// keywords the type took, by pointer. `opts.aliasPrefix` goes in front of
// every definition's name, for a file that holds several schemas. Throws
// Declined for a schema the split cannot be made for.
function schemaToBunType (root, opts = {}) {
  const taken = new Set()
  const name = typeName(opts.name || 'Data', taken)
  const aliases = []
  const aliasByPointer = new Map()
  const defResiduals = new Map() // pointer -> residual schema or null
  const carried = []
  let depth = 0
  // Whether a definition still being built, or the root, has a residual is
  // not known while a reference to it is met. The reference is first taken as
  // having none; when the definition turns out to have one, it is built a
  // second time with the reference kept, so that a cycle through a residual
  // stays a cycle.
  let rootHasResidual = false
  let rootRefSeen = false
  // In draft-07 and before, keywords beside $ref are ignored.
  const refOverrides = typeof root.$schema === 'string' && /draft-0[467]\b/.test(root.$schema)
  const restKey = (key) => `__rest__${key}`

  function resolveRef (ref, ptr) {
    if (ref === '#') return { pointer: '#', schema: root, key: 'Root' }
    const m = /^#\/(\$defs|definitions)\/([^/]+)$/.exec(ref)
    if (!m) return fail(`$ref ${JSON.stringify(ref)} is not a local definition`, ptr)
    const key = decodeURIComponent(m[2].replace(/~1/g, '/').replace(/~0/g, '~'))
    const defs = root[m[1]]
    if (!defs || typeof defs !== 'object' || !Object.prototype.hasOwnProperty.call(defs, key)) return fail(`$ref ${JSON.stringify(ref)} does not resolve`, ptr)
    return { pointer: `#/${m[1]}/${m[2]}`, schema: defs[key], key }
  }

  // The alias for a definition; its type and residual are built once.
  function alias (target) {
    if (aliasByPointer.has(target.pointer)) return aliasByPointer.get(target.pointer)
    const n = target.pointer === '#' ? name : typeName((opts.aliasPrefix || '') + target.key, taken)
    aliasByPointer.set(target.pointer, n)
    if (target.pointer !== '#') {
      defResiduals.set(target.pointer, null)
      const r = conv(target.schema, target.pointer)
      aliases.push([n, render(r.t)])
      if (r.res !== null) {
        defResiduals.set(target.pointer, r.res)
        defResiduals.set(target.pointer, conv(target.schema, target.pointer).res)
      }
    }
    return n
  }

  function stringAlt (s, ptr, res) {
    let t = 'string'
    if (s.minLength !== undefined && finite(s.minLength)) { t += ` & Schema.MinLength<${s.minLength}>`; carried.push(`${ptr}/minLength`) } else if (s.minLength !== undefined) res.minLength = s.minLength
    if (s.maxLength !== undefined && finite(s.maxLength)) { t += ` & Schema.MaxLength<${s.maxLength}>`; carried.push(`${ptr}/maxLength`) } else if (s.maxLength !== undefined) res.maxLength = s.maxLength
    if (s.pattern !== undefined) {
      if (typeof s.pattern === 'string' && patternDiffers(s.pattern) === null) { t += ` & Schema.Pattern<${JSON.stringify(s.pattern)}>`; carried.push(`${ptr}/pattern`) } else res.pattern = s.pattern
    }
    return t
  }

  function numberAlt (s, ptr, res, integer) {
    let t = integer ? 'number & Schema.Int' : 'number'
    if (s.minimum !== undefined && finite(s.minimum)) { t += ` & Schema.Min<${s.minimum}>`; carried.push(`${ptr}/minimum`) } else if (s.minimum !== undefined) res.minimum = s.minimum
    if (s.maximum !== undefined && finite(s.maximum)) { t += ` & Schema.Max<${s.maximum}>`; carried.push(`${ptr}/maximum`) } else if (s.maximum !== undefined) res.maximum = s.maximum
    // The draft-04 boolean forms, and anything else odd, stay in the residual.
    if (s.exclusiveMinimum !== undefined && finite(s.exclusiveMinimum)) { t += ` & Schema.Above<${s.exclusiveMinimum}>`; carried.push(`${ptr}/exclusiveMinimum`) } else if (s.exclusiveMinimum !== undefined) res.exclusiveMinimum = s.exclusiveMinimum
    if (s.exclusiveMaximum !== undefined && finite(s.exclusiveMaximum)) { t += ` & Schema.Below<${s.exclusiveMaximum}>`; carried.push(`${ptr}/exclusiveMaximum`) } else if (s.exclusiveMaximum !== undefined) res.exclusiveMaximum = s.exclusiveMaximum
    // Floating-point multiples are decided differently by every engine.
    if (s.multipleOf !== undefined && Number.isInteger(s.multipleOf) && s.multipleOf >= 1) { t += ` & Schema.MultipleOf<${s.multipleOf}>`; carried.push(`${ptr}/multipleOf`) } else if (s.multipleOf !== undefined) res.multipleOf = s.multipleOf
    return t
  }

  // The object alternative. Property subschemas' residuals go under
  // res.properties; when additionalProperties cannot be carried it goes to the
  // residual with every declared property name, since it applies to the keys
  // not among them.
  function objectAlt (s, ptr, res, keys) {
    const props = s.properties
    const required = s.required
    const propsOk = props === undefined || (typeof props === 'object' && props !== null && !Array.isArray(props))
    const reqOk = required === undefined || (Array.isArray(required) && required.every((k) => typeof k === 'string'))
    if (!propsOk || !reqOk) {
      if (props !== undefined) res.properties = props
      if (required !== undefined) res.required = required
      if (s.additionalProperties !== undefined) res.additionalProperties = s.additionalProperties
      return UNIVERSAL.object
    }
    const names = props ? Object.keys(props) : []
    if (names.includes('__proto__')) return fail('a property named __proto__ is not carried', `${ptr}/properties`)
    const req = new Set(required || [])
    const members = []
    const propRes = {}
    for (const k of names) {
      const r = conv(props[k], `${ptr}/properties/${k}`)
      members.push(`${JSON.stringify(k)}${req.has(k) ? '' : '?'}: ${render(r.t)}`)
      if (r.res !== null) propRes[k] = r.res
    }
    for (const k of req) if (!names.includes(k)) members.push(`${JSON.stringify(k)}: unknown`)
    if (props !== undefined) carried.push(`${ptr}/properties`)
    if (required !== undefined) carried.push(`${ptr}/required`)
    const ap = s.additionalProperties
    const apCarried = ap === undefined || ap === true || (ap === false && !keys.includes('patternProperties'))
    let t = members.length ? `{ ${members.join('; ')} }` : UNIVERSAL.object
    if (apCarried) {
      if (ap === false) { t = `${members.length ? t : '{}'} & Schema.Strict`; carried.push(`${ptr}/additionalProperties`) }
      if (Object.keys(propRes).length) res.properties = propRes
    } else {
      // The residual needs the declared names to know which keys are additional.
      res.additionalProperties = ap
      const all = {}
      for (const k of names) all[k] = Object.prototype.hasOwnProperty.call(propRes, k) ? propRes[k] : true
      if (names.length) res.properties = all
    }
    return t
  }

  function arrayAlt (s, ptr, res) {
    let t
    if (Array.isArray(s.items)) {
      // The draft-07 tuple form; its keywords stay together in the residual.
      for (const k of [...ARRAY_KEYS, 'additionalItems']) if (s[k] !== undefined) res[k] = s[k]
      return UNIVERSAL.array
    }
    if (s.prefixItems !== undefined) {
      // Bun checks a tuple of fixed length only; the schema allows a shorter
      // array unless minItems says otherwise, and a longer one unless items is
      // false. The tuple is carried when both agree with it; otherwise the
      // array keywords stay together in the residual.
      const fixed = Array.isArray(s.prefixItems) && s.items === false && s.minItems === s.prefixItems.length && (s.maxItems === undefined || s.maxItems >= s.prefixItems.length)
      if (!fixed) {
        for (const k of ARRAY_KEYS) if (s[k] !== undefined) res[k] = s[k]
        return UNIVERSAL.array
      }
      const parts = []
      const prefRes = []
      let anyRes = false
      s.prefixItems.forEach((p, i) => { const r = conv(p, `${ptr}/prefixItems/${i}`); parts.push(render(r.t)); prefRes.push(r.res === null ? true : r.res); if (r.res !== null) anyRes = true })
      if (anyRes) res.prefixItems = prefRes
      carried.push(`${ptr}/prefixItems`, `${ptr}/items`, `${ptr}/minItems`)
      if (s.maxItems !== undefined) carried.push(`${ptr}/maxItems`)
      return `[${parts.join(', ')}]`
    }
    if (s.items === undefined || s.items === true) t = UNIVERSAL.array
    else if (s.items === false) { t = '[]'; carried.push(`${ptr}/items`) } else {
      const r = conv(s.items, `${ptr}/items`)
      const it = render(r.t)
      t = /[&| ]/.test(it) ? `(${it})[]` : `${it}[]`
      if (r.res !== null) res.items = r.res
      carried.push(`${ptr}/items`)
    }
    if (s.minItems !== undefined && finite(s.minItems)) { t += ` & Schema.MinItems<${s.minItems}>`; carried.push(`${ptr}/minItems`) } else if (s.minItems !== undefined) res.minItems = s.minItems
    if (s.maxItems !== undefined && finite(s.maxItems)) { t += ` & Schema.MaxItems<${s.maxItems}>`; carried.push(`${ptr}/maxItems`) } else if (s.maxItems !== undefined) res.maxItems = s.maxItems
    return t
  }

  function hasAny (s, keys) { return keys.some((k) => s[k] !== undefined) }
  function keysOf (kind) { return kind === 'string' ? STRING_KEYS : kind === 'number' || kind === 'integer' ? NUMBER_KEYS : kind === 'object' ? OBJECT_KEYS : kind === 'array' ? ARRAY_KEYS : [] }

  // The alternatives for one named kind, with the rules of that kind.
  function kindAlt (kind, s, ptr, res, keys) {
    switch (kind) {
      case 'string': return single('string', stringAlt(s, ptr, res))
      case 'number': return single('number', numberAlt(s, ptr, res, false))
      case 'integer': return single('number', numberAlt(s, ptr, res, true))
      case 'boolean': return single('boolean', 'boolean')
      case 'null': return single('null', 'null')
      case 'object': return single('object', objectAlt(s, ptr, res, keys))
      case 'array': return single('array', arrayAlt(s, ptr, res))
      default: return null
    }
  }

  // Everything at this node into the residual, the type `unknown`.
  function whole (s) { const res = {}; for (const k of Object.keys(s)) if (!IGNORED.has(k)) res[k] = s[k]; return { t: universal(), res: Object.keys(res).length ? res : null } }

  function conv (s, ptr) {
    if (s === true) return { t: universal(), res: null }
    if (s === false) return { t: empty(), res: null }
    if (!isSchema(s)) return fail('a schema must be an object or a boolean', ptr)
    if (++depth > 200) return fail('the schema nests too deep', ptr)
    try {
      const keys = Object.keys(s).filter((k) => !IGNORED.has(k))
      if (keys.length === 0) return { t: universal(), res: null }
      for (const k of keys) if (WHOLE_NODE.has(k)) return k.startsWith('$') ? fail(`keyword ${JSON.stringify(k)} is not carried`, ptr) : whole(s)
      const res = {}
      for (const k of keys) if (!TYPED.has(k)) res[k] = s[k]
      let t = universal()

      if (s.$ref !== undefined) {
        if (typeof s.$ref !== 'string') return fail('$ref must be a string', ptr)
        const target = resolveRef(s.$ref, ptr)
        const n = alias(target)
        const aliasT = empty(); aliasT.alias.push(n)
        carried.push(`${ptr}/$ref`)
        if (target.pointer === '#') rootRefSeen = true
        const defRes = target.pointer === '#' ? (rootHasResidual ? { $ref: '#' } : null) : defResiduals.get(target.pointer)
        // The residual's reference goes to the definition's residual, kept
        // under its own name beside the original definitions.
        if (defRes !== null && defRes !== undefined) res.$ref = target.pointer === '#' ? '#' : `#/${target.pointer.split('/')[1]}/${restKey(target.key)}`
        if (refOverrides) { for (const k of keys) if (k !== '$ref') delete res[k] }
        if (keys.length === 1 || refOverrides) return { t: aliasT, res: Object.keys(res).length ? res : null }
        // Siblings beside $ref are conjunctive. The alias cannot be
        // intersected, so the siblings' rules stay in the residual and the
        // type is the alias.
        for (const k of keys) if (k !== '$ref' && TYPED.has(k)) res[k] = s[k]
        return { t: aliasT, res }
      }

      if (s.const !== undefined || s.enum !== undefined) {
        let lit = null
        if (s.const !== undefined && s.enum === undefined) lit = literalOf(s.const)
        else if (s.enum !== undefined && s.const === undefined && Array.isArray(s.enum) && s.enum.length > 0) {
          lit = empty()
          for (const v of s.enum) { const l = literalOf(v); if (l === null) { lit = null; break } lit = union(lit, l) }
        }
        if (lit === null) {
          if (s.const !== undefined) res.const = s.const
          if (s.enum !== undefined) res.enum = s.enum
        } else {
          t = lit
          carried.push(s.const !== undefined ? `${ptr}/const` : `${ptr}/enum`)
        }
        // The literal says everything about the value; the other rules at this
        // node would have to be checked against it, which the residual does.
        for (const k of ['type', ...CONSTRAINT_KEYS]) if (s[k] !== undefined) res[k] = s[k]
        return finish(t, res, s, ptr)
      }

      if (s.type !== undefined) {
        const types = Array.isArray(s.type) ? s.type : [s.type]
        const known = types.every((k) => KINDS.includes(k) || k === 'integer')
        if (types.length === 0 || !known) {
          for (const k of ['type', ...CONSTRAINT_KEYS]) if (s[k] !== undefined) res[k] = s[k]
          return finish(universal(), res, s, ptr)
        }
        carried.push(`${ptr}/type`)
        t = empty()
        for (const k of types) t = union(t, kindAlt(k, s, ptr, res, keys))
        // A rule for a kind the type does not name binds nothing; it is kept
        // in the residual rather than dropped, so nothing is ever lost.
        const allowed = new Set(types.flatMap(keysOf))
        for (const k of CONSTRAINT_KEYS) if (s[k] !== undefined && !allowed.has(k)) res[k] = s[k]
      } else if (hasAny(s, CONSTRAINT_KEYS)) {
        // A rule without a type binds only the values of its kind: {minLength:
        // 1} accepts every number, object and array. The six kinds, each with
        // the rules of its own kind, say exactly that.
        t = empty()
        for (const k of KINDS) t = union(t, hasAny(s, keysOf(k)) ? kindAlt(k, s, ptr, res, keys) : single(k, UNIVERSAL[k]))
      }
      return finish(t, res, s, ptr)
    } finally {
      depth--
    }
  }

  // anyOf and allOf on top of the node's own type, then the residual.
  function finish (t, res, s, ptr) {
    if (s.allOf !== undefined) {
      if (Array.isArray(s.allOf) && s.allOf.length > 0) {
        const rest = []
        s.allOf.forEach((b, i) => {
          const r = conv(b, `${ptr}/allOf/${i}`)
          const m = intersect(t, r.t)
          if (m === null) { rest.push(b) } else { t = m; if (r.res !== null) rest.push(r.res) }
        })
        if (rest.length) res.allOf = rest
        carried.push(`${ptr}/allOf`)
      } else res.allOf = s.allOf
    }
    if (s.anyOf !== undefined) {
      if (Array.isArray(s.anyOf) && s.anyOf.length > 0) {
        let u = empty()
        let clean = true
        for (let i = 0; i < s.anyOf.length; i++) {
          const r = conv(s.anyOf[i], `${ptr}/anyOf/${i}`)
          if (r.res !== null) { clean = false; break }
          u = union(u, r.t)
        }
        const m = clean ? intersect(t, u) : null
        if (m !== null) { t = m; carried.push(`${ptr}/anyOf`) } else res.anyOf = s.anyOf
      } else res.anyOf = s.anyOf
    }
    return { t, res: Object.keys(res).length ? res : null }
  }

  aliasByPointer.set('#', name)
  let r = conv(root, '#')
  if (r.res !== null && rootRefSeen) { rootHasResidual = true; r = conv(root, '#') }
  let residual = r.res
  if (residual !== null) {
    // Subschemas the residual copies as they are may refer to any definition,
    // so the definitions travel whole; the residuals of definitions the split
    // refers to travel beside them under their own names.
    const text = JSON.stringify(residual)
    if (/"\$ref":"#"/.test(text) && !rootHasResidual) return fail('a rule the type cannot carry refers to the root', '#')
    for (const bucket of ['$defs', 'definitions']) {
      if (root[bucket] && typeof root[bucket] === 'object' && text.includes(`"#/${bucket}/`)) residual[bucket] = { ...root[bucket] }
    }
    for (const [pointer, v] of defResiduals.entries()) {
      if (v === null) continue
      const m = /^#\/(\$defs|definitions)\/(.+)$/.exec(pointer)
      residual[m[1]] = residual[m[1]] || {}
      residual[m[1]][restKey(decodeURIComponent(m[2].replace(/~1/g, '/').replace(/~0/g, '~')))] = v
    }
    if (typeof root.$schema === 'string') residual = { $schema: root.$schema, ...residual }
  }
  if (isUniversal(r.t)) return fail('the type carries nothing of the schema', '#')
  return { name, type: render(r.t), aliases, residual, carried }
}

// The TypeScript module `ata build --target bun` writes beside the plain one.
// `residualImport` names the module of the residual schema, when there is one.
function toBunModule ({ schemaFile, moduleImport, residualImport, typeName: tn, typeSource, aliases }) {
  const lines = []
  lines.push(`// Generated by ata build --target bun from ${schemaFile}. Do not edit.`)
  lines.push('//')
  lines.push('// For executables built with `bun build --compile --aot`: the rules of the')
  lines.push('// schema as a type that Bun\'s compiler checks in machine code' + (residualImport ? ', the rules a' : '.'))
  if (residualImport) lines.push(`// type cannot carry checked by ${residualImport}, written from the rest of the schema.`)
  lines.push(`// Where either refuses, the plain module (${moduleImport}) decides and supplies the`)
  lines.push('// errors, so every answer is the module\'s. Everywhere else, including plain')
  lines.push('// `bun run`, import the plain module instead.')
  lines.push("import { validate as _check } from 'bun:bundle'")
  lines.push("import { JSON as _JSON } from 'bun'")
  lines.push("import type { Schema } from 'bun'")
  lines.push(`import * as _m from ${JSON.stringify(moduleImport)}`)
  if (residualImport) lines.push(`import * as _r from ${JSON.stringify(residualImport)}`)
  lines.push('')
  for (const [n, src] of aliases) lines.push(`type ${n} = ${src}`)
  lines.push(`export type ${tn} = ${typeSource}`)
  lines.push('')
  const rest = residualImport ? ' && _r.isValid(d)' : ''
  lines.push(`export function isValid (d: unknown): d is ${tn} {`)
  lines.push(`  try { _check<${tn}>(d) } catch { return _m.isValid(d) }`)
  lines.push(`  return true${rest}`)
  lines.push('}')
  lines.push('export function validate (d: unknown): ReturnType<typeof _m.validate> {')
  lines.push(`  try { _check<${tn}>(d) } catch { return _m.validate(d) }`)
  if (residualImport) lines.push('  if (!_r.isValid(d)) return _m.validate(d)')
  lines.push('  return { valid: true, errors: [] } as unknown as ReturnType<typeof _m.validate>')
  lines.push('}')
  lines.push('// The parsed document when the text is JSON and the document is valid, else null.')
  lines.push(`export function parse (text: string): ${tn} | null {`)
  lines.push(`  try { const d = _JSON.parse<${tn}>(text); return ${residualImport ? '_r.isValid(d) ? d : null' : 'd'} } catch {}`)
  lines.push('  let d: unknown')
  lines.push('  try { d = JSON.parse(text) } catch { return null }')
  lines.push(`  return _m.isValid(d) ? (d as ${tn}) : null`)
  lines.push('}')
  lines.push('')
  return lines.join('\n')
}

// Writes the Bun target for one compiled module: the `.bun.ts` beside it and,
// when the type does not carry the whole schema, the residual's module beside
// both. Returns what was written; throws Declined when the split cannot be
// made (a remote $ref, a dynamic reference, nothing the type can carry).
function writeBunTarget ({ schema, input, output, typeName: tn, format }) {
  const fs = require('fs')
  const path = require('path')
  const mapped = schemaToBunType(schema, { name: tn })
  const ext = path.extname(output)
  const base = output.slice(0, output.length - ext.length)
  const bunPath = base + '.bun.ts'
  let residualPath = null
  let residualKeywords = 0
  if (mapped.residual !== null) {
    const { Validator } = require('..')
    const aot = require('./aot')
    const fmt = format === 'cjs' ? 'cjs' : 'esm'
    residualPath = base + (fmt === 'cjs' ? '.rest.cjs' : '.rest.mjs')
    let src = null
    try { src = aot.toStandaloneModule(new Validator(mapped.residual, {}), { format: fmt }) } catch (e) { throw new Declined(`the rest of the schema does not compile standalone (${e.message})`, '#') }
    if (!src) throw new Declined('the rest of the schema does not compile standalone', '#')
    fs.writeFileSync(residualPath, src)
    residualKeywords = countKeywords(mapped.residual)
  }
  fs.writeFileSync(bunPath, toBunModule({
    schemaFile: path.relative(process.cwd(), input) || input,
    moduleImport: './' + path.basename(output),
    residualImport: residualPath ? './' + path.basename(residualPath) : null,
    typeName: mapped.name,
    typeSource: mapped.type,
    aliases: mapped.aliases,
  }))
  return { bunPath, residualPath, definitions: mapped.aliases.length, carried: mapped.carried.length, residualKeywords }
}

// The validation keywords in a residual, for the build's report.
function countKeywords (s) {
  if (typeof s !== 'object' || s === null) return 0
  if (Array.isArray(s)) return s.reduce((n, x) => n + countKeywords(x), 0)
  let n = 0
  for (const k of Object.keys(s)) {
    if (IGNORED.has(k) && k !== '$defs' && k !== 'definitions') continue
    if (['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas'].includes(k)) { for (const v of Object.values(s[k] || {})) n += countKeywords(v); continue }
    if (['items', 'prefixItems', 'allOf', 'anyOf', 'oneOf', 'not', 'if', 'then', 'else', 'contains', 'additionalProperties', 'propertyNames', 'unevaluatedProperties', 'unevaluatedItems'].includes(k)) { n += (typeof s[k] === 'object' ? countKeywords(s[k]) : 0) + (['items', 'prefixItems', 'allOf', 'anyOf', 'properties'].includes(k) ? 0 : 1); continue }
    n++
  }
  return n
}

module.exports = { schemaToBunType, toBunModule, writeBunTarget, Declined }
