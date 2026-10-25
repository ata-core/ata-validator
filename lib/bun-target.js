'use strict'
// `ata build --target bun`: the schema's rules as a TypeScript type for Bun's
// `validate<T>()` and `JSON.parse<T>()`, written with Bun's `Schema` tags, so
// that `bun build --compile --aot` checks them in machine code.
//
// The one rule: the type is never looser than the schema. The generated
// module asks the plain compiled module whenever the type refuses, so a type
// that is stricter than the schema costs time and nothing else, while a type
// that omits a rule would accept what the schema refuses. Every keyword this
// file cannot carry exactly therefore declines the whole schema, with the
// reason and the pointer, and the build writes the plain module alone.
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
const KNOWN = new Set(['type', 'enum', 'const', 'anyOf', 'allOf', '$ref', ...CONSTRAINT_KEYS])
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

// The six sets. `alias` is a named type standing for a whole schema; it joins
// a union as a name and declines an intersection, whose members it would
// have to be distributed over.
function empty () { return { string: [], number: [], boolean: [], null: [], object: [], array: [], alias: [] } }
function universal () { const t = empty(); for (const k of KINDS) t[k].push(UNIVERSAL[k]); return t }
function single (kind, alt) { const t = empty(); t[kind].push(alt); return t }
function union (a, b) { const t = empty(); for (const k of [...KINDS, 'alias']) t[k] = dedupe([...a[k], ...b[k]]); return t }
function dedupe (xs) { return xs.filter((x, i) => xs.indexOf(x) === i) }

function intersect (a, b, ptr) {
  if (a.alias.length || b.alias.length) return fail('a $ref inside allOf, or beside other rules, is not carried', ptr)
  const t = empty()
  for (const k of KINDS) {
    for (const x of a[k]) {
      for (const y of b[k]) {
        const z = meet(k, x, y, ptr)
        if (z !== null) t[k].push(z)
      }
    }
    t[k] = dedupe(t[k])
  }
  return t
}

// Two alternatives of one kind, or null when no value satisfies both.
function meet (kind, x, y, ptr) {
  if (x === UNIVERSAL[kind]) return y
  if (y === UNIVERSAL[kind]) return x
  if (x === y) return x
  const xl = isLiteral(x), yl = isLiteral(y)
  if (xl && yl) return null
  if (xl || yl) return fail('a literal beside a rule of its own kind is not carried', ptr)
  switch (kind) {
    case 'string': return `${x} & ${y.replace(/^string & /, '')}`
    case 'number': return `${x} & ${y.replace(/^number & /, '')}`
    case 'object':
      // Strict on one member of an intersection would have to see the
      // others' properties; whether Bun does is not pinned down.
      if (/Schema\.Strict\b/.test(x) || /Schema\.Strict\b/.test(y)) return fail('additionalProperties: false inside an intersection is not carried', ptr)
      return `${x} & ${y}`
    case 'array': return fail('two array rules in an intersection are not carried', ptr)
    default: return null
  }
}

