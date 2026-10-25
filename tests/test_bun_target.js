'use strict'
// `ata build --target bun`: the schema as a TypeScript type beside the plain
// module, and, with `tags: true`, the split into a tagged type and a residual
// schema. What is checked here without Bun: the plain type says the shape and
// nothing else, the tagged type carries every rule it claims to, the residual
// holds exactly the rest, the groups that see each other stay whole, the
// written module answers through the plain module, and the CLI writes the
// files. The tagged form's check against Bun's own validator is
// benchmark/proof/aot/suite-differential.mjs, which needs the pull request
// build of 2026-10-24 and runs by hand.
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawnSync } = require('child_process')
const { schemaToBunType, toBunModule, Declined } = require('../lib/bun-target')

const order = {
  type: 'object',
  required: ['customer', 'items'],
  additionalProperties: false,
  properties: {
    customer: {
      type: 'object',
      required: ['id', 'name', 'email'],
      additionalProperties: false,
      properties: {
        id: { type: 'integer', minimum: 1, maximum: 9007199254740991 },
        name: { type: 'string', minLength: 1, maxLength: 100 },
        email: { type: 'string', pattern: '^[^@\\s]+@[^@\\s]+$' }
      }
    },
    items: {
      type: 'array', minItems: 1, maxItems: 100,
      items: {
        type: 'object', required: ['sku', 'quantity', 'unitCents'], additionalProperties: false,
        properties: {
          sku: { type: 'string', minLength: 1, maxLength: 32 },
          quantity: { type: 'integer', minimum: 1, maximum: 1000 },
          unitCents: { type: 'integer', minimum: 0, maximum: 9007199254740991 }
        }
      }
    },
    coupon: { type: 'string', maxLength: 16 }
  }
}

const tagged = (s, opts) => schemaToBunType(s, { ...opts, tags: true })

// The plain type: the shape, no tags, no residual, the module checks the rest.
{
  const r = schemaToBunType(order, { name: 'Order' })
  assert.strictEqual(r.name, 'Order')
  assert.strictEqual(r.residual, null)
  assert.strictEqual(r.type, '{ "customer": { "id": number; "name": string; "email": string }; "items": { "sku": string; "quantity": number; "unitCents": number }[]; "coupon"?: string }')
  assert.ok(!/Schema\./.test(r.type), 'no Schema tags without tags: true')
  const t = (s) => { const m = schemaToBunType(s); assert.strictEqual(m.residual, null); return m.type }
  assert.strictEqual(t({ type: 'string', format: 'email', minLength: 3 }), 'string')
  assert.strictEqual(t({ type: 'integer', minimum: 1 }), 'number')
  assert.strictEqual(t({ type: 'object', additionalProperties: false }), 'Record<string, unknown>')
  assert.strictEqual(t({ type: 'array', items: { type: 'string' }, minItems: 1, uniqueItems: true }), 'string[]')
  assert.strictEqual(t({ enum: ['a', 1, true, null] }), '"a" | 1 | true | null')
  // anyOf is the union of the branches' shapes whatever the branches hold.
  assert.strictEqual(t({ anyOf: [{ type: 'string', format: 'email' }, { type: 'number', minimum: 1 }] }), 'string | number')
  assert.strictEqual(t({ type: 'object', properties: { b: { type: 'object', properties: { a: { type: 'string' } }, unevaluatedProperties: false } } }), '{ "b"?: unknown }')
  assert.strictEqual(t({ type: 'string', pattern: '^.{2}$' }), 'string')
  const list = schemaToBunType({ $defs: { node: { type: 'object', required: ['v'], properties: { v: { type: 'integer' }, next: { $ref: '#/$defs/node' } } } }, $ref: '#/$defs/node' }, { name: 'List' })
  assert.strictEqual(list.type, 'Node')
  assert.deepStrictEqual(list.aliases, [['Node', '{ "v": number; "next"?: Node }']])
}

