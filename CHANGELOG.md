# Changelog

All notable changes to ata-validator are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/), and this project adheres to semantic versioning.

## 1.1.0 - 2026-07-18

### Added

- TypeBox-style modifier combinators on `ata-validator/t`: `t.pick`, `t.omit`, `t.partial`, `t.required`, `t.composite`, and `t.recursive`. All six emit plain JSON Schema, so `Infer`, the runtime validator, and the AOT pipeline consume them with no adapter. This closes the authoring-parity gap for TypeBox migrations. Note: `t.recursive` schemas validate through the interpreted engine and are not AOT-precompilable; the other five combinators AOT-compile like any schema.

### Changed

- The `ata-validator` package is now pure JavaScript: no bundled binaries, no vendored C++ sources, no install script. The native engine moved to per-platform `@ata-validator/native-*` packages, installed automatically as optional dependencies (the same pattern Vite uses for esbuild). The tarball shrinks from ~5.3 MB to under 300 KB. `npm install --omit=optional` or `ATA_NO_NATIVE=1` gives a guaranteed zero-binary setup; validation behavior is identical for every schema shape the JS engine compiles, and the few shapes that still need the native engine now throw a clear error instead (see Fixed below).

### Fixed

- Schemas the JS engine cannot compile (some `$dynamicRef`, cyclic `$ref`, and unusual keyword interactions) crashed with `Maximum call stack size exceeded` in environments without the native addon: the lazy `validate` stub and the rich-error wrapper dispatched to each other forever. These schemas now throw a clear "not supported by the pure-JS engine" error on first use. The same cycle could hit `isValidObject` even with the native addon present when it was the first method called; it now falls through to the full compile and validates correctly.

## 1.0.2 - 2026-07-17

### Fixed

- Cross-schema `$ref` pointers into `#/definitions/...` resolved to nothing after draft-07 normalization renamed the target to `$defs`, and the generated validator silently accepted invalid data. The pointer walk now treats `definitions` and `$defs` as aliases.
- Schemas passed by the caller (the `schemas` option, `addSchema()`, and the root schema) were normalized in place, mutating objects the caller still owns. Anyone reusing those objects afterwards, such as Fastify handing the same shared schema to its serializer, saw corrupted keys. Normalization now works on a copy; caller objects are never touched.
- The new copy preserves symbol-keyed markers, so `t.refine` refinements survive normalization and `validateAsync` keeps enforcing them.

## 1.0.1 - 2026-07-16

### Fixed

- `version()` reported 0.10.4 on platforms with a native prebuild: the `ATA_VERSION` constant in `include/ata.h` had not been bumped since 0.10.4 and the native answer takes precedence over `lib/version.js`. The header now carries the real version and the version-sync test checks it, so it cannot drift again.

## 1.0.0 - 2026-07-15

1.0 is a stability commitment, not a feature release. The API surface, the error result shape, and the error code registry are now covered by the semver guarantees in [docs/STABILITY.md](docs/STABILITY.md).

### Removed

- `Validator.prototype.toStandalone()` and `Validator.prototype.toStandaloneModule()`, deprecated in 0.22.0. Use `toStandaloneModule()`/`bundleStandalone()`/`bundleCompact()` from `ata-validator/build`. See [docs/migration-to-1.0.md](docs/migration-to-1.0.md).

### Changed

- Node.js 20 or newer is required. Node 18 reached end of life in April 2025.

### Added

- [docs/STABILITY.md](docs/STABILITY.md): semver, deprecation, and error-code guarantees.
- README "Known limitations" section documenting the deliberate 1.x scope edges.

## 0.22.0 - 2026-07-14

### Deprecated

- `Validator.prototype.toStandalone()` and `Validator.prototype.toStandaloneModule()` now emit a one-time DeprecationWarning. Both will be removed in 1.0. The replacements have been stable since 0.19: `toStandaloneModule()`/`bundleStandalone()`/`bundleCompact()` from `ata-validator/build`, and the `Validator.bundle*()` statics.

## 0.21.0 - 2026-06-01

### Added

