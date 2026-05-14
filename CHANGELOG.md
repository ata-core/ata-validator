# Changelog

All notable changes to ata-validator are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/), and this project adheres to semantic versioning.

## 0.13.4 — 2026-05-14

### Fixed

- **macOS arm64 prebuild shipped with an invalid code signature.** The release workflow runs `pkg-prebuilds-copy --strip`, which on macOS runs `strip -Sx` on the addon. `strip` rewrites the Mach-O and invalidates the ad-hoc signature the linker applied, and it does not re-sign. arm64 macOS refuses to load unsigned code, so `require('ata-validator')` was killed with `SIGKILL (Code Signature Invalid)` the moment the binding loader called into the addon. Only `0.12.6` reached users this way because it was the one release published through CI rather than locally. The workflow now re-signs and verifies the macOS prebuild after `strip`, and `codesign --verify` gates the job so a broken signature cannot ship. Fixes #23.
- **macOS x64 prebuild was never produced.** The prebuild matrix used `macos-14` for the x64 leg, but `macos-14` runners are Apple Silicon only, so that leg built an arm64 binary mislabeled as x64 and no `darwin-x64` prebuild ended up in the tarball. The leg now runs on `macos-13`, the Intel runner.

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