// The tagged type carries the order whole.
{
  const r = tagged(order, { name: 'Order' })
  assert.strictEqual(r.name, 'Order')
  assert.strictEqual(r.aliases.length, 0)
  assert.strictEqual(r.residual, null, 'every rule of the order is carried by the type')
  const t = r.type
  for (const needle of [
    '"id": number & Schema.Int & Schema.Min<1> & Schema.Max<9007199254740991>',
    '"name": string & Schema.MinLength<1> & Schema.MaxLength<100>',
    '"email": string & Schema.Pattern<"^[^@\\\\s]+@[^@\\\\s]+$">',
    '"sku": string & Schema.MinLength<1> & Schema.MaxLength<32>',
    '"quantity": number & Schema.Int & Schema.Min<1> & Schema.Max<1000>',
    ')[] & Schema.MinItems<1> & Schema.MaxItems<100>',
    '"coupon"?: string & Schema.MaxLength<16>'
  ]) assert.ok(t.includes(needle), `type should carry ${needle}, got:\n${t}`)
  assert.strictEqual((t.match(/Schema\.Strict\b/g) || []).length, 3, 'three closed objects, three Strict tags')
  assert.ok(!/"coupon":/.test(t), 'coupon is optional')
}

// The shapes the tagged type carries, with nothing left over.
{
  const t = (s) => { const r = tagged(s); assert.strictEqual(r.residual, null, `no residual expected for ${JSON.stringify(s)}, got ${JSON.stringify(r.residual)}`); return r.type }
  assert.strictEqual(t({ type: 'null' }), 'null')
  assert.strictEqual(t({ type: ['string', 'null'] }), 'string | null')
  assert.strictEqual(t({ enum: ['a', 1, true, null] }), '"a" | 1 | true | null')
  assert.strictEqual(t({ const: 'x' }), '"x"')
  assert.strictEqual(t({ type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1, multipleOf: 1 }), 'number & Schema.Above<0> & Schema.Below<1> & Schema.MultipleOf<1>')
  assert.strictEqual(t({ type: 'array' }), 'unknown[]')
  assert.strictEqual(t({ type: 'array', items: false }), '[]')
  assert.strictEqual(t({ type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }], items: false, minItems: 2 }), '[string, number]')
  assert.strictEqual(t({ type: 'object' }), 'Record<string, unknown>')
  assert.strictEqual(t({ type: 'object', required: ['a'] }), '{ "a": unknown }')
  assert.strictEqual(t({ type: 'object', additionalProperties: false }), '{} & Schema.Strict')
  assert.strictEqual(t({ anyOf: [{ type: 'string' }, { type: 'number' }] }), 'string | number')
  assert.strictEqual(t({ type: 'string', anyOf: [{ minLength: 1 }, { type: 'number' }] }), 'string & Schema.MinLength<1>')
  assert.strictEqual(t({ type: 'string', anyOf: [{ const: 'a' }, { minLength: 2 }] }), '"a" | (string & Schema.MinLength<2>)')
  assert.strictEqual(t({ allOf: [{ type: 'object', properties: { a: { type: 'number' } } }, { type: 'array' }] }), 'never')
  assert.strictEqual(t({ allOf: [{ const: 'a' }, { const: 'b' }] }), 'never')
  assert.strictEqual(t({ anyOf: [{ const: 'a' }, { const: 'a' }, { const: 1 }] }), '"a" | 1')
  assert.strictEqual(t({ required: ['a'] }), 'string | number | boolean | null | { "a": unknown } | unknown[]')
  assert.strictEqual(t({ minLength: 1 }), '(string & Schema.MinLength<1>) | number | boolean | null | Record<string, unknown> | unknown[]')
  assert.strictEqual(t({ type: 'object', properties: { a: { type: 'string' } }, anyOf: [{ required: ['a'] }] }), '{ "a"?: string } & { "a": unknown }')
  assert.strictEqual(t({ allOf: [{ type: 'object', properties: { a: { type: 'number' } } }, { type: 'object', required: ['a'] }] }), '{ "a"?: number } & { "a": unknown }')
  // Patterns Bun reads the same way with and without the unicode flag.
  assert.strictEqual(t({ type: 'string', pattern: '^[a-z0-9_-]{3,16}$' }), 'string & Schema.Pattern<"^[a-z0-9_-]{3,16}$">')
  assert.strictEqual(t({ type: 'string', pattern: '^\\d+(\\.\\d+)?$' }), 'string & Schema.Pattern<"^\\\\d+(\\\\.\\\\d+)?$">')
  assert.strictEqual(t({ type: 'string', pattern: 'a.*b' }), 'string & Schema.Pattern<"a.*b">')
}