- `errorMessage` keyword for custom error messages. A string on a subschema replaces the message for any failing keyword there; an object overrides per keyword, with `required` keyed by missing property name and `_` as fallback. `code`, `keyword`, and `path` fields are untouched. Schemas without `errorMessage` pay nothing; the override pass is only installed when one is present.
- Async refinement: `t.refine(schema, fn, { message, path })` attaches an async (or sync) check that runs through `validateAsync`/`parseAsync` after structural validation passes. `new Validator(schema)` ignores the refinement marker, so plain structural validation is unchanged. Failing refinements surface as errors with `keyword: 'refine'`.

## 0.20.1 - 2026-05-27

### Fixed

- `JSONSchema.items` now accepts `boolean` so the typed `t.tuple([...])` output (which sets `items: false` to close the tail) type-checks against `JSONSchema` without a constraint error. `items: false` is valid JSON Schema and the runtime already honoured it; the type definition just had not been widened. Anyone consuming `t.tuple` from outside a project with `skipLibCheck` ran into a `TTuple incorrectly extends JSONSchema` error.

## 0.20.0 - 2026-05-27

### Added

- New chainable schema builder at `ata-validator/t`. Each `t.X(...)` returns a plain JSON Schema literal, so the output drops straight into `new Validator(...)`, `defineSchema`, `Infer<S>`, and the AOT pipeline with no adapter. The migration target is TypeBox: rename `import { Type } from '@sinclair/typebox'` to `import { t } from 'ata-validator/t'` and keep the same authoring shape while picking up ata's runtime and AOT precompile.

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
  const v = new Validator(User)
  ```

  Covered: primitives (`string`, `number`, `integer`, `boolean`, `null`), composites (`object` with `optional` keys, `array`, `tuple`, `record`, `union`, `intersect`, `literal`, `const`, `enum`), and refs (`ref`). Optionality is carried by a Symbol-keyed marker that the emitted JSON Schema, `Object.keys`, `JSON.stringify`, and ata's codegen never see; the parent `t.object` reads it to compute `required`.

### Changed

- `Infer<S>` now resolves object schemas without `properties` but with a schema-valued `additionalProperties` to `Record<string, V>` instead of `Record<string, unknown>`. Closes the last common JSON Schema shape that was not inferred.

## 0.19.0 - 2026-05-27

### Added

- `ata-validator/build` now exports the AOT primitives `bundleStandalone`, `bundleCompact`, and `toStandaloneModule` as named functions, so callers that want the build surface in one place (bundler plugins, build scripts) no longer have to go through the `Validator` class. Same code paths as the Validator-bound forms, no behaviour difference.
- New top-level `ARCHITECTURE.md` reference document covering design principles, runtime dispatch, AOT pipeline, error enrichment, the two TypeScript paths, and the native layer.

### Changed

- Internal refactor: AOT (`toStandalone`, `toStandaloneModule`, `bundle`, `bundleStandalone`, `bundleCompact`, `loadBundle`) lives in `lib/aot.js`, the native addon loader in `lib/native-load.js`, the version string in `lib/version.js`. `index.js` lazy-requires the AOT module so a plain import never pays for code it does not call. The browser bundle drops `pkg-prebuilds`, `__dirname`, and `package.json` (with its dependency strings) entirely; it is roughly 15 KB smaller and contains no Node-only identifiers outside comments.
- The safe-regex engine is now embedded into standalone output from a baked string (`lib/safe-regex-source.js`, generated from `lib/safe-regex.js`) instead of a runtime `fs.readFileSync`. Browser AOT calls (`Validator.bundle`, `toStandaloneModule`, …) work in any bundler without an fs polyfill. A structural test (`tests/test_browser_imports_guard.js`) bundles both entries with esbuild and asserts no `readFileSync`, `pkg-prebuilds`, or `__dirname` survives outside comments; sync tests catch drift between the bundled strings and their sources.

## 0.18.2 - 2026-05-26

### Fixed

- The browser and edge build no longer touches the filesystem at import. The safe-regex engine source was embedded into standalone output through a `fs.readFileSync` that ran at module load, which crashed bundlers that stub `fs`/`path` for the browser (a regression from 0.17.3). The read is deferred to the first standalone compile that actually embeds the engine, so importing ata, validating, generating types, and compiling pattern-free schemas now run with no filesystem access in browsers and Cloudflare Workers. Added a regression test that bundles the browser entry and runs it with `fs`/`path` stubbed.

## 0.18.1 - 2026-05-26

### Added

- The browser entry (`index.browser.mjs`) re-exports `toTypeScript`, so the inferred TypeScript type for a schema can be generated client-side (for example in a web playground) alongside `Validator.toStandaloneModule()`. Pure re-export, no runtime change.

## 0.18.0 - 2026-05-25

### Added

- `Infer<S>` resolves the shapes 0.17.0 left as `unknown`. `anyOf` and `oneOf` map to unions, `allOf` to an intersection, `prefixItems` to a tuple, and a `$ref` to a local `#/$defs/...` or `#/definitions/...` entry resolves to the referenced type, including recursive references. An external or otherwise unresolvable `$ref` still resolves to `unknown` rather than erroring. `new Validator(schema)` carries the wider inference, so handlers narrow `result.data` for these schemas with no manual annotation, and the same applies to the Fastify type provider that builds on `Infer`. Pure `.d.ts` change, no runtime impact.

