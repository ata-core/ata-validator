# Edge runtimes and strict CSP

Most JSON Schema validators compile a schema by generating JavaScript source and
handing it to `new Function`. Several runtimes refuse that:

- Cloudflare Workers, and `workerd` wherever it is run (Cloudflare has made
  self-hosting it a supported way to run Workers, and the Deno team joined
  Cloudflare in October 2026 to take that further)
- Deno Deploy, until it closes: Cloudflare is moving its customers to Workers
  over the six months from that announcement
- Browser pages served under a Content-Security-Policy without `unsafe-eval`
- Various embedded and mobile JavaScript runtimes

ata detects that code generation is unavailable and validates by walking the
schema directly instead. Nothing to configure and no separate build for it.

Every figure on this page was measured on `wrangler dev`, which runs the same
`workerd` that Cloudflare runs in production, using ata 1.5.0. Checked again
on 2026-10-09 with ata 1.48.0 and wrangler 4.149: the
[Hono starter](https://github.com/ata-core/hono-ata-starter), a compiled
schema behind a route, answers a valid body with 201 and an invalid one with
400 and the error list through `workerd` at 0.85 ms a request on a laptop,
with no compatibility flag.

An MCP server is the same shape with a different caller: the
[MCP starter](https://github.com/ata-core/mcp-ata-workers-starter) compiles
each tool's `inputSchema` and serves it through `@ata-project/mcp/aot`, so
the Worker carries no validator engine and a wrong tool call comes back to the
model naming the field, what was expected and what arrived. Through `workerd`
a validated `tools/call` answers in 1.34 ms at the median.

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

## The lite entry

On a worker or a page nothing generates code anyway, so the generator is dead
weight in the bundle. `ata-validator/lite` leaves it out:

```ts
import { Validator } from 'ata-validator/lite'
```

Same `Validator`, same verdicts and errors, on the interpreted engine; it
passes the official suite in the same three dialects, and a parity test holds
it to the full entry's answers. What it lacks is `parse()` and the
ahead-of-time bundle methods, which need the generator. A Hono app with one
validated route bundles to 58 KB gzipped with it against 136 KB with the full
entry (esbuild, browser platform, 2026-10-08).

## Deno and Deno Deploy

Same code, from npm or from JSR:

```ts
import { Validator } from 'npm:ata-validator'
// or
import { Validator } from 'jsr:@ata/validator'
```

Deno Deploy is closing: the Deno team joined Cloudflare in October 2026 and
its customers move to Workers, where the section above applies as it is. The
Deno runtime itself is maintained for a year more and open source after that;
the package keeps working there, and JSR stays, now on Cloudflare's
infrastructure.

The JSR package re-exports the npm package of the same version, so the two are
the same engine. CI runs the package under Deno on every change: the official
suite in its five dialects (1301, 1261, 929, 841 and 1135 cases, all passing), the
suite with `eval` and `new Function` blocked, and a smoke test that refuses
dynamic code the way Deno Deploy does and checks that the interpreted engine
answers. On Deno Deploy itself nothing was timed, and with its closing nothing
will be; the guarantee is the eval-free one above, which these tests cover.

Two things a Deno user meets on a release day: Deno's minimum dependency age
refuses an npm version younger than 24 hours unless `--min-dep-age` or
`minimumDependencyAge` in `deno.json` says otherwise, and the JSR version
appears a few minutes after the npm one, since it waits for it.

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

With code generation blocked, ata passes **1301 of 1301** cases on Draft 2020-12,
**1261 of 1261** on Draft 2019-09, **929 of 929** on Draft 7, **841 of 841** on
draft-06 and **1135 of 1135** on the v1 dialect, the same figures the compiled
path scores.

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

Those four agree with `validate()` on every case of the official suite. The
native walker behind them does not handle every shape, so for schemas using
`contains`, `unevaluatedProperties`, `patternProperties`, tuple `items`,
cross-document `$ref` and a few formats (the list is in `lib/buffer-gate.js`)
they parse the bytes and answer through `validate()`. Typical request schemas
stay on the zero-copy path. `tests/test_buffer_path_parity.js` holds the
disagreement count at zero on every run.
