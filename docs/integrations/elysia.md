# Elysia

[Elysia](https://elysiajs.com) validates with TypeBox by default and, since
1.3, takes any Standard Schema validator in the same slots. An ata `Validator`
is one, so a JSON Schema goes straight into `body`, `query`, `params` or
`headers`, with no hook and no wrapper.

## Install

```bash
bun add ata-validator
```

## The schema in the body slot

```ts
import { Elysia } from 'elysia'
import { Validator } from 'ata-validator'

const user = new Validator({
  type: 'object',
  properties: {
    id: { type: 'integer', minimum: 1 },
    name: { type: 'string', minLength: 1 },
    email: { type: 'string', format: 'email' },
    role: { type: 'string', enum: ['admin', 'user', 'guest'] },
  },
  required: ['id', 'name', 'email'],
  additionalProperties: false,
})

new Elysia()
  .post('/users', ({ body }) => ({ ok: true, id: body.id }), { body: user })
  .listen(3000)
```

A body the schema refuses gets Elysia's 422 with the issues ata hands over
(message and path for each error). The handler's `body` is typed from the
schema: `new Validator(schema)` infers the document type from a schema
written inline or through `defineSchema`, and Elysia reads it off the
Standard Schema, so `body.id` is a `number` and `body.missing` is a type
error. Eden clients get the same type. `@elysiajs/openapi` documents the
route from the same validator: ata exposes its schema as Standard JSON
Schema (`~standard.jsonSchema`), and the plugin writes it into the request
body of the OpenAPI document as it does for zod.

## Keeping schemas written with `t`

A TypeBox schema is a JSON Schema object with a few symbol-keyed extras, so
one written with Elysia's `t` goes into a `Validator` as it is:

```ts
const order = t.Object({ id: t.Integer({ minimum: 1 }), tags: t.Array(t.String(), { maxItems: 4 }) }, { additionalProperties: false })

new Elysia().post('/orders', ({ body }) => body, { body: new Validator(order) })
```

Checked on the ten-item order schema of the measurement below: `new
Validator(t.Object(...))` answers the same as zod's schema on all 1024
bodies. Two things change. Elysia's own check normalizes a body first, which
by default strips keys the schema does not name; ata checks the body as it
arrives, so `additionalProperties: false` refuses such a body (103 refused
against Elysia's 78 on those bodies), and `removeAdditional: true` on the
`Validator` strips instead. And the Elysia-only types that are not JSON
Schema (`t.File`, `t.Files`, `t.Numeric`, `t.Date`, `t.Cookie`) have no
meaning to a JSON Schema validator; routes that use them keep `t`.

## The module from `ata build`

For an executable or an edge deploy, write the module at build time and put
it in the slot through `fromCompiled`, which carries Standard Schema too:

```bash
ata build schemas/user.schema.json --target bun
```

```ts
import { Elysia } from 'elysia'
import { fromCompiled } from 'ata-validator/compiled'
import * as mod from './schemas/user.schema.compiled.mjs'
import schema from './schemas/user.schema.json'

new Elysia().post('/users', ({ body }) => ({ ok: true }), { body: fromCompiled(mod, schema) })
```

`--target bun` writes the module in the form Bun's ahead-of-time compiler
runs fastest (plain JavaScript either way), and beside it a `.bun.ts` with
the schema as a TypeScript type; `ata build` without it is the same module
for Node. Nothing in the module calls `new Function`.

## Measured, inside a request

Elysia 1.4.30, `app.handle` in process with no socket, one ten-item order
body, 1024 distinct bodies, 10% of them invalid, five routes, nanoseconds per
request (`benchmark/proof/aot/RESULTS.md` in the repository, "Inside an
Elysia request"). The compiler column is the pull request build of Bun's
`bun build --compile --aot` of 2026-10-25, which runs code that a library
hands to `new Function` through an interpreter.

| route | Bun 1.4 JIT | validation's share | compiled ahead of time | share |
|---|---|---|---|---|
| no schema | 1,705 to 1,726 | | 1,906 to 1,969 | |
| Elysia `t` (TypeBox) | 4,453 to 4,581 | 2,750 | 9,663 to 9,759 | 7,750 |
| zod 4 | 3,970 to 4,018 | 2,280 | 5,900 to 6,073 | 4,050 |
| zod 4 with `z.compile()` | 2,266 to 2,317 | 600 to 660 | 4,319 | 2,406 |
| ata, runtime `Validator` | 2,170 to 2,214 | 480 | 3,468 to 3,517 | 1,550 |
| ata, module from `ata build` | 2,008 to 2,049 | 310 | 2,494 to 2,553 | 580 |

Two things the table does not say by itself. Elysia's own route refuses 78
of the 1024 bodies where the other three refuse 103: Elysia normalizes a body
against its own schema before checking it, and its default strips the
unknown key one of the invalid cases adds, so that case passes there. And
Elysia composes its handlers with `new Function` as well, which is in every
row of the compiled column, the no-schema row included. zod's `z.compile()`
(4.6) wraps a schema in a generated fast path, also from a string, with the
runtime parser behind it for a refused body; it takes zod's share to about a
third on the JIT, and under the compiler that fast path is interpreted like
the rest.

## Notes

- Schemas written in code with Elysia's `t` stay idiomatic; ata is for
  schemas that exist as JSON Schema, from an OpenAPI document, a registry or
  a file, and for a validator that costs the same when the program is
  compiled ahead of time.
- `query`, `params` and `headers` arrive as strings; a schema for them wants
  `coerceTypes: true` on the `Validator`.
- The `.bun.ts` beside a module is a type for the program, not a faster
  path; the measured numbers above are the module's.
