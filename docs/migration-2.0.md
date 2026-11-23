# Migrating to 2.0

2.0 changes what `ata-validator` resolves to in a browser bundle and in a
Workers or edge bundle. Code that runs in Node is not affected.

## Who has to change something

| How the package is loaded | What it resolves to in 2.0 | Change needed |
|---|---|---|
| Node, `import` or `require` | `index.mjs`, `index.js`, as in 1.x | none |
| A bundle for Node (the `module` condition) | `index.bundle.mjs`, as in 1.x | none |
| The `aot` condition | `index.aot.mjs`, `index.aot.js`, as in 1.x | none |
| A browser bundle (the `browser` condition) | `index.v2.browser.mjs`, `index.v2.browser.js` for `require` | read on |
| Cloudflare Workers and Vercel Edge (`workerd`, `edge-light`) | `index.v2.edge.mjs`, `index.v2.edge.js` for `require` | read on |

The Node entries keep the 1.x Validator with every option, method and export
this page lists as gone from the other two. The subpath exports
(`ata-validator/compat`, `/build`, `/aot`, `/compiled` and the others) are the
same files as before. New in 2.0: `ata-validator/features`,
`ata-validator/features/<name>` and `ata-validator/v2/plugin-core`, which the
build plugin uses.

The 1.x browser and edge entry files (`index.browser.mjs`, `index.edge.mjs`,
`index.edge.js`) are still in the package, but no export names them. A page
that needs something this page lists as gone, and cannot move it to Node or
to build time, stays on `ata-validator@1`.

## Why

The 2.0 entries carry a smaller Validator. Measured on the packed 2.0.0
tarball with esbuild 0.28.2, minified, gzip -9, for a page whose only import
is `import { Validator } from 'ata-validator'`:

| Bundle | 1.65.0 | 2.0.0 |
|---|---:|---:|
| browser, first load | 58,144 B | 26,154 B |
| Workers (`workerd`) | 67,332 B | 50,713 B |

The 1.65.0 browser entry also loads the code generator later, in chunks of
its own, once a validator is used often; the 2.0 browser entry does not load
it unless the page registers the `codegen` feature.

## What the 2.0 entries export

One name: `Validator`. There is no default export.

Gone from the browser and worker entries: `compile`, `validate`,
`validateAsync`, `parseAsync`, `parseJSON`, `version`, `createPaddedBuffer`,
`SIMDJSON_PADDING`, `defineSchema`, `schemaOf`, `toTypeScript`,
`renderPretty`, `renderCompact`, `renderJSON`, `toOutput`, `toRetryMessage`,
`describeSchema`, and the default export.

On the class:

- Kept: `validate`, `isValidObject`, `validateJSON`, `isValidJSON`,
  `addSchema`, `~standard`.
- New: `Validator.use(...features)`.
- Gone: `isValid`, `countValid`, `batchIsValid`, `isValidNDJSON`,
  `isValidParallel`, `isValidPrepadded`, `parse`, `validateAndParse`,
  `engine`, and the statics `bundle`, `bundleCompact`, `bundleStandalone`,
  `fromStandalone`, `loadBundle`.

Modules written by `ata build` do not go through the Validator class. They
load through `ata-validator/compiled` and its siblings, as before.

`index.d.ts` still describes the Node entry for every condition. It does not
declare `Validator.use`, and it declares the names above although a browser
or worker bundle no longer has them. A missing named import is an error
from the bundler in an ES module, and `undefined` at run time through
`require`. It is not a type error.

## Errors

Without the `richErrors` feature, an error has the five fields that
`richErrors: false` gave on 1.x:

```js
{ keyword: 'type', instancePath: '/a', schemaPath: '#/properties/a/type',
  params: { type: 'integer' }, message: 'must be integer' }
```

1.x gave the rich fields by default (`code`, `docUrl`, `expected`,
`received`, `detail`, `rank` and the rest). To get them on 2.0:

```js
import { Validator } from 'ata-validator'
import { richErrors } from 'ata-validator/features/richErrors'
Validator.use(richErrors)
```

`Validator.use()` registers a feature for every Validator of the bundle. Call
it once, before the first validator is used.

`validateJSON()` on text that is not JSON returns the `__parse__` error with
the same five fields. The frame of the text that 1.x attached is not there.

## Features

What a schema or an option needs is refused by name until the page registers
it. The refusal is an `Error` whose message starts with `ata2:`, thrown by the
first `validate()`, `isValidObject()`, `validateJSON()` or `isValidJSON()`
call of that validator, not by the constructor.