// Bun's Pattern runs the expression without the unicode flag; JSON Schema's
// patterns are read with it. The two agree on what they accept unless an atom
// that can match half of a surrogate pair is counted: `^.{2}$` accepts one
// astral character without the flag and refuses it with it. The expressions
// carried are the ones where no such atom is counted: ASCII only, no escapes
// whose meaning depends on the flag, and `.`, a negated class, `\W`, `\S`
// and `\D` only under a greedy `+` or `*`. Returns null when the pattern is
// carried, else what rules it out.
function patternDiffers (p) {
  if (!/^[\x20-\x7e]*$/.test(p)) return 'with a character outside ASCII is not carried'
  for (let i = 0; i < p.length; i++) {
    const c = p[i]
    if (c === '\\') {
      const n = p[i + 1]
      if (n === undefined) return 'ending in a backslash is not carried'
      if ('pPuxbBkWSD'.includes(n)) {
        if ('WSD'.includes(n)) { if (!greedyUnbounded(p, i + 2)) return `with \\${n} outside a greedy + or * is not carried` } else return `with \\${n} is not carried`
      }
      i++
      continue
    }
    if (c === '.') { if (!greedyUnbounded(p, i + 1)) return 'with . outside a greedy + or * is not carried'; continue }
    if (c === '[') {
      const negated = p[i + 1] === '^'
      let j = i + 1 + (negated ? 1 : 0)
      if (p[j] === ']') j++
      for (; j < p.length && p[j] !== ']'; j++) {
        if (p[j] === '\\') {
          const n = p[j + 1]
          if ('pPuxWSDkbB'.includes(n || '')) return `with \\${n} in a class is not carried`
          j++
        }
      }
      if (j >= p.length) return 'with an unclosed class is not carried'
      if (negated && !greedyUnbounded(p, j + 1)) return 'with a negated class outside a greedy + or * is not carried'
      i = j
    }
  }
  return null
}
function greedyUnbounded (p, i) { return (p[i] === '+' || p[i] === '*') && p[i + 1] !== '?' }

function isLiteral (alt) { return /^(".*"|-?[0-9.eE+-]+|true|false|null)$/.test(alt) }

function render (t) {
  const alts = [...KINDS.flatMap((k) => t[k]), ...t.alias]
  if (alts.length === 0) return 'never'
  if (KINDS.every((k) => t[k].length === 1 && t[k][0] === UNIVERSAL[k]) && t.alias.length === 0) return 'unknown'
  if (alts.length === 1) return alts[0]
  return alts.map((a) => /[&|]/.test(a) ? `(${a})` : a).join(' | ')
}

function literalOf (v, ptr) {
  if (typeof v === 'string') return single('string', JSON.stringify(v))
  if (typeof v === 'number') return Number.isFinite(v) ? single('number', String(v)) : fail('a non-finite number has no literal type', ptr)
  if (typeof v === 'boolean') return single('boolean', String(v))
  if (v === null) return single('null', 'null')
  return fail('an object or array literal cannot be a literal type', ptr)
}

function numberTag (name, v, ptr) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return fail(`${name} must be a finite number`, ptr)
  return String(v)
}

// `name` must be an identifier TypeScript accepts.
function typeName (key, taken) {
  let base = key.replace(/[^A-Za-z0-9_$]/g, '_').replace(/^([0-9])/, '_$1') || 'Def'
  base = base.replace(/^([a-z])/, (m) => m.toUpperCase())
  let name = base
  for (let i = 2; taken.has(name); i++) name = base + i
  taken.add(name)
  return name
}