## 0.17.5 - 2026-05-25

### Fixed

- Compiled validators resolve draft-07 plain-name anchors. A `$defs`/`definitions` entry that declares an anchor with `$id: "#name"` and is referenced by `$ref: "#name"` now compiles through the codegen on every path (boolean, error, combined) instead of bailing. The bail forced a fallback that could not resolve sibling cross-schema refs, which surfaced as `cannot resolve $ref`. This is how shared schemas are referenced under Fastify.

## 0.17.4 - 2026-05-25

### Fixed

- Standalone output now embeds user-supplied format functions. `toStandaloneModule` and `bundleCompact` referenced the `_uf_<name>` format helpers without declaring them, so the generated module threw `_uf_<name> is not defined` on the first validation, and their error path skipped the custom format entirely (so `validate` disagreed with `isValid`). Both now serialize the format functions via `Function#toString` and run them on the error path too, matching `bundleStandalone`.
- Compiled validators report per-property errors for schema-valued `additionalProperties`. The AOT error path previously emitted a single generic `validation failed`; it now validates each undeclared property against the subschema and reports the precise `/<key>` error, matching the runtime validator.
- `ata --version` (and `-V`) prints the CLI version instead of failing with `unknown command`.

## 0.17.3 - 2026-05-25

### Security

- User-supplied `pattern`, `patternProperties`, and `propertyNames` regexes now run through a linear-time matching engine, so a crafted schema or input can no longer trigger catastrophic backtracking (ReDoS). Patterns the engine cannot represent, such as those using backreferences, fall back to the native `RegExp`. The built-in `format` checks (`email`, `uri`, `uri-reference`, `hostname`, `ipv4`, `ipv6`, `date`, `date-time`, `time`, `duration`, `uuid`) were routed through the same engine and stay linear on adversarial input.

## 0.17.2 - 2026-05-24

### Fixed

- `validate()` now returns the typed `data` on success, the validated input after any in-place coercion or defaults. The `ValidationResult<T>` type has carried `data: T` since 0.17.0, but the runtime never populated it, so `result.data` was `undefined`. `isValidObject()` and `abortEarly` stay allocation-free for callers that only need a boolean.

## 0.17.1 - 2026-05-24

### Fixed

- Standalone output for schemas with `anyOf` or `oneOf` no longer references undefined branch helpers. `toStandaloneModule` and `bundleCompact` now emit the hoisted branch functions, so the generated module runs instead of throwing on the first validation. `bundleStandalone` already emitted them.

## 0.17.0 - 2026-05-23

### Added

- Static type inference from JSON Schema literals. The new exported `Infer<S>` type maps a schema literal to its data type, and `new Validator(defineSchema({...}))` now returns `Validator<Infer<S>>`, so `validate()` narrows `result.data` with no manual type annotation. Write plain JSON Schema, get the type for free, no builder DSL. Covers primitives, type-array unions, `const`, `enum`, objects (required vs optional keys), and arrays; `$ref`, tuples, and `anyOf`/`oneOf` infer `unknown` for now. Pure `.d.ts` change, no runtime impact.

