'use strict'
// `ata build --target bun`: the schema as a type for Bun's validate<T>. What is
// checked here without Bun: the mapping carries every rule it claims to, it
// declines exactly the keywords it cannot carry, and the CLI writes the file.
// The semantic check against Bun's compiler is benchmark/proof/aot/suite-differential.mjs,
// which needs a Bun with --aot and runs by hand.
const assert = require('assert')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
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

{
  const r = schemaToBunType(order, { name: 'Order' })
  assert.strictEqual(r.name, 'Order')
  assert.strictEqual(r.aliases.length, 0)
  const t = r.type
  // Every rule of the schema appears as a tag, and the objects are strict.
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

// The shapes the mapping carries.
{
  const t = (s) => schemaToBunType(s).type
  assert.strictEqual(t(true), 'unknown')
  assert.strictEqual(t(false), 'never')
  assert.strictEqual(t({}), 'unknown')
  assert.strictEqual(t({ type: 'null' }), 'null')
  assert.strictEqual(t({ type: ['string', 'null'] }), 'string | null')
  assert.strictEqual(t({ enum: ['a', 1, true, null] }), '"a" | 1 | true | null')
  assert.strictEqual(t({ const: 'x' }), '"x"')
  assert.strictEqual(t({ type: 'number', exclusiveMinimum: 0, exclusiveMaximum: 1, multipleOf: 1 }), 'number & Schema.Above<0> & Schema.Below<1> & Schema.MultipleOf<1>')
  assert.strictEqual(t({ type: 'array' }), 'unknown[]')
  assert.strictEqual(t({ type: 'array', items: false }), '[]')
  assert.strictEqual(t({ type: 'array', prefixItems: [{ type: 'string' }, { type: 'number' }], items: false, minItems: 2 }), '[string, number]')
  // Patterns Bun reads the same way with and without the unicode flag.
  assert.strictEqual(t({ type: 'string', pattern: '^[a-z0-9_-]{3,16}$' }), 'string & Schema.Pattern<"^[a-z0-9_-]{3,16}$">')
  assert.strictEqual(t({ type: 'string', pattern: '^[^@\\s]+@[^@\\s]+$' }), 'string & Schema.Pattern<"^[^@\\\\s]+@[^@\\\\s]+$">')
  assert.strictEqual(t({ type: 'string', pattern: '^\\d+(\\.\\d+)?$' }), 'string & Schema.Pattern<"^\\\\d+(\\\\.\\\\d+)?$">')
  assert.strictEqual(t({ type: 'string', pattern: 'a.*b' }), 'string & Schema.Pattern<"a.*b">')
  assert.strictEqual(t({ type: 'object' }), 'Record<string, unknown>')
  assert.strictEqual(t({ type: 'object', required: ['a'] }), '{ "a": unknown }')
  assert.strictEqual(t({ anyOf: [{ type: 'string' }, { type: 'number' }] }), 'string | number')
  assert.strictEqual(t({ type: 'string', anyOf: [{ minLength: 1 }, { type: 'number' }] }), 'string & Schema.MinLength<1>')
  assert.strictEqual(t({ allOf: [{ type: 'object', properties: { a: { type: 'number' } } }, { type: 'array' }] }), 'never')
  assert.strictEqual(t({ type: 'object', additionalProperties: false }), '{} & Schema.Strict')
  assert.strictEqual(t({ enum: ['a', 'b'], }), '"a" | "b"')
  assert.strictEqual(t({ anyOf: [{ const: 'a' }, { const: 'a' }, { const: 1 }] }), '"a" | 1')
  assert.strictEqual(t({ allOf: [{ const: 'a' }, { const: 'b' }] }), 'never')
  assert.strictEqual(t({ type: 'string', anyOf: [{ const: 'a' }, { minLength: 2 }] }), '"a" | (string & Schema.MinLength<2>)')
  assert.strictEqual(t({ required: ['a'] }), 'string | number | boolean | null | { "a": unknown } | unknown[]')
  assert.strictEqual(t({ minLength: 1 }), '(string & Schema.MinLength<1>) | number | boolean | null | Record<string, unknown> | unknown[]')
  assert.strictEqual(t({ type: 'object', properties: { a: { type: 'string' } }, anyOf: [{ required: ['a'] }] }), '{ "a"?: string } & { "a": unknown }')
  assert.strictEqual(t({ allOf: [{ type: 'object', properties: { a: { type: 'number' } } }, { type: 'object', required: ['a'] }] }), '{ "a"?: number } & { "a": unknown }')
}

// Definitions become named types, recursion included.
{
  const r = schemaToBunType({
    $defs: { node: { type: 'object', required: ['v'], additionalProperties: false, properties: { v: { type: 'integer' }, next: { $ref: '#/$defs/node' } } } },
    $ref: '#/$defs/node'
  }, { name: 'List' })
  assert.strictEqual(r.type, 'Node')
  assert.deepStrictEqual(r.aliases.map((a) => a[0]), ['Node'])
  assert.ok(r.aliases[0][1].includes('"next"?: Node'), r.aliases[0][1])
  const self = schemaToBunType({ type: 'object', properties: { again: { $ref: '#' } } }, { name: 'Tree' })
  assert.strictEqual(self.type, '{ "again"?: Tree }')
}

// What declines, and that it says why and where. Each of these, carried as
// nothing, would make the type accept what the schema refuses.
{
  const declines = (s, re) => {
    let err = null
    try { schemaToBunType(s) } catch (e) { err = e }
    assert.ok(err instanceof Declined, `expected a decline for ${JSON.stringify(s)}`)
    assert.ok(re.test(err.message), `decline reason for ${JSON.stringify(s)}: ${err.message}`)
  }
  declines({ type: 'string', format: 'email' }, /"format" is not carried at #/)
  declines({ oneOf: [{ type: 'string' }] }, /"oneOf" is not carried/)
  declines({ not: { type: 'string' } }, /"not" is not carried/)
  declines({ type: 'object', patternProperties: { '^x': {} } }, /"patternProperties" is not carried/)
  declines({ type: 'object', additionalProperties: { type: 'string' } }, /additionalProperties with a schema .* at #\/additionalProperties/)
  declines({ type: 'object', minProperties: 1 }, /"minProperties" is not carried/)
  declines({ type: 'array', uniqueItems: true }, /"uniqueItems" is not carried/)
  declines({ type: 'array', contains: { type: 'string' } }, /"contains" is not carried/)
  declines({ type: 'array', prefixItems: [{ type: 'string' }] }, /without items: false/)
  declines({ type: 'array', prefixItems: [{ type: 'string' }], items: false, minItems: 0 }, /minItems equal to its length/)
  declines({ type: 'array', prefixItems: [{ type: 'string' }], items: false }, /minItems equal to its length/)
  // Patterns whose acceptance depends on the unicode flag.
  declines({ type: 'string', pattern: '^.{2}$' }, /pattern with \. outside a greedy/)
  declines({ type: 'string', pattern: '^[^a]$' }, /negated class outside a greedy/)
  declines({ type: 'string', pattern: '^[^a]+?$' }, /negated class outside a greedy/)
  declines({ type: 'string', pattern: '\\p{L}+' }, /pattern with \\p is not carried/)
  declines({ type: 'string', pattern: '\\S$' }, /\\S outside a greedy/)
  declines({ type: 'string', pattern: '^\\u00e9$' }, /\\u is not carried/)
  declines({ type: 'string', pattern: '^é$' }, /outside ASCII/)
  declines({ type: 'string', pattern: '[\\S]+' }, /\\S in a class/)
  declines({ type: 'string', pattern: 'a\\bc' }, /\\b is not carried/)
  declines({ type: 'number', minLength: 1 }, /minLength beside type "number"/)
  declines({ type: 'number', multipleOf: 0.5 }, /positive integers only/)
  declines({ type: 'number', exclusiveMinimum: true, minimum: 1 }, /draft-04 form/)
  declines({ type: 'string', enum: ['a'] }, /const or enum beside other rules/)
  declines({ enum: [{ a: 1 }] }, /object or array literal/)
  declines({ $ref: 'http://example.com/x.json' }, /not a local definition/)
  declines({ $ref: '#/$defs/missing' }, /does not resolve/)
  declines({ $ref: '#', type: 'object' }, /beside \$ref/)
  declines({ type: 'object', properties: { a: { type: 'string', format: 'uuid' } } }, /at #\/properties\/a$/)
  declines({ allOf: [{ type: 'object', additionalProperties: false }, { type: 'object', required: ['a'] }] }, /inside an intersection/)
  declines({ allOf: [{ $ref: '#/$defs/a' }, { type: 'object' }], $defs: { a: { type: 'object' } } }, /\$ref inside allOf/)
  declines({ allOf: [{ const: 'a' }, { type: 'string', minLength: 1 }] }, /literal beside a rule/)
  declines({ allOf: [{ type: 'array', minItems: 1 }, { type: 'array', maxItems: 3 }] }, /two array rules/)
  declines(JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}'), /__proto__/)
  declines({ type: 'string', 'x-custom': 1 }, /"x-custom" is not carried/)
  declines({ type: 'object', dependentRequired: { a: ['b'] } }, /"dependentRequired" is not carried/)
  declines({ type: 'object', unevaluatedProperties: false }, /"unevaluatedProperties" is not carried/)
  declines({ if: { type: 'string' }, then: { minLength: 1 } }, /"if" is not carried/)
  declines({ $dynamicRef: '#x' }, /"\$dynamicRef" is not carried/)
}

// The written module: imports Bun's validator and the plain module, exports
// the type and the three functions, and the plain module decides on refusal.
{
  const r = schemaToBunType(order, { name: 'Order' })
  const src = toBunModule({ schemaFile: 'order.schema.json', moduleImport: './order.compiled.mjs', typeName: r.name, typeSource: r.type, aliases: r.aliases })
  assert.ok(src.includes("import { validate as _check } from 'bun:bundle'"))
  assert.ok(src.includes("import * as _m from \"./order.compiled.mjs\""))
  assert.ok(src.includes('export type Order = '))
  assert.ok(src.includes('catch { return _m.isValid(d) }'))
  assert.ok(src.includes('catch { return _m.validate(d) }'))
  assert.ok(src.includes('_JSON.parse<Order>(text)'))
}

// The CLI writes the file beside the module, and declines with a warning.
{
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-bun-target-'))
  const schemaPath = path.join(dir, 'order.schema.json')
  fs.writeFileSync(schemaPath, JSON.stringify(order))
  const bin = path.join(__dirname, '..', 'bin', 'ata.js')
  const out = execFileSync(process.execPath, [bin, 'build', schemaPath, '--target', 'bun'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
  assert.ok(/bun target -> /.test(out), out)
  const bunFile = path.join(dir, 'order.compiled.bun.ts')
  assert.ok(fs.existsSync(bunFile), 'order.compiled.bun.ts written')
  assert.ok(fs.existsSync(path.join(dir, 'order.compiled.mjs')), 'the plain module written too')
  const bunSrc = fs.readFileSync(bunFile, 'utf8')
  assert.ok(bunSrc.includes('export type Order_schema = ') || bunSrc.includes('export type Order = '), bunSrc.slice(0, 400))
  assert.ok(bunSrc.includes('from "./order.compiled.mjs"'))

  fs.writeFileSync(path.join(dir, 'mail.schema.json'), JSON.stringify({ type: 'string', format: 'email' }))
  let stderr = ''
  const res = require('child_process').spawnSync(process.execPath, [bin, 'build', path.join(dir, 'mail.schema.json'), '--target', 'bun'], { encoding: 'utf8' })
  stderr = res.stderr
  assert.strictEqual(res.status, 0, stderr)
  assert.ok(/not carried as a type, keyword "format" is not carried at #; the plain module stands alone/.test(stderr), stderr)
  assert.ok(!fs.existsSync(path.join(dir, 'mail.compiled.bun.ts')), 'no bun file for a declined schema')
  assert.ok(fs.existsSync(path.join(dir, 'mail.compiled.mjs')), 'the plain module still written')
  const strict = require('child_process').spawnSync(process.execPath, [bin, 'build', path.join(dir, 'mail.schema.json'), '--target', 'bun', '--strict'], { encoding: 'utf8' })
  assert.notStrictEqual(strict.status, 0, 'with --strict a declined schema fails the build')
  const badTarget = require('child_process').spawnSync(process.execPath, [bin, 'build', schemaPath, '--target', 'deno'], { encoding: 'utf8' })
  assert.notStrictEqual(badTarget.status, 0)
  fs.rmSync(dir, { recursive: true, force: true })
}

console.log('ok: bun target mapping, declines and CLI')