// The type for `schema`, or a Declined error describing the first keyword the
// type cannot carry. Returns { name, type, aliases }, `type` the source of the
// root type and `aliases` the [name, source] definitions it refers to.
function schemaToBunType (root, opts = {}) {
  const taken = new Set()
  const name = typeName(opts.name || 'Data', taken)
  const aliases = []
  const aliasByPointer = new Map()
  let depth = 0

  function resolveRef (ref, ptr) {
    if (ref === '#') return { pointer: '#', schema: root, key: 'Root' }
    const m = /^#\/(\$defs|definitions)\/([^/]+)$/.exec(ref)
    if (!m) return fail(`$ref ${JSON.stringify(ref)} is not a local definition`, ptr)
    const key = decodeURIComponent(m[2].replace(/~1/g, '/').replace(/~0/g, '~'))
    const defs = root[m[1]]
    if (!defs || typeof defs !== 'object' || !Object.prototype.hasOwnProperty.call(defs, key)) return fail(`$ref ${JSON.stringify(ref)} does not resolve`, ptr)
    return { pointer: `#/${m[1]}/${m[2]}`, schema: defs[key], key }
  }

  function alias (target) {
    if (aliasByPointer.has(target.pointer)) return aliasByPointer.get(target.pointer)
    const n = target.pointer === '#' ? name : typeName(target.key, taken)
    aliasByPointer.set(target.pointer, n)
    if (target.pointer !== '#') aliases.push([n, render(conv(target.schema, target.pointer))])
    return n
  }

  function stringAlt (s, ptr) {
    let t = 'string'
    if (s.minLength !== undefined) t += ` & Schema.MinLength<${numberTag('minLength', s.minLength, ptr)}>`
    if (s.maxLength !== undefined) t += ` & Schema.MaxLength<${numberTag('maxLength', s.maxLength, ptr)}>`
    if (s.pattern !== undefined) {
      if (typeof s.pattern !== 'string') return fail('pattern must be a string', ptr)
      const why = patternDiffers(s.pattern)
      if (why) return fail(`pattern ${why}`, `${ptr}/pattern`)
      t += ` & Schema.Pattern<${JSON.stringify(s.pattern)}>`
    }
    return t
  }

  function numberAlt (s, ptr, integer) {
    let t = integer ? 'number & Schema.Int' : 'number'
    if (s.minimum !== undefined) t += ` & Schema.Min<${numberTag('minimum', s.minimum, ptr)}>`
    if (s.maximum !== undefined) t += ` & Schema.Max<${numberTag('maximum', s.maximum, ptr)}>`
    if (s.exclusiveMinimum !== undefined) {
      if (typeof s.exclusiveMinimum === 'boolean') return fail('a boolean exclusiveMinimum (draft-04 form) is not carried', ptr)
      t += ` & Schema.Above<${numberTag('exclusiveMinimum', s.exclusiveMinimum, ptr)}>`
    }
    if (s.exclusiveMaximum !== undefined) {
      if (typeof s.exclusiveMaximum === 'boolean') return fail('a boolean exclusiveMaximum (draft-04 form) is not carried', ptr)
      t += ` & Schema.Below<${numberTag('exclusiveMaximum', s.exclusiveMaximum, ptr)}>`
    }
    if (s.multipleOf !== undefined) {
      // Floating-point multiples are decided differently by every engine.
      if (!Number.isInteger(s.multipleOf) || s.multipleOf < 1) return fail('multipleOf is carried for positive integers only', ptr)
      t += ` & Schema.MultipleOf<${s.multipleOf}>`
    }
    return t
  }

  function objectAlt (s, ptr) {
    const props = s.properties
    const required = s.required
    if (props !== undefined && (typeof props !== 'object' || props === null || Array.isArray(props))) return fail('properties must be an object', ptr)
    if (required !== undefined && !Array.isArray(required)) return fail('required must be an array', ptr)
    const ap = s.additionalProperties
    if (ap !== undefined && ap !== false && ap !== true) return fail('additionalProperties with a schema is not carried', `${ptr}/additionalProperties`)
    const req = new Set(required || [])
    const members = []
    const names = props ? Object.keys(props) : []
    for (const k of names) {
      if (k === '__proto__') return fail('a property named __proto__ is not carried', `${ptr}/properties`)
      const t = render(conv(props[k], `${ptr}/properties/${k}`))
      members.push(`${JSON.stringify(k)}${req.has(k) ? '' : '?'}: ${t}`)
    }
    for (const k of req) {
      if (typeof k !== 'string') return fail('required must name strings', `${ptr}/required`)
      if (!names.includes(k)) members.push(`${JSON.stringify(k)}: unknown`)
    }
    let t = members.length ? `{ ${members.join('; ')} }` : UNIVERSAL.object
    if (ap === false) t = `${members.length ? t : '{}'} & Schema.Strict`
    return t
  }

  function arrayAlt (s, ptr) {
    if (s.prefixItems !== undefined) {
      if (!Array.isArray(s.prefixItems)) return fail('prefixItems must be an array', ptr)
      // Bun checks a tuple of fixed length only; the schema allows a shorter
      // array unless minItems says otherwise, and a longer one unless items is
      // false. Both have to agree with the tuple, or the type is not exact.
      if (s.items !== false) return fail('prefixItems without items: false is not a fixed tuple', ptr)
      if (s.minItems !== s.prefixItems.length) return fail('a tuple needs minItems equal to its length', ptr)
      if (s.maxItems !== undefined && s.maxItems < s.prefixItems.length) return fail('maxItems shorter than the tuple', ptr)
      const parts = s.prefixItems.map((p, i) => render(conv(p, `${ptr}/prefixItems/${i}`)))
      return `[${parts.join(', ')}]`
    }
    let t
    if (s.items === undefined || s.items === true) t = UNIVERSAL.array
    else if (s.items === false) t = '[]'
    else {
      const it = render(conv(s.items, `${ptr}/items`))
      t = /[&| ]/.test(it) ? `(${it})[]` : `${it}[]`
    }
    if (s.minItems !== undefined) t += ` & Schema.MinItems<${numberTag('minItems', s.minItems, ptr)}>`
    if (s.maxItems !== undefined) t += ` & Schema.MaxItems<${numberTag('maxItems', s.maxItems, ptr)}>`
    return t
  }

  function hasAny (s, keys) { return keys.some((k) => s[k] !== undefined) }

  // The alternatives for one named kind, with the rules of that kind.
  function kindAlt (kind, s, ptr) {
    switch (kind) {
      case 'string': return single('string', stringAlt(s, ptr))
      case 'number': return single('number', numberAlt(s, ptr, false))
      case 'integer': return single('number', numberAlt(s, ptr, true))
      case 'boolean': return single('boolean', 'boolean')
      case 'null': return single('null', 'null')
      case 'object': return single('object', objectAlt(s, ptr))
      case 'array': return single('array', arrayAlt(s, ptr))
      default: return fail(`type ${JSON.stringify(kind)} is not carried`, ptr)
    }
  }

  function conv (s, ptr) {
    if (s === true) return universal()
    if (s === false) return empty()
    if (typeof s !== 'object' || s === null || Array.isArray(s)) return fail('a schema must be an object or a boolean', ptr)
    if (++depth > 200) return fail('the schema nests too deep', ptr)
    try {
      const keys = Object.keys(s).filter((k) => !IGNORED.has(k))
      for (const k of keys) if (!KNOWN.has(k)) return fail(`keyword ${JSON.stringify(k)} is not carried`, ptr)
      if (keys.length === 0) return universal()
      if (s.$ref !== undefined) {
        if (keys.length > 1) return fail('keywords beside $ref are not carried', ptr)
        if (typeof s.$ref !== 'string') return fail('$ref must be a string', ptr)
        const t = empty()
        t.alias.push(alias(resolveRef(s.$ref, ptr)))
        return t
      }
      let t = universal()
      if (s.const !== undefined || s.enum !== undefined) {
        // A literal already says everything; another rule beside it would have
        // to be checked against the literal, which nothing here does.
        if (hasAny(s, CONSTRAINT_KEYS) || s.type !== undefined) return fail('const or enum beside other rules is not carried', ptr)
        if (s.const !== undefined && s.enum !== undefined) return fail('const and enum together are not carried', ptr)
        if (s.const !== undefined) t = literalOf(s.const, ptr)
        else {
          if (!Array.isArray(s.enum) || s.enum.length === 0) return fail('enum must be a non-empty array', ptr)
          t = empty()
          for (const v of s.enum) t = union(t, literalOf(v, `${ptr}/enum`))
        }
      } else if (s.type !== undefined) {
        const types = Array.isArray(s.type) ? s.type : [s.type]
        if (types.length === 0) return fail('type must name a type', ptr)
        // A rule for a kind the type does not name binds nothing in the
        // schema and nothing in the type; it is refused rather than dropped.
        const allowed = new Set()
        for (const k of types) {
          if (k === 'string') STRING_KEYS.forEach((x) => allowed.add(x))
          if (k === 'number' || k === 'integer') NUMBER_KEYS.forEach((x) => allowed.add(x))
          if (k === 'object') OBJECT_KEYS.forEach((x) => allowed.add(x))
          if (k === 'array') ARRAY_KEYS.forEach((x) => allowed.add(x))
        }
        for (const k of CONSTRAINT_KEYS) if (s[k] !== undefined && !allowed.has(k)) return fail(`${k} beside type ${JSON.stringify(s.type)} is not carried`, ptr)
        t = empty()
        for (const k of types) t = union(t, kindAlt(k, s, ptr))
      } else if (hasAny(s, CONSTRAINT_KEYS)) {
        // A rule without a type binds only the values of its kind: {minLength:
        // 1} accepts every number, object and array. The six kinds, each with
        // the rules of its own kind, say exactly that.
        t = empty()
        for (const k of KINDS) t = union(t, hasAny(s, k === 'string' ? STRING_KEYS : k === 'number' ? NUMBER_KEYS : k === 'object' ? OBJECT_KEYS : k === 'array' ? ARRAY_KEYS : []) ? kindAlt(k, s, ptr) : single(k, UNIVERSAL[k]))
      }
      if (s.anyOf !== undefined) {
        if (!Array.isArray(s.anyOf) || s.anyOf.length === 0) return fail('anyOf must be a non-empty array', ptr)
        let u = empty()
        s.anyOf.forEach((b, i) => { u = union(u, conv(b, `${ptr}/anyOf/${i}`)) })
        t = intersect(t, u, ptr)
      }
      if (s.allOf !== undefined) {
        if (!Array.isArray(s.allOf) || s.allOf.length === 0) return fail('allOf must be a non-empty array', ptr)
        s.allOf.forEach((b, i) => { t = intersect(t, conv(b, `${ptr}/allOf/${i}`), ptr) })
      }
      return t
    } finally {
      depth--
    }
  }

  aliasByPointer.set('#', name)
  const type = render(conv(root, '#'))
  return { name, type, aliases }
}

