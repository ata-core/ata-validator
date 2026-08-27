# ata-validator

JSON Schema validation with first-class TypeScript and zero runtime cost. AOT compile your schemas to per-schema ESM modules with no validator dependency. `Validator<T>` composes with TypeBox, Zod-from-JSON-Schema, Valibot, or hand-written types. Runtime API available for dynamic schemas. Draft 2020-12, draft 7 and the [JSON Schema v1 dialect](#dialects).

[![npm](https://img.shields.io/npm/v/ata-validator)](https://www.npmjs.com/package/ata-validator)
[![License](https://img.shields.io/npm/l/ata-validator)](LICENSE)

1.0 is a stability commitment: see [docs/STABILITY.md](docs/STABILITY.md) for the semver, deprecation, and error-code guarantees.

## Quick start

```bash
npm install --save-dev ata-validator
npx ata build 'schemas/*.json' --out-dir src/generated
```

The `ata-validator` package itself is pure JavaScript. The native accelerator (simdjson parsing, parallel NDJSON, buffer APIs) ships as per-platform optional packages that npm installs automatically where they fit, the same pattern Vite uses for esbuild. Seven targets are built: macOS on arm64 and x64, Linux on x64 and arm64 against both glibc and musl, and Windows on x64. A platform without a prebuild still installs and validates, on the pure-JS engine. For a guaranteed zero-binary install:

```bash
npm install ata-validator --omit=optional
```

or set `ATA_NO_NATIVE=1` at runtime. Typical schemas compile to specialized JS; shapes the compiler cannot represent (some `$dynamicRef`, cyclic `$ref`, unusual keyword interactions) fall back to an interpreted engine, so every schema validates in every environment. The pure-JS setup scores the same on the official suite as the native one, 1299 of 1299 Draft 2020-12 cases. Only the buffer and parallel APIs (`isValid` on raw buffers, `countValid`, `batchIsValid`, `validateAndParse`) need the native engine and say so with a clear error.

Those four now agree with `validate()` on every case of the official suite, 3359 across three dialects. The native walker behind them does not handle every shape (`contains`, `unevaluatedProperties`, `patternProperties`, tuple `items`, cross-document `$ref`, a few formats), so for schemas using one of those the buffer APIs parse the bytes and answer through `validate()`; the list is in `lib/buffer-gate.js`. Typical request schemas stay on the zero-copy path. `npm test` holds the disagreement count at zero.

Where `new Function` is refused altogether, on Cloudflare Workers, Deno Deploy or under a strict Content-Security-Policy, ata drops to the interpreted engine and scores the same 1299 of 1299 with code generation blocked. No flags, and on Workers no `nodejs_compat` either. See [docs/edge-runtimes.md](docs/edge-runtimes.md).

Node has a switch for exactly that environment, so this takes thirty seconds to check for yourself, on ata or on whatever you use today:

```bash
node --disallow-code-generation-from-strings -e "
  const { Validator } = require('ata-validator')
  const v = new Validator({ type: 'object', properties: { id: { type: 'integer' } }, required: ['id'] })
  console.log(v.validate({ id: 1 }).valid, v.validate({ id: 'x' }).valid)
"
```

A validator that reaches its speed by generating source and calling `new Function` cannot run under that flag at all, which is the same reason it cannot run on a Worker. That is a deliberate trade rather than an oversight, and it is worth knowing which side of it your validator is on before you deploy to an edge runtime.

In your code:

```ts
import { validate, isValid, type User } from './generated/user.compiled.mjs'

if (isValid(req.body)) {
  const user: User = req.body
  // ...
}
```

The `.compiled.mjs` modules are self-contained: zero runtime dependency on ata-validator, fully tree-shakeable, with TypeScript types emitted alongside.

## Why AOT

| Dimension | Schema | ata-AOT | AJV-runtime | Difference |
|---|---|---|---|---|
| Bundle (gzipped) | simple | 1.0 KB | 52.7 KB | 50.5x smaller |
| Bundle (gzipped) | complex | 4.8 KB | 52.7 KB | 11.0x smaller |
| Bundle (gzipped) | nested | 2.3 KB | 52.7 KB | 23.1x smaller |
| Cold start | simple | 21 ms | 40 ms | 1.9x faster |
| Throughput (1M ops) | simple | 258 Mops/s | 102 Mops/s | 2.5x faster |
| Compile time | simple | 8 µs | 1.61 ms | 191x faster |

Reproduce on your machine with `npm run bench:aot-vs-ajv`. Numbers from one run on Apple
M4 Pro, Node 25.2.1, 2026-08-13. Across three runs throughput moved between 258 and 278
Mops/s and the compile ratio between 150x and 199x, so treat the last two rows as an order
of magnitude rather than a constant.

The wins are largest on bundle size and compile time because AOT moves work from runtime to
build time. Throughput and cold start are also faster because the compiled validator is a
tight straight-line function with no schema-walk overhead.

What the table does not cover is data that fails. It measures compiled modules on input that
passes, and a rejection costs more than a verdict: ata builds an error carrying a code, the
offending value, a documentation link and a suggestion. On a five-field object schema a
passing payload costs about 17 ns and a rejected one about 155 ns. `abortEarly: true` or
`isValidObject()` skips that work when only the verdict matters. Schemas ata declines to
compile, mostly cross-document `$ref`, `$dynamicRef` and the harder `unevaluated*` shapes,
run on the interpreted engine. That engine compiles each schema into a tree of closures, so
on a six-field object schema a passing payload costs about 136 ns against 8 ns for the same
shape on the compiled path, both measured warm in one run on the same machine.

## Error messages

ata's error output is compiler-grade: each error carries a stable code, an inline source frame pointing at the schema file, and another pointing at the offending bytes in the request payload. Renderers ship in three styles:

```ts
import { Validator, renderPretty, renderCompact, renderJSON } from 'ata-validator'

const v = new Validator(schema, { source: { path: 'schemas/user.json', content: schemaText } })
const r = v.validateJSON(input)
if (!r.valid) {
  console.error(renderPretty(r.errors))
  // error[ATA3001]: value does not match format "email"
  //   --> schemas/user.json:5:7
  //    |
  //  5 |       "email": { "type": "string", "format": "email" }
  //    |       ^^^^^^^  expected format 'email'
  //    |
  //   --> input, byte 23
  //    |
  //  1 | {"name":"M","email":"not-an-email","age":-3}
  //    |                     ^^^^^^^^^^^^^^  got "not-an-email"
  //    |
  //    = help: missing '@' and domain part
  //    = note: see https://ata-validator.com/e/ATA3001
}
```

The `ata` CLI ships `ata validate <schema> <data>` for one-off checks. TTY auto-renders pretty; pipes default to compact; `--format=json` produces structured output for tooling.

Errors carry a stable `code` field (`ATA####`), see the [error code registry](docs/error-codes.md). Each code has a permalink at `https://ata-validator.com/e/<CODE>`.

### Custom messages

A subschema can override the human-facing message with an `errorMessage` keyword. A string replaces the message for any failing keyword on that subschema; an object overrides per keyword, with `required` keyed by the missing property name (or a single string) and `_` as a fallback. The `code`, `keyword`, and `path` fields are untouched, so dashboards and renderers keep working.

```js
const v = new Validator({
  type: 'object',
  properties: {
    age: { type: 'integer', minimum: 18, errorMessage: { minimum: 'must be 18 or older', type: 'age has to be a number' } },
    email: { type: 'string', format: 'email', errorMessage: 'enter a valid email address' },
  },
  required: ['email'],
  errorMessage: { required: { email: 'email is required' } },
})

v.validate({ age: 5 }).errors[0].message      // 'must be 18 or older'
v.validate({}).errors[0].message              // 'email is required'
```

Schemas without an `errorMessage` keyword pay nothing: the override pass is only installed when one is present.

### Opting out

For consumers who built log dashboards on the v0.14 error shape, `new Validator(schema, { richErrors: false })` returns the legacy shape exactly. For high-throughput paths, `abortEarly: true` continues to short-circuit; the returned error carries `code: 'ATA9000'` and no enrichment.

## When to use the runtime API instead

`ata build` is for schemas you know at build time. If your schemas are user-supplied at runtime (form builders, no-code platforms, dynamic API ingestion), use the runtime API:

```js
import { Validator } from 'ata-validator'

const v = new Validator(schema)
const result = v.validate(data)
```

The runtime API is unchanged from previous releases. AJV-shim users continue importing from `ata-validator/compat`.

## Usage

### Node.js

```javascript
const { Validator } = require('ata-validator');

const v = new Validator({
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    email: { type: 'string', format: 'email' },
    age: { type: 'integer', minimum: 0 },
    role: { type: 'string', default: 'user' }
  },
  required: ['name', 'email']
});

// Fast boolean check - JS codegen, 15.3M ops/sec
v.isValidObject({ name: 'Mert', email: 'mert@example.com', age: 26 }); // true

// Full validation with error details + defaults applied
const result = v.validate({ name: 'Mert', email: 'mert@example.com' });
// result.valid === true, data.role === 'user' (default applied)

// JSON string validation (simdjson fast path)
v.validateJSON('{"name": "Mert", "email": "mert@example.com"}');
v.isValidJSON('{"name": "Mert", "email": "mert@example.com"}'); // true

// Buffer input (zero-copy, raw NAPI)
v.isValid(Buffer.from('{"name": "Mert", "email": "mert@example.com"}'));

// Which engine answers this schema: 'codegen', 'closure', 'native' or 'interpreter'
v.engine(); // 'codegen'

// Parallel batch - multi-core, NDJSON, 13.4M items/sec
const ndjson = Buffer.from(lines.join('\n'));
v.isValidParallel(ndjson);  // bool[]
v.countValid(ndjson);        // number
```

### Type-safe schemas

ata infers TypeScript types straight from plain JSON Schema. Write the schema once with `defineSchema`, and both runtime validation and the static type come from it, with no builder DSL and no second type declaration to keep in sync.

```ts
import { defineSchema, Validator } from 'ata-validator'

const userSchema = defineSchema({
  type: 'object',
  properties: {
    id: { type: 'integer', minimum: 1 },
    role: { type: 'string', enum: ['admin', 'user'] },
  },
  required: ['id'],
})

const v = new Validator(userSchema)
const result = v.validate(data)
if (result.valid) {
  result.data.id   // number
  result.data.role // 'admin' | 'user' | undefined
} else {
  // result.errors: ValidationError[]
}
```

`defineSchema` returns the schema untouched at runtime; in TypeScript it gives keyword autocomplete and an error when a value has the wrong shape, with no `as const` needed. `new Validator(schema)` carries the inferred type, so a successful `validate` narrows `result.data` with no manual annotation.

#### Extracting the type: `Infer`

You can also pull the type out directly with `Infer`, with no second declaration to keep in sync.

```ts
import { defineSchema, type Infer } from 'ata-validator'

const event = defineSchema({
  $defs: {
    Point: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' } }, required: ['x', 'y'] },
  },
  type: 'object',
  properties: {
    kind: { enum: ['click', 'scroll'] },
    at: { $ref: '#/$defs/Point' },
    path: { type: 'array', prefixItems: [{ type: 'string' }, { type: 'integer' }] },
  },
  required: ['kind', 'at'],
})

type Event = Infer<typeof event>
// {
//   kind: 'click' | 'scroll'
//   at: { x: number; y: number }
//   path?: [string, number]
// }
```

`Infer` resolves `const`/`enum` to literals, `anyOf`/`oneOf` to unions, `allOf` to intersections, `prefixItems` to tuples, and local `$ref` into `#/$defs` or `#/definitions`, including recursive references. An external or unresolvable `$ref` resolves to `unknown` rather than erroring. The exported `JSONSchema` type is available if you want to annotate a schema by hand; custom and vendor keywords are allowed. Requires TypeScript >= 5.0.

#### Chainable authoring with `ata-validator/t`

If you prefer a chainable builder over JSON Schema literals, `ata-validator/t` ships one whose output is still plain JSON Schema. The runtime validator, `Infer<S>`, and the AOT pipeline all keep working without an adapter. The migration from TypeBox is one import rename, then the same authoring shape:

```ts
import { t } from 'ata-validator/t'
import { Validator, type Infer } from 'ata-validator'

const User = t.object({
  id: t.integer(),
  name: t.string({ minLength: 1 }),
  email: t.optional(t.string({ format: 'email' })),
  role: t.union([t.literal('admin'), t.literal('user')]),
})

type User = Infer<typeof User>
// { id: number; name: string; role: 'admin' | 'user'; email?: string }

const v = new Validator(User)
```

The builder covers primitives (`string`, `number`, `integer`, `boolean`, `null`), composites (`object` with optional keys, `array`, `tuple`, `record`, `union`, `intersect`, `literal`, `const`, `enum`), plus the TypeBox-style modifiers `pick`, `omit`, `partial`, `required`, `composite`, and `recursive`. Optionality is carried by a Symbol marker that the emitted JSON Schema and ata's codegen never see, so the output is still a plain JSON Schema literal that you can pass to anything that takes one.

```ts
const User = t.object({ id: t.integer(), name: t.string(), email: t.optional(t.string()) })
const Patch = t.partial(t.omit(User, ['id']))
type Patch = Infer<typeof Patch>
// { name?: string; email?: string }
```

#### Async refinement

JSON Schema is synchronous, so checks that need to await, a uniqueness lookup, a remote call, a cross-field rule, attach to a schema with `t.refine` and run through `validateAsync`. The refinement rides on a Symbol marker, so `new Validator(schema)` still does plain structural validation and ignores it; only `validateAsync`/`parseAsync` evaluate it, and only after the value is structurally valid.

```ts
import { t } from 'ata-validator/t'
import { validateAsync, parseAsync } from 'ata-validator'

const Signup = t.refine(
  t.object({ username: t.string({ minLength: 3 }), email: t.string({ format: 'email' }) }),
  async (value) => !(await usernameTaken(value.username)),
  { message: 'username is already taken', path: '/username' },
)

const r = await validateAsync(Signup, body)
if (!r.valid) return reply.code(400).send(r.errors)

// or: resolves to the typed value, throws on failure with err.errors
const user = await parseAsync(Signup, body)
```

Refinements compose by wrapping again, and a failing one surfaces as an error with `keyword: 'refine'` carrying your `message` and `path`. A `check` may be sync or async.

#### Composes with TypeBox, Zod, or your own types

`Validator<T>` is generic, so if you already author schemas with a library, pass the type and ata narrows to it. No library-specific assumption.

```ts
import { Type, type Static } from '@sinclair/typebox'
import { Validator } from 'ata-validator'

const UserSchema = Type.Object({
  id: Type.Integer({ minimum: 1 }),
  name: Type.String({ minLength: 1 }),
})

const v = new Validator<Static<typeof UserSchema>>(UserSchema)
```

The same works with Zod-from-JSON-Schema, Valibot, or a hand-written `type User = {...}` alongside a JSON Schema literal.

### Cross-Schema `$ref`

```javascript
const addressSchema = {
  $id: 'https://example.com/address',
  type: 'object',
  properties: { street: { type: 'string' }, city: { type: 'string' } },
  required: ['street', 'city']
};

const v = new Validator({
  type: 'object',
  properties: {
    name: { type: 'string' },
    address: { $ref: 'https://example.com/address' }
  }
}, { schemas: [addressSchema] });

// Or use addSchema()
const v2 = new Validator(mainSchema);
v2.addSchema(addressSchema);
```

### Options

```javascript
const v = new Validator(schema, {
  coerceTypes: true,       // "42" → 42 for integer fields
  removeAdditional: true,  // strip properties not in schema
  schemas: [otherSchema],  // cross-schema $ref registry
  abortEarly: true,        // skip detailed error collection on failure (~4x faster on invalid data)
});
```

`abortEarly` returns a shared `{ valid: false, errors: [{ message: 'validation failed' }] }` on failure instead of running the detailed error collector. Useful when the caller only needs a pass/fail decision (Fastify route guards, high-throughput gatekeepers, request rejection at the edge).

### Build-time compile (`ata compile`)

The `ata` CLI turns a JSON Schema file into a self-contained JavaScript module. No runtime dependency on `ata-validator`, so only the generated validator ships to the browser. Typical output is ~1 KB gzipped compared to ~27 KB for the full runtime.

```bash
npx ata compile schemas/user.json -o src/generated/user.validator.mjs
```

The CLI emits two files: the validator itself and a paired `.d.mts` (or `.d.cts`) with the inferred TypeScript type plus an `isValid` type predicate.

```ts
import { isValid, validate, type User } from './user.validator.mjs'

const incoming: unknown = JSON.parse(req.body)

if (isValid(incoming)) {
  // TypeScript narrows to User here
  incoming.id      // number
  incoming.role    // 'admin' | 'user' | 'guest' | undefined
}

const r = validate(incoming)
// { valid: true, errors: [] } | { valid: false, errors: ValidationError[] }
```

CLI options:

| Flag | Default | Description |
|---|---|---|
| `-o, --output <file>` | `<schema>.validator.mjs` | Output path |
| `-f, --format <fmt>` | `esm` | `esm` or `cjs` |
| `--name <TypeName>` | from filename | Root type name in the `.d.ts` |
| `--abort-early` | off | Generate the stub-error variant (~0.5 KB gzipped) |
| `--no-types` | off | Skip the `.d.mts` / `.d.cts` output |

For a project with many schemas, `ata build <glob>` compiles them all in one command:

```bash
npx ata build 'schemas/*.json' --out-dir build/validators --check
```

Run with `--watch` during development for incremental rebuilds.

Typical bundle sizes (10-field user schema, gzipped):

| Variant | Size | Notes |
|---|---|---|
| `ata-validator` runtime | ~27 KB | Full compiler + all keywords |
| `ata compile` (standard) | **~1.1 KB** | Validator + detailed error collector |
| `ata compile --abort-early` | **~0.5 KB** | Validator + stub errors only |

Programmatic API if you prefer to script it:

```javascript
const fs = require('fs');
const { toStandaloneModule } = require('ata-validator/build');

fs.writeFileSync('./user.validator.mjs', toStandaloneModule(schema, { format: 'esm' }));
```

Custom format functions either get their source embedded (the default, refused
at build time with a named error when the function would not survive
serialization) or, with `formatMode: 'inject'`, are supplied at load time
through a `setFormats()` export the module carries. `docs/API.md` has the
details.

**Fastify startup, 10 route schemas, from a cold process to the first validated request:
ajv 19.6 ms, ata 3.1 ms, no build step required.** ata registers in 1.1 ms of that and
compiles on the first request, so counting only registration would overstate the gap.
Reproduce with `node benchmark/bench_fastify_boot.mjs`.

### Standard Schema V1

```javascript
const v = new Validator(schema);

// Works with Fastify, tRPC, TanStack, etc.
const result = v['~standard'].validate(data);
// { value: data } on success
// { issues: [{ message, path }] } on failure
```

### Fastify Plugin

Measured against Fastify's own schema and validation test files with ata swapped in as the default validator: 178 of 184 tests pass, and the remaining six assert the default validator's own extension API rather than validation behavior. Validation errors follow the schema's keyword declaration order, so error-message plugins and `transformErrors` hooks written against the default validator see the same order.

```bash
npm install fastify-ata
```

```javascript
const fastify = require('fastify')();
fastify.register(require('fastify-ata'), {
  coerceTypes: true,
  removeAdditional: true,
});

// All existing JSON Schema route definitions work as-is
```

### C++

```cpp
#include "ata.h"

auto schema = ata::compile(R"({
  "type": "object",
  "properties": { "name": {"type": "string"} },
  "required": ["name"]
})");

auto result = ata::validate(schema, R"({"name": "Mert"})");
// result.valid == true
```

## Framework integrations

Copy-paste recipes for the common frameworks. Most need 10-20 lines of glue. See [docs/integrations](docs/integrations/) for the full set.

| Framework | Pattern | Recipe |
|---|---|---|
| Fastify | dedicated plugin | [`fastify-ata`](https://github.com/ata-core/fastify-ata) |
| Vite (build-time compile) | dedicated plugin | [`ata-vite`](https://github.com/ata-core/ata-vite) |
| Hono | async middleware | [docs/integrations/hono.md](docs/integrations/hono.md) |
| Elysia | direct handler check | [docs/integrations/elysia.md](docs/integrations/elysia.md) |
| tRPC | Standard Schema V1 input | [docs/integrations/trpc.md](docs/integrations/trpc.md) |
| TanStack Form | Standard Schema V1 validator | [docs/integrations/tanstack-form.md](docs/integrations/tanstack-form.md) |
| Express | sync middleware | [docs/integrations/express.md](docs/integrations/express.md) |
| Koa | async ctx middleware | [docs/integrations/koa.md](docs/integrations/koa.md) |
| NestJS | validation pipe | [docs/integrations/nestjs.md](docs/integrations/nestjs.md) |
| SvelteKit | form action, API route | [docs/integrations/sveltekit.md](docs/integrations/sveltekit.md) |
| Astro | API route, server action | [docs/integrations/astro.md](docs/integrations/astro.md) |

## Supported Keywords

| Category | Keywords |
|----------|----------|
| Type | `type` |
| Numeric | `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf` |
| String | `minLength`, `maxLength`, `pattern`, `format` |
| Array | `items`, `prefixItems`, `minItems`, `maxItems`, `uniqueItems`, `contains`, `minContains`, `maxContains`, `unevaluatedItems` |
| Object | `properties`, `required`, `additionalProperties`, `patternProperties`, `minProperties`, `maxProperties`, `propertyNames`, `dependentRequired`, `dependentSchemas`, `unevaluatedProperties` |
| Enum/Const | `enum`, `const` |
| Composition | `allOf`, `anyOf`, `oneOf`, `not` |
| Conditional | `if`, `then`, `else` |
| References | `$ref`, `$defs`, `definitions`, `$id`, `$anchor`, `$dynamicRef`, `$dynamicAnchor` |
| Boolean | `true`, `false` |
| v1 | `propertyDependencies` |

### Dialects

`$schema` selects the dialect. Draft 2020-12 is the default, draft-07 is normalized on the way in, and `https://json-schema.org/v1` (or the dated `https://json-schema.org/v1/2026`) selects JSON Schema v1.

Two things differ under v1. `propertyDependencies` selects a subschema by the value of a property rather than by its presence, which is what `dependentSchemas` does. And `$dynamicRef` no longer requires bookending: the reference resolves through the dynamic scope whether or not the schema it first lands on carries a matching `$dynamicAnchor`, so the outermost matching anchor still in scope wins. Everything else ata implements is identical under both dialects, so a schema that declares no `$schema` behaves exactly as before.

Both are implemented in the interpreted engine, so a v1 schema that uses `$dynamicRef` validates there rather than through the compiler or the native addon, which resolve the 2020-12 way. Schemas that use neither keyword take the same compiled path they always did.

### Format Validators (hand-written, no regex)

`email`, `date`, `date-time`, `time`, `uri`, `uri-reference`, `ipv4`, `ipv6`, `uuid`, `hostname`

### Known limitations

Running the whole Draft 2020-12 suite with nothing excluded, `format` and `default` under specification semantics (`assertFormat: false`, `useDefaults: false`), gives 1299 of 1299 cases. Draft 7 gives 927 of 927. The v1 dialect gives 1133 of 1133. `npm run test:suite` reproduces all three.

Areas that remain deliberate scope decisions for 1.x:

- **Remote `$ref` over the network** is not fetched. Register cross-schema refs explicitly with `schemas: [...]` or `addSchema()`.
- **`$vocabulary`** is honoured for evaluation: a keyword whose vocabulary the meta-schema does not declare is not part of the dialect, so it is treated as unknown and does not apply. What ata does not do is refuse a schema whose meta-schema requires a vocabulary ata does not recognise, which the specification says an implementation must do. That schema is evaluated with every keyword applied, as it was before.
- **`contentEncoding` / `contentMediaType` / `contentSchema`** are annotation-only, as the spec permits, and are not validated.
- **`minLength`/`maxLength`** count UTF-16 code units, not grapheme clusters.
- **Infinite-loop detection** relies on a recursion depth guard that cuts off circular `$ref` chains.
- **`default`** values are applied to validated data by default, where the spec treats `default` as a non-enforcing annotation. Pass `useDefaults: false` for the specification behavior.
- **`format`** is asserted by default rather than treated as an annotation. Pass `assertFormat: false` for the specification behavior.

If one of these blocks you, open an issue; scope decisions get revisited with real use cases.

## Building from Source

This section applies to contributors building the repository. Regular `npm install` users need not have a C++ toolchain.

### Development prerequisites

Native builds require C/C++ toolchain support and the following libraries:

- `re2`
- `abseil`
- `mimalloc`

Install them before running `npm run build`:

```bash
# macOS (Homebrew)
brew install re2 abseil mimalloc
```

```bash
# Ubuntu/Debian (apt)
sudo apt-get update
sudo apt-get install -y libre2-dev libabsl-dev libmimalloc-dev
```

```bash
# C++ library + tests
cmake -B build
cmake --build build
./build/ata_tests

# Node.js addon
npm install
npm run build
npm test

# JSON Schema Test Suite
npm run test:suite
```

## Project

- [CONTRIBUTING.md](CONTRIBUTING.md) explains how to build the project and what a
  pull request needs before it can be merged.
- [GOVERNANCE.md](GOVERNANCE.md) says who decides what, which changes the project
  will not accept and why, how releases are cut, and how someone becomes a
  maintainer. It states the bus factor plainly rather than leaving you to find
  it out.
- [SECURITY.md](SECURITY.md) is where vulnerabilities go. Not the issue tracker.
- [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) applies everywhere the project is
  discussed.

## License

MIT

## Contributors

[@mertcanaltin](https://github.com/mertcanaltin) &middot;
[@SukeshP1995](https://github.com/SukeshP1995) &middot;
[@lemire](https://github.com/lemire) &middot;
[@armagandalkiran](https://github.com/armagandalkiran) &middot;
[@pnodet](https://github.com/pnodet)

Missing from this list after landing a patch? Send a pull request.
