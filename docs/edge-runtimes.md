# Edge runtimes and strict CSP

Most JSON Schema validators compile a schema by generating JavaScript source and
handing it to `new Function`. Several runtimes refuse that:

- Cloudflare Workers
- Deno Deploy
- Browser pages served under a Content-Security-Policy without `unsafe-eval`
- Various embedded and mobile JavaScript runtimes

ata detects that code generation is unavailable and validates by walking the
schema directly instead. Nothing to configure and no separate build for it.

Every figure on this page was measured on `wrangler dev`, which runs the same
`workerd` that Cloudflare runs in production, using ata 1.5.0.

## Cloudflare Workers

No compatibility flags. `nodejs_compat` is **not** required.

```jsonc
// wrangler.jsonc
{
  "name": "my-worker",
  "main": "src/index.js",
  "compatibility_date": "2026-08-01"
}
```

```js
// src/index.js
import { Validator } from 'ata-validator'

const v = new Validator({
  type: 'object',
  properties: {
    id: { type: 'integer', minimum: 1 },
    email: { type: 'string', format: 'email' },
  },
  required: ['id', 'email'],
})

export default {
  async fetch(request) {
    let body
    try {
      body = await request.json()
    } catch {
      return Response.json({ error: 'invalid json' }, { status: 400 })
    }

    const result = v.validate(body)
    return Response.json(result, { status: result.valid ? 200 : 400 })
  },
}
```

An invalid payload comes back with the same errors you get anywhere else:

```json
{
  "valid": false,
  "errors": [
    {
      "code": "ATA2003",
      "keyword": "minimum",
      "instancePath": "/id",
      "message": "must be >= 1",
      "docUrl": "https://ata-validator.com/e/ATA2003"
    }
  ]
}
```

## Compile schemas ahead of time

The example above ships the whole library so it can compile the schema when the
Worker starts. If the schemas are known at build time, compile them then instead.
The output is a module that imports nothing at all, so none of the library
reaches the bundle.

```
npx ata build 'schemas/*.json' --out-dir src/schemas --format esm
```

```
schemas/user.json -> src/schemas/user.compiled.mjs (4,524 bytes)
```

```js
// src/index.js
import { validate } from './schemas/user.compiled.mjs'

export default {
  async fetch(request) {
    const result = validate(await request.json())
    return Response.json(result, { status: result.valid ? 200 : 400 })
  },
}
```

A compiled module exports `validate` and `isValid` as named exports. Its default
export is an object holding both, not a function, so `import validate from` will
not work.

What that costs, same schema, same Worker, measured with `wrangler deploy --dry-run`:

| | upload | gzip |
|---|---|---|
| runtime API | 375.27 KiB | 66.94 KiB |
| compiled ahead of time | 5.13 KiB | 1.31 KiB |

Add `--abort-early` if you only need a valid/invalid answer; it drops the error
detail and shrinks the module further.

Worth doing when the schemas are static. The runtime API is the better choice
when schemas arrive at runtime, for instance from a database or a tenant
configuration.

## Deno Deploy

Same code, imported from npm:

```ts
import { Validator } from 'npm:ata-validator'
```

Unlike the Workers example above, this one has not been measured on the real
platform. It rests on Deno Deploy refusing `new Function` the same way, which is
the property the test below covers. If it does not work for you, please open an
issue.

## Browsers under a strict CSP

A policy without `unsafe-eval` is enough:

```
Content-Security-Policy: default-src 'self'; script-src 'self'
```

Bundlers pick up the browser build through the `exports` field without
configuration. As with Deno, this follows from the eval-free guarantee rather
than from a measurement in a browser under a real CSP header.

## What is guaranteed, and how it is checked

Working eval-free is a tested property rather than something the architecture
happens to allow. `tests/test_no_eval.js` blocks `eval` and `new Function`
before ata is loaded and runs the entire official test suite through it. It runs
as part of `npm test`, and the run fails if the result drops.

With code generation blocked, ata passes **1286 of 1290** cases on Draft 2020-12
and **910 of 922** on Draft 7. For comparison, the compiled path scores 1285 and
911 on the same suite: the difference either way is a single case.

## What needs the native addon

The optional native accelerator does not exist on these runtimes, and the APIs
built on it are unavailable. They throw a clear error rather than failing
quietly:

- `isValid()` on a raw `Buffer` or `Uint8Array`
- `countValid()` and `batchIsValid()`
- `validateAndParse()`

Use `validate()` and `isValidObject()`, which take already-parsed values and work
everywhere. Everything else, including formats, `$ref`, `$dynamicRef`,
`unevaluatedProperties` and the full error output, behaves the same.