// Definitions become named types, recursion included.
{
  const r = tagged({
    $defs: { node: { type: 'object', required: ['v'], additionalProperties: false, properties: { v: { type: 'integer' }, next: { $ref: '#/$defs/node' } } } },
    $ref: '#/$defs/node'
  }, { name: 'List' })
  assert.strictEqual(r.type, 'Node')
  assert.deepStrictEqual(r.aliases.map((a) => a[0]), ['Node'])
  assert.ok(r.aliases[0][1].includes('"next"?: Node'), r.aliases[0][1])
  assert.strictEqual(r.residual, null)
  const self = tagged({ type: 'object', properties: { again: { $ref: '#' } } }, { name: 'Tree' })
  assert.strictEqual(self.type, '{ "again"?: Tree }')
}

// What the tagged type cannot carry goes to the residual, inside the
// structure needed to reach it, and nothing else goes with it.
{
  const split = (s) => { const r = tagged(s); return { type: r.type, residual: r.residual } }
  assert.deepStrictEqual(split({ type: 'string', format: 'email', minLength: 3 }), { type: 'string & Schema.MinLength<3>', residual: { format: 'email' } })
  // A format ata decides with one regular expression is carried as that expression.
  const { IPV4, DURATION_RE } = require('../lib/formats')
  assert.deepStrictEqual(split({ type: 'string', format: 'ipv4' }), { type: `string & Schema.Pattern<${JSON.stringify(IPV4.source)}>`, residual: null })
  assert.deepStrictEqual(split({ type: 'string', format: 'duration', maxLength: 40 }), { type: `string & Schema.Pattern<${JSON.stringify(DURATION_RE.source)}> & Schema.MaxLength<40>`, residual: null })
  assert.deepStrictEqual(split({ format: 'ipv4' }), { type: `(string & Schema.Pattern<${JSON.stringify(IPV4.source)}>) | number | boolean | null | Record<string, unknown> | unknown[]`, residual: null })
  assert.deepStrictEqual(tagged({ type: 'string', format: 'ipv4' }, { assertFormat: false }).residual, { format: 'ipv4' })
  assert.deepStrictEqual(split({ type: 'string', format: 'uuid' }), { type: 'string', residual: { format: 'uuid' } })
  assert.deepStrictEqual(split({ type: 'object', required: ['email'], properties: { email: { type: 'string', format: 'email' }, n: { type: 'integer' } } }),
    { type: '{ "email": string; "n"?: number & Schema.Int }', residual: { properties: { email: { format: 'email' } } } })
  assert.deepStrictEqual(split({ type: 'array', items: { type: 'string', format: 'uuid' }, uniqueItems: true }),
    { type: 'string[]', residual: { uniqueItems: true, items: { format: 'uuid' } } })
  assert.deepStrictEqual(split({ type: 'string', oneOf: [{ const: 'a' }, { const: 'b' }] }), { type: 'string', residual: { oneOf: [{ const: 'a' }, { const: 'b' }] } })
  assert.deepStrictEqual(split({ type: 'object', not: { required: ['x'] } }), { type: 'Record<string, unknown>', residual: { not: { required: ['x'] } } })
  assert.deepStrictEqual(split({ type: 'object', if: { required: ['a'] }, then: { required: ['b'] }, else: { required: ['c'] } }),
    { type: 'Record<string, unknown>', residual: { if: { required: ['a'] }, then: { required: ['b'] }, else: { required: ['c'] } } })
  // additionalProperties as a schema, or beside patternProperties: it needs the declared names.
  assert.deepStrictEqual(split({ type: 'object', properties: { a: { type: 'string' } }, additionalProperties: { type: 'number' } }),
    { type: '{ "a"?: string }', residual: { additionalProperties: { type: 'number' }, properties: { a: true } } })
  assert.deepStrictEqual(split({ type: 'object', properties: { a: { type: 'string', format: 'date' } }, patternProperties: { '^x': { type: 'number' } }, additionalProperties: false }),
    { type: '{ "a"?: string }', residual: { patternProperties: { '^x': { type: 'number' } }, additionalProperties: false, properties: { a: { format: 'date' } } } })
  // Groups that see each other stay whole.
  assert.deepStrictEqual(split({ type: 'object', properties: { b: { type: 'object', properties: { a: { type: 'string' } }, unevaluatedProperties: false } } }),
    { type: '{ "b"?: unknown }', residual: { properties: { b: { type: 'object', properties: { a: { type: 'string' } }, unevaluatedProperties: false } } } })
  assert.deepStrictEqual(split({ type: 'array', contains: { type: 'string' }, minContains: 2, minItems: 1 }),
    { type: 'unknown[] & Schema.MinItems<1>', residual: { contains: { type: 'string' }, minContains: 2 } })
  // Tuples that are not fixed keep their array keywords together.
  assert.deepStrictEqual(split({ type: 'array', prefixItems: [{ type: 'string' }], minItems: 0 }),
    { type: 'unknown[]', residual: { prefixItems: [{ type: 'string' }], minItems: 0 } })
  // anyOf splits only when no branch has a residual.
  assert.deepStrictEqual(split({ type: 'string', anyOf: [{ format: 'email' }, { minLength: 10 }] }),
    { type: 'string', residual: { anyOf: [{ format: 'email' }, { minLength: 10 }] } })
  // allOf splits per branch.
  assert.deepStrictEqual(split({ allOf: [{ type: 'object', required: ['a'] }, { type: 'object', properties: { a: { type: 'string', format: 'email' } } }] }),
    { type: '{ "a": unknown } & { "a"?: string }', residual: { allOf: [{ properties: { a: { format: 'email' } } }] } })
  // A literal beside other rules: the literal in the type, the rules in the residual.
  assert.deepStrictEqual(split({ type: 'string', enum: ['a', 'b'], minLength: 1 }), { type: '"a" | "b"', residual: { type: 'string', minLength: 1 } })
  // Keywords the split does not know go to the residual as they are.
  assert.deepStrictEqual(split({ type: 'string', 'x-custom': 1, nullable: true }), { type: 'string', residual: { 'x-custom': 1, nullable: true } })
}

