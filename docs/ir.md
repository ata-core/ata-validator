# The IR compiler

`ata-validator/ir` compiles a JSON Schema from one definition per keyword.
Each keyword's check, message, params and error enrichment are written once
(`lib/kernels`). A front end turns a schema into a small intermediate
representation and decides everything the schema fixes: messages, paths, the
checks a known type makes redundant, which nodes collect annotations, a
default fill of its own. Two backends read that representation without
knowing any keyword.

It is experimental within 1.x (see [STABILITY.md](STABILITY.md)). No entry of
this package uses it. `@ata-project/unplugin` compiles with it by default.

## Two backends

`specialize(schema, options)` writes a JavaScript module. The module exports
`isValid(data)` and `validate(data)`, which answer as the `Validator` does,
and imports its helpers from `ata-validator/kernels`, one export each, so a
page with several modules carries each helper once.

```js
import { specialize } from 'ata-validator/ir'

const source = specialize(schema, { richErrors: true })
// import {E,isObj,own,...} from "ata-validator/kernels"
// export function isValid(d){...}
// export function validate(d){...}
```

`compileClosures(schema, options)` builds closures in memory, without `eval`
or `new Function`, so it runs under a Content Security Policy that blocks code
generation.

```js
import { compileClosures } from 'ata-validator/ir'

const check = compileClosures(schema, { coerceTypes: true })
check.validate({ age: '42' })
```

Both take `richErrors`, `useDefaults`, `assertFormat`, `schemas` and
`baseURI`. The closures also take `coerceTypes`, `removeAdditional`,
`verbose`, `abortEarly`, schemas with `errorMessage`, and what a module
cannot carry, the caller's functions: `keywords` (including those that read
and change their data's context) and `formats`.

## What it refuses

A schema or option outside what a backend covers throws an error whose
message starts with `ir:`. A caller falls back on that; the plugin keeps its
previous compiled module. The module writer refuses custom keywords, custom
formats, `errorMessage`, `coerceTypes`, `removeAdditional`, `verbose`,
`abortEarly`, and a v1 `$dynamicRef` that resolves only on the dynamic
scope. Both refuse `coerceTypes` or `removeAdditional` together with a
reference to a meta-schema.

## How it is checked

Both backends give the same verdicts and the same errors as the `Validator`,
every field in order, rich and plain:

- every group of the official test suite in six dialects (2020-12 384 of 384,
  2019-09 373, draft-07 258, draft-06 233, draft-04 160, v1 348; the module
  writer leaves 4 v1 groups to the closures), `tests/test_ir_suite.mjs`;
- 31,822 SchemaStore documents across all 492 schemas that ship samples;
- generated documents over every option and feature above,
  `tests/test_ir_differential.mjs` and `tests/test_ir_closure_features.mjs`;
- a minified browser bundle of the closures against the unbundled ones,
  `tests/test_ir_minified.mjs`.

## Where it differs

- Behind a `$ref` by URI to a resource in the same document, the `Validator`
  cannot place errors in schema order and keeps its own walk order. The IR
  keeps schema order. Two of the SchemaStore documents show it.
- An infinite number under a union type, or with no type, gets the numeric
  bounds; the `Validator` skips them there.
- Patterns run on the platform's RegExp. The `Validator` runs the patterns its
  linear-time engine accepts on that engine, so a pattern that backtracks
  badly costs more here on a hostile input.