// The TypeScript module `ata build --target bun` writes beside the plain one.
function toBunModule ({ schemaFile, moduleImport, typeName: tn, typeSource, aliases }) {
  const lines = []
  lines.push(`// Generated by ata build --target bun from ${schemaFile}. Do not edit.`)
  lines.push('//')
  lines.push('// For executables built with `bun build --compile --aot`: the rules of the')
  lines.push('// schema as a type that Bun\'s compiler checks in machine code. Where the')
  lines.push(`// type refuses, the plain module (${moduleImport}) decides and supplies the`)
  lines.push('// errors, so every answer is the module\'s. Everywhere else, including plain')
  lines.push('// `bun run`, import the plain module instead.')
  lines.push("import { validate as _check } from 'bun:bundle'")
  lines.push("import { JSON as _JSON } from 'bun'")
  lines.push("import type { Schema } from 'bun'")
  lines.push(`import * as _m from ${JSON.stringify(moduleImport)}`)
  lines.push('')
  for (const [n, src] of aliases) lines.push(`type ${n} = ${src}`)
  lines.push(`export type ${tn} = ${typeSource}`)
  lines.push('')
  lines.push(`export function isValid (d: unknown): d is ${tn} {`)
  lines.push(`  try { _check<${tn}>(d); return true } catch { return _m.isValid(d) }`)
  lines.push('}')
  lines.push('export function validate (d: unknown): ReturnType<typeof _m.validate> {')
  lines.push(`  try { _check<${tn}>(d); return { valid: true, errors: [] } as unknown as ReturnType<typeof _m.validate> } catch { return _m.validate(d) }`)
  lines.push('}')
  lines.push('// The parsed document when the text is JSON and the document is valid, else null.')
  lines.push(`export function parse (text: string): ${tn} | null {`)
  lines.push(`  try { return _JSON.parse<${tn}>(text) } catch {}`)
  lines.push('  let d: unknown')
  lines.push('  try { d = JSON.parse(text) } catch { return null }')
  lines.push(`  return _m.isValid(d) ? (d as ${tn}) : null`)
  lines.push('}')
  lines.push('')
  return lines.join('\n')
}

module.exports = { schemaToBunType, toBunModule, Declined }