// Patterns whose acceptance depends on the unicode flag stay in the residual.
{
  const rp = (p) => tagged({ type: 'string', pattern: p }).residual
  assert.deepStrictEqual(rp('^.{2}$'), { pattern: '^.{2}$' })
  assert.deepStrictEqual(rp('^[^a]$'), { pattern: '^[^a]$' })
  assert.deepStrictEqual(rp('^[^a]+?$'), { pattern: '^[^a]+?$' })
  assert.deepStrictEqual(rp('\\p{L}+'), { pattern: '\\p{L}+' })
  assert.deepStrictEqual(rp('\\S$'), { pattern: '\\S$' })
  assert.deepStrictEqual(rp('^\\u00e9$'), { pattern: '^\\u00e9$' })
  assert.deepStrictEqual(rp('^é$'), { pattern: '^é$' })
  assert.deepStrictEqual(rp('[\\S]+'), { pattern: '[\\S]+' })
  assert.deepStrictEqual(rp('a\\bc'), { pattern: 'a\\bc' })
  assert.strictEqual(tagged({ type: 'string', pattern: '^[^@\\s]+@[^@\\s]+$' }).residual, null)
}

// Definitions' residuals travel with the residual; the dialect goes with it.
{
  const r = tagged({
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    $defs: { mail: { type: 'string', format: 'email' }, n: { type: 'integer' } },
    type: 'object', properties: { a: { $ref: '#/$defs/mail' }, b: { $ref: '#/$defs/n' } }
  }, { name: 'Doc' })
  assert.strictEqual(r.type, '{ "a"?: Mail; "b"?: N }')
  assert.deepStrictEqual(r.residual, {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    properties: { a: { $ref: '#/$defs/__rest__mail' } },
    $defs: { mail: { type: 'string', format: 'email' }, n: { type: 'integer' }, __rest__mail: { format: 'email' } }
  })
  // A rule copied as it is keeps its reference to the original definition.
  const copied = tagged({ $defs: { int: { type: 'integer' } }, type: 'object', additionalProperties: { $ref: '#/$defs/int' } })
  assert.deepStrictEqual(copied.residual, { additionalProperties: { $ref: '#/$defs/int' }, $defs: { int: { type: 'integer' } } })
  // Draft-07: keywords beside $ref are ignored, and the tuple form of items stays whole.
  const d7 = tagged({ $schema: 'http://json-schema.org/draft-07/schema#', definitions: { s: { type: 'string' } }, type: 'object', properties: { a: { $ref: '#/definitions/s', maxLength: 1 }, b: { type: 'array', items: [{ type: 'string' }], additionalItems: false } } })
  assert.strictEqual(d7.type, '{ "a"?: S; "b"?: unknown[] }')
  assert.deepStrictEqual(d7.residual, { $schema: 'http://json-schema.org/draft-07/schema#', properties: { b: { items: [{ type: 'string' }], additionalItems: false } } })
}