### Fixed

- `validateAndParse()` is now implemented in JavaScript (`JSON.parse` then validate) and returns `{ valid, value, errors }`. It previously called a native method that does not exist and threw on every call. It now works with or without the native addon and in the browser; malformed JSON returns `valid: false` with an `ATA9001` error instead of throwing.

## 0.16.0 - 2026-05-23

### Added

- `defineSchema` helper and the exported `JSONSchema` type. Wrap a plain schema object in `defineSchema(...)` to author it inline in TypeScript with keyword autocomplete and value checking, no `as const` needed. It is an identity function at runtime, so the returned object drops straight into `Validator`, `toStandaloneModule`, and the rest of the API. Requires TypeScript >= 5.0 for the `const` type parameter.
- OpenAPI `nullable` keyword. `{ type: 'string', nullable: true }` accepts `null` alongside the declared type, matching OpenAPI 3.0 schemas.

### Fixed

- `coerceTypes` with `type: 'array'` wraps a scalar into a single-element array instead of leaving it unchanged.
- Codegen resolves a `$defs` entry that carries a fragment `$id` and is reached through a pointer `$ref`.
- Preprocessing (defaults, coercion, `removeAdditional`) guards against `null` and non-object data instead of throwing.

## 0.15.1 - 2026-05-23

### Fixed

- Coercion, defaults, and `removeAdditional` now follow a cross-schema `$ref` to the referenced shape. A whole-schema reference like `{ $ref: 'shared#' }` (used for shared route schemas) or a property reference like `{ id: { $ref: 'shared#/properties/id' } }` is preprocessed instead of skipped.
- The compile cache now keys on referenced schema content, not just the `$id`. Two validators that share a root schema string and an `$id` pointing at different schemas no longer reuse the wrong compiled function.

## 0.15.0 - 2026-05-18

### Added

- **Compiler-grade error output.** Every validation error now carries a stable `code` (`ATA####`), an `expected`/`received` pair, a `docUrl`, and, when the input came in as a JSON string or Buffer, a `dataFrame` pointing at the offending bytes. The full registry of 46 codes lives at [`docs/error-codes.md`](docs/error-codes.md) with permalinks at `https://ata-validator.com/e/<CODE>`.
- **Renderer API.** `renderPretty`, `renderCompact`, and `renderJSON` are exported from `ata-validator`. Pretty output mirrors rustc-style code frames with carets, help, and note lines; compact collapses to one line per error; JSON is structured for tooling.
- **`ata validate` subcommand.** `ata validate <schema> <data>` runs a schema against a JSON data file and prints renderer output. TTY auto-renders pretty; pipes default to compact; `--format=json` returns structured output. `--pretty`, `--compact`, `--max-errors`, `--color`, `--no-color` cover the rest of the surface.
- **Runtime source maps.** `new Validator(schema, { source: { path, content } })` attaches per-error `schemaSource` (file, line, col, text) by re-parsing the schema with a position-aware scanner.
- **AOT source maps.** AOT-compiled validators carry the structured error fields (`code`, `docUrl`) and embed per-error `schemaSource` when built with the source map enabled. On by default in development, off when `NODE_ENV=production` or `--no-source` is passed.
- **`ata compile` / `ata build` flags.** New `--source` / `--no-source` flags. `ata build --dual` emits both a source-mapped artifact (`*.compiled.mjs`) and a stripped one (`*.compiled.min.mjs`) in a single run.
- **Size budget gate.** `npm run bench:size` enforces a gzipped-byte budget over the AOT codegen output to catch silent bundle bloat. Baseline at `benchmark/baselines/aot-size.json`, gates derive from the baseline with 1.5x headroom.
- **`oneOf` / `anyOf` collapse.** Branching failures collapse to a single best-branch error (`ATA4001` / `ATA4002` / `ATA4003`) instead of the full branch-tree. The closest matching variant's errors are still available under `branchErrors`. `allOf` errors continue to surface every failing branch.
- **Suggestions.** A new `suggestion` field nudges users when ata is confident: typo against enum, missing-required typo, format-violation hint, type-coercion nudge. Runtime validators populate automatically; AOT validators expose `attachSuggestions(errors, data)` to keep AOT bundles small.
- **`richErrors: false` opt-out.** `new Validator(schema, { richErrors: false })` preserves the v0.14 error shape byte-for-byte. `abortEarly: true` continues to short-circuit; the returned error carries `code: 'ATA9000'` and no enrichment.
- **`release:check` npm script.** Runs the prebuilds, doc-coverage, and error-code lockfile checks in strict mode before a publish.