| Needed by | Refusal | Import | Bytes added to the browser bundle |
|---|---|---|---:|
| the rich error fields; `richErrors: true` | `ata2: richErrors, Validator.use(richErrors)` | `ata-validator/features/richErrors` | 5,210 |
| `verbose: true` | `ata2: verbose, Validator.use(verbose)` | `ata-validator/features/verbose` | 214 |
| `coerceTypes` | `ata2: coerceTypes, Validator.use(coerceTypes)` | `ata-validator/features/coerceTypes` | 1,213 |
| `removeAdditional` | `ata2: removeAdditional, Validator.use(removeAdditional)` | `ata-validator/features/removeAdditional` | 1,233 |
| the `errorMessage` keyword in a schema | `ata2: errorMessage, Validator.use(errorMessages)` | `ata-validator/features/errorMessages` | 379 |
| a `$ref` to a json-schema.org meta-schema | `ata2: metaschemas, Validator.use(metaschemas)` | `ata-validator/features/metaschemas` | 2,240 |

Each figure is that feature alone, same method as the table above. All six
together add 9,427 B.

A page that does not pass `richErrors` gets the plain fields and no refusal.
Only asking for the rich ones by name, with `richErrors: true`, is refused
without the feature.

Everything else a schema can ask for is in both entries without registering
anything: every format, defaults, `uniqueItems` and `~standard`.

Not available on the 2.0 entries, with or without a feature: a registered
meta-schema whose `$vocabulary` turns keywords off (`ata2: vocabularies`).

## Options

The 2.0 entries know these options: `coerceTypes`, `removeAdditional`,
`useDefaults`, `richErrors`, `abortEarly`, `formats`, `schemas`,
`assertFormat`, `baseURI`, `verbose`.

Any other key whose value is not `undefined` is refused by the constructor
with `ata2: option <name>`. 1.x ignored a key it did not know. The Node
entries still do.

| Option | 1.x | 2.0 browser and worker entries | What to do |
|---|---|---|---|
| `engine` | `'interpreter'` kept a schema off generated code; other values than `'auto'` threw | refused: `ata2: option engine` | Delete it. These entries generate no code unless the page registers `codegen`. |
| `keywords` | custom keywords, on the interpreted engine | refused: `ata2: option keywords` | No custom keywords on these entries. Validate with the Node entry, or express the check as a `formats` function where it reads one string. |
| `strictSchema` | `true` threw on authoring mistakes, `'log'` warned | refused: `ata2: option strictSchema`, for `false` as well | Delete it, and run the check where the schema is written: a test or a build step on the Node entry. |
| `logger` | received `strictSchema: 'log'` warnings | refused: `ata2: option logger` | Delete it with `strictSchema`. |
| `source` | errors carried a `schemaSource` frame | refused: `ata2: option source` | Delete it. The frame is on the Node entry. |
| any key 1.x did not know | ignored | refused: `ata2: option <name>` | Delete it. |

None of the five is accepted and ignored. Two of them change the answer
(`keywords`, `strictSchema: true`), and ignoring `engine: 'interpreter'`
would hand a schema to the code generator on a page that registered
`codegen`. For the other two the cost decided: each accepted name adds 5 to
7 B gzip to every page that carries the Validator (measured on the plugin
core, 14,592 B), and the entries were held to no growth.

## The build plugin

`@ata-project/unplugin` compiles a `new Validator(schema, options)` it can
read into a module at build time. With ata-validator 2.0.0 the modules also
take `formats` written as functions, `schemas` and `assertFormat`; a plugin
release that names 2.0.0 for those options is needed for that. The plugin
stops the build when the ata-validator it compiles with and the one the page
resolves state different versions.

Plugin 0.17.0 with ata-validator 2.0.0 built the three pages we tried, and
they answered the same. A validator that passes one of those three options
stays on the 2.0 browser entry there.

## Packages that depend on ata-validator

- `@rjsf/validator-ata` 6.11.1 depends on `ata-validator ^1.56.0`. npm keeps
  a 1.x copy inside it, also when the application installs 2.0.0, so rjsf
  forms keep working and keep the 1.x browser entry. Do not force it onto
  2.0 with an `overrides` entry: the package passes `verbose: true`, every
  validator then throws `ata2: verbose, Validator.use(verbose)`, the package
  reads that as invalid, and every document fails (3,845 of 3,845 documents
  of the JSON Schema Test Suite, draft-07 and 2020-12, in our run). With
  `verbose` and `metaschemas` registered before the package loads, the same
  run gave the answers of 1.65.0 on all 3,845 and on 33 playground samples.
  No release of the package supports 2.0 yet.
- `@hookform/resolvers` declares the optional peer `ata-validator ^1.23.0`.
  npm 11.19.0 installed 2.0.0 beside it in a new project with an `ERESOLVE
  overriding peer dependency` warning. `ataResolver` runs on the 2.0 browser entry.

## Checklist for a browser or worker bundle

1. Replace a default import, and any named import other than `Validator`.
2. If the code reads `code`, `docUrl`, `expected`, `received` or another rich
   field of an error, register `richErrors`.
3. Register the feature for each of `verbose`, `coerceTypes`,
   `removeAdditional`, the `errorMessage` keyword and meta-schema references
   that the page uses.
4. Delete `engine`, `strictSchema`, `logger`, `source` and any key the list
   above does not name.
5. Run the page once. Anything left is an `ata2:` error that names what is
   missing.