// What declines, with and without tags: no type can be written.
{
  const declines = (s, re) => {
    for (const opts of [{}, { tags: true }]) {
      let err = null
      try { schemaToBunType(s, opts) } catch (e) { err = e }
      assert.ok(err instanceof Declined, `expected a decline for ${JSON.stringify(s)}`)
      assert.ok(re.test(err.message), `decline reason for ${JSON.stringify(s)}: ${err.message}`)
    }
  }
  declines({ $ref: 'http://example.com/x.json' }, /not a local definition/)
  declines({ $ref: '#/$defs/missing' }, /does not resolve/)
  declines({ $dynamicRef: '#x' }, /"\$dynamicRef" is not carried/)
  declines({ format: 'email' }, /carries nothing of the schema/)
  declines({ enum: [{ a: 1 }] }, /carries nothing of the schema/)
  declines({ type: 'object', properties: { a: { type: 'string' } }, unevaluatedProperties: false }, /carries nothing of the schema/)
  declines(JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}'), /__proto__/)
}

// The written module: imports the plain module only, exports the type, the
// three functions through the module, and a typed parse.
{
  const r = schemaToBunType(order, { name: 'Order' })
  const src = toBunModule({ schemaFile: 'order.schema.json', moduleImport: './order.compiled.mjs', typeName: r.name, typeSource: r.type, aliases: r.aliases })
  assert.ok(!/from 'bun/.test(src) && !src.includes('bun:bundle'), 'nothing imported from Bun')
  assert.ok(src.includes('import * as _m from "./order.compiled.mjs"'))
  assert.ok(src.includes('export type Order = {'))
  assert.ok(src.includes('export function isValid (d: unknown): d is Order { return _m.isValid(d) }'))
  assert.ok(src.includes('export function validate (d: unknown) { return _m.validate(d) }'))
  assert.ok(src.includes('const d: Order = JSON.parse(text)'), 'the type is declared where the text is parsed')
  assert.ok(src.includes('return _m.isValid(d) ? d : null'))
  const withAlias = toBunModule({ schemaFile: 'x.json', moduleImport: './x.compiled.mjs', typeName: 'List', typeSource: 'Node', aliases: [['Node', '{ "v": number; "next"?: Node }']] })
  assert.ok(withAlias.includes('type Node = { "v": number; "next"?: Node }\nexport type List = Node'))
  // The module runs as TypeScript strips it: the answers are the plain module's.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-bun-module-'))
  const { Validator } = require('..')
  const { toStandaloneModule } = require('../lib/aot')
  fs.writeFileSync(path.join(dir, 'order.compiled.mjs'), toStandaloneModule(new Validator(order, {}), { format: 'esm' }))
  const stripped = src.replace(/^export type .*$/mg, '').replace(/^type .*$/mg, '').replace(/\(d: unknown\): d is Order/g, '(d)').replace(/\(d: unknown\)/g, '(d)').replace(/\(text: string\): Order \| null/, '(text)').replace(/const d: Order =/, 'const d =')
  fs.writeFileSync(path.join(dir, 'order.bun.mjs'), stripped)
  const ran = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import * as m from ${JSON.stringify(path.join(dir, 'order.bun.mjs'))}
    import * as plain from ${JSON.stringify(path.join(dir, 'order.compiled.mjs'))}
    const good = { customer: { id: 1, name: 'A', email: 'a@b.co' }, items: [{ sku: 'x', quantity: 1, unitCents: 5 }] }
    const bad = { customer: { id: 0, name: 'A', email: 'a@b.co' }, items: [] }
    const out = [m.isValid(good), m.isValid(bad), m.validate(bad).errors.map((e) => e.keyword).join(','), plain.validate(bad).errors.map((e) => e.keyword).join(','), JSON.stringify(m.parse(JSON.stringify(good))) === JSON.stringify(good), m.parse(JSON.stringify(bad)), m.parse('nope')]
    console.log(JSON.stringify(out))
  `], { encoding: 'utf8' })
  assert.strictEqual(ran.status, 0, ran.stderr)
  const out = JSON.parse(ran.stdout.trim())
  assert.deepStrictEqual(out.slice(0, 2), [true, false])
  assert.strictEqual(out[2], out[3], 'the error list is the plain module\'s')
  assert.ok(out[2].includes('minimum'))
  assert.deepStrictEqual(out.slice(4), [true, null, null])
  fs.rmSync(dir, { recursive: true, force: true })
}

// The CLI writes the .bun.ts beside the module and declines with a warning.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-bun-target-'))
  const bin = path.join(__dirname, '..', 'bin', 'ata.js')
  const schemaPath = path.join(dir, 'order.schema.json')
  fs.writeFileSync(schemaPath, JSON.stringify(order))
  const out = execFileSync(process.execPath, [bin, 'build', schemaPath, '--target', 'bun'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  assert.ok(/bun target -> .*order\.compiled\.bun\.ts \(for bun build --compile --aot\)/.test(out), out)
  assert.ok(fs.existsSync(path.join(dir, 'order.compiled.bun.ts')), 'order.compiled.bun.ts written')
  assert.ok(fs.existsSync(path.join(dir, 'order.compiled.mjs')), 'the plain module written too')
  assert.deepStrictEqual(fs.readdirSync(dir).filter((f) => /\.rest\./.test(f)), [], 'no residual module')
  const bunSrc = fs.readFileSync(path.join(dir, 'order.compiled.bun.ts'), 'utf8')
  assert.ok(bunSrc.includes('from "./order.compiled.mjs"'))
  assert.ok(bunSrc.includes('export type Order = '))
  // The module written with --target bun takes the form for Bun's compiler
  // (a closed object's keys read with Object.keys in the verdict), where the
  // module written for V8 walks them with for...in.
  const moduleSrc = fs.readFileSync(path.join(dir, 'order.compiled.mjs'), 'utf8')
  execFileSync(process.execPath, [bin, 'build', schemaPath, '--suffix', '.v8'], { stdio: 'ignore' })
  const v8Src = fs.readFileSync(path.join(dir, 'order.v8.mjs'), 'utf8')
  const keysReads = (src) => (src.match(/Object\.keys\(/g) || []).length
  assert.ok(keysReads(moduleSrc) > keysReads(v8Src), `jsc-aot form expected: ${keysReads(moduleSrc)} Object.keys reads against ${keysReads(v8Src)} on V8`)

  const mail = { type: 'object', required: ['email'], additionalProperties: false, properties: { email: { type: 'string', format: 'email', maxLength: 254 } } }
  fs.writeFileSync(path.join(dir, 'mail.schema.json'), JSON.stringify(mail))
  const res = spawnSync(process.execPath, [bin, 'build', path.join(dir, 'mail.schema.json'), '--target', 'bun'], { encoding: 'utf8' })
  assert.strictEqual(res.status, 0, res.stderr)
  assert.ok(fs.readFileSync(path.join(dir, 'mail.compiled.bun.ts'), 'utf8').includes('export type Mail = { "email": string }'))

  // A root the type says nothing about: the plain module compiles it, the target declines.
  fs.writeFileSync(path.join(dir, 'remote.schema.json'), JSON.stringify({ format: 'email' }))
  const declined = spawnSync(process.execPath, [bin, 'build', path.join(dir, 'remote.schema.json'), '--target', 'bun'], { encoding: 'utf8' })
  assert.strictEqual(declined.status, 0, declined.stderr)
  assert.ok(/--target bun: the type carries nothing of the schema at #; the plain module stands alone/.test(declined.stderr), declined.stderr + declined.stdout)
  assert.ok(!fs.existsSync(path.join(dir, 'remote.compiled.bun.ts')), 'no bun file for a declined schema')
  assert.ok(fs.existsSync(path.join(dir, 'remote.compiled.mjs')), 'the plain module still written')
  const strict = spawnSync(process.execPath, [bin, 'build', path.join(dir, 'remote.schema.json'), '--target', 'bun', '--strict'], { encoding: 'utf8' })
  assert.notStrictEqual(strict.status, 0, 'with --strict a declined schema fails the build')
  const badTarget = spawnSync(process.execPath, [bin, 'build', schemaPath, '--target', 'deno'], { encoding: 'utf8' })
  assert.notStrictEqual(badTarget.status, 0)
  fs.rmSync(dir, { recursive: true, force: true })
}

console.log('ok: bun target type, tagged split, residuals, declines, module and CLI')