### Changed

- `prepublishOnly` now chains `check-prebuilds`, `check-doc-coverage` (lenient until per-code prose lands), and the error-code lockfile test.
- `ata compile` and `ata build` failures route through the renderer with code `ATA9002`, so command-line schema errors look the same as runtime ones.

### Notes

- **Log scrapers**: errors now carry `code`, `dataFrame`, `suggestion`, and `docUrl` fields. If you serialize `result.errors` directly into logs, line size will grow. Pass `richErrors: false` for the v0.14 shape, or pipe through `renderCompact` for a stable one-line format.
- **AOT bundle size**: source-mapped variants (`.compiled.mjs`) add up to 200 bytes gzipped for a 10-field schema. Production builds (`NODE_ENV=production` or `--no-source`) emit the no-source variant. Use `ata build --dual` to emit both.
- **Fastify**: a companion `fastify-ata` release wires the new format into route error responses.

## 0.14.0 - 2026-05-16

### Added

- Generic `Validator<T>` with type predicate `isValidObject(data): data is T`. Pairs naturally with TypeBox, Zod-from-JSON-Schema, Valibot, or hand-written types over JSON Schema literals.
- `ValidationResult<T>` and `ValidateAndParseResult<T>` are discriminated unions. On the `valid: true` branch the parsed data is typed; on `valid: false` the `errors` array carries the diagnostic information.

### Changed

- Type-level only: accessing `result.data` (or `result.value` on `validateAndParse`) without first checking `result.valid` is now a TypeScript compile error. Runtime behavior is unchanged. The previous shape returned `undefined` in that position, so this surfaces an existing latent bug at compile time.

### Notes

- Pure `.d.ts` change. No JS, C++, AOT, or CLI behavior is affected. Bundle size unchanged. Runtime performance unchanged.

## 0.13.4 — 2026-05-14

### Fixed

- **macOS arm64 prebuild shipped with an invalid code signature.** The release workflow runs `pkg-prebuilds-copy --strip`, which on macOS runs `strip -Sx` on the addon. `strip` rewrites the Mach-O and invalidates the ad-hoc signature the linker applied, and it does not re-sign. arm64 macOS refuses to load unsigned code, so `require('ata-validator')` was killed with `SIGKILL (Code Signature Invalid)` the moment the binding loader called into the addon. Only `0.12.6` reached users this way because it was the one release published through CI rather than locally. The workflow now re-signs and verifies the macOS prebuild after `strip`, and `codesign --verify` gates the job so a broken signature cannot ship. Fixes #23.
- **macOS x64 prebuild was never produced.** The prebuild matrix used `macos-14` for the x64 leg, but `macos-14` runners are Apple Silicon only, so that leg built an arm64 binary mislabeled as x64 and no `darwin-x64` prebuild ever ended up in the tarball.

### Removed

- **macOS x64 prebuild.** `macos-13` GitHub runners, the only ones that build x64 natively, are no longer reliably available. Since no published version ever shipped a working `darwin-x64` prebuild, this is not a regression. Intel Mac users fall back to the JS engine, which still works, only the buffer APIs are slower.

### Changed

- **`prepublishOnly` now blocks tarballs missing platform prebuilds.** A local `npm publish` only carries the publisher's own platform, silently dropping every other prebuild. Publishing now fails unless all seven platform prebuilds are present, and when run on a Mac it also verifies the darwin code signatures.

## 0.13.3 — 2026-05-13

### Fixed

- **`Validator.bundleStandalone` dropped hoisted anyOf/oneOf branch helpers from the bundle output.** Schemas whose codegen hoists branch functions like `_af1_b0` to the per-schema preamble (e.g. allOf wrapping an anyOf, or schemas pulled into a cross-`$ref` bundle) emitted JS that referenced these helpers without defining them, so loading the bundle threw `ReferenceError: _af1_b0 is not defined` on first validation. The standalone preamble now propagates through to the bundle alongside the format-closure serialization that was already there. `toStandalone` (single-schema) was unaffected. Fixes #24.

## 0.13.2 — 2026-05-09

### Fixed

- **Invalid validation crashed in environments without the native addon** (Cloudflare Workers, browsers, Bun without N-API). When the JS error-codegen probe couldn't produce a safe error function, `errFn` fell through to `this._compiled.validate(d)`. With no native addon `_compiled` stays `null`, so the call threw `TypeError: Cannot read properties of null (reading 'validate')`. Valid inputs were unaffected because they short-circuited before reaching `errFn`. The fallback now stays on a JS-only path when `native` isn't present, returning the boolean result with a generic detail-not-available error so callers see `{ valid: false, errors: [...] }` instead of a crash. Added `tests/test_no_native.js` (Workers-style sandbox) to lock the behavior. Fixes #22.

## 0.13.1 — 2026-05-09

### Fixed

- **Custom format checkers in `validate()`** are now actually applied. The combined codegen path (used by `Validator#validate` and one-shot `validate()`) silently dropped the `userFormats` argument, so schemas with `format: <user-defined>` returned `{ valid: true }` regardless of the checker function's return value. The boolean (`isValidObject`) and error-only paths were already wired correctly. Fixes RJSF integration where custom formats are routed through `customFormats` (rjsf-team/react-jsonschema-form#5052).
- **Glob patterns with backslash separators on Windows** now resolve correctly in `ata build`. The Node 18 fallback regex only recognized forward slashes, so `path.join(dir, '*.json')` produced patterns the matcher couldn't parse on `windows-latest` runners.

## 0.13.0 — 2026-05-09

### Added

- **`ata build <glob>`** subcommand for project-wide AOT compilation. Compiles each matched schema to a per-file `.compiled.mjs` ESM module with a sibling `.d.mts` TypeScript declaration. Production bundles can drop the runtime ata-validator dependency entirely and import compiled validators as plain ESM modules.
- **`ata-validator/build` programmatic subpath export.** `import { build, watch } from 'ata-validator/build'` exposes the same engine the CLI uses, so build pipelines and bundler plugins can integrate without going through the CLI.
- **CLI flags for `ata build`:** `--out-dir`, `--suffix`, `--format esm|cjs`, `--abort-early`, `--no-types`, `--cache-file`, `--check`, `--watch`, `--max-size`, `--strict`.
- **Incremental cache** via content-hashed `--cache-file`. Second run on unchanged inputs skips compilation.
- **YAML schema support** when the `yaml` peer dependency is installed (optional). `.yaml` and `.yml` inputs parse the same as `.json`.
- **AOT vs AJV-runtime benchmark** at `benchmark/bench_aot_vs_ajv.mjs`. On the included fixtures, ata-AOT outputs are 25-56x smaller gzipped than the AJV runtime, cold start is ~2x faster, throughput is 2-4.5x faster, and compile time is 71-246x shorter.

### Fixed

- **Standalone modules now correctly serialize closure-bound helpers** (RegExp, Set, sub-validator functions, branch-property arrays) into the emitted `.mjs`. Previously, schemas using `patternProperties`, `propertyNames` with regex, or `unevaluatedProperties` with `anyOf`/`oneOf` produced standalone output that referenced undefined variables (`_ppf0_0`, `_re*`, `_es*`, `_bk*`) and threw `ReferenceError` at runtime. The runtime validation path was unaffected.

### Notes

- The runtime `Validator` API and the `ata-validator/compat` AJV-shim remain unchanged. Existing dynamic-schema users have no migration to do.
- Bundler plugins (ata-vite v0.2.0, ata-webpack, ata-codemod-ajv) are out of scope for this release and will land in 0.14.0+.
