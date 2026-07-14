# Stability policy

This document describes what 1.0 means for ata-validator and what you can rely on across releases.

## Semver

ata-validator follows semantic versioning. From 1.0.0 on:

- Breaking changes to any public API ship only in major releases.
- New features ship in minor releases and never change existing behavior.
- Patch releases fix bugs without changing documented behavior.

## What is public API

- The root export (`ata-validator`): `Validator` and its documented instance and static methods, `defineSchema`, `Infer`, `JSONSchema`, `validate`, `validateAsync`, `parseAsync`, `compile`, `parseJSON`, `createPaddedBuffer`, `toTypeScript`, `version`, `SIMDJSON_PADDING`, the renderers (`renderPretty`, `renderCompact`, `renderJSON`), and the Standard Schema V1 surface (`~standard`).
- The subpath exports: `ata-validator/t`, `ata-validator/build`, `ata-validator/compat`.
- The `ata` CLI commands and flags documented in the README.
- The error result shape and the error code registry (below).

Anything under `lib/`, `src/`, `include/`, or `deps/` is internal. Reaching into internals is not covered by semver.

## Error codes

Error codes (`ATA1001` through `ATA9002`) are locked: a code is never deleted, renamed, or reassigned to a different meaning. Retired codes are marked deprecated in the registry and keep their permalink at https://ata-validator.com/e/<CODE>. The lock is enforced in CI (`tests/test_error_codes_lock.js`).

## Deprecation policy

APIs are deprecated in a minor release before removal in the next major:

1. A minor release adds an `@deprecated` JSDoc tag and, where practical, a one-time runtime DeprecationWarning naming the replacement.
2. The following major release removes the API. The changelog and a migration note document the replacement.

Example: the instance methods `toStandalone()`/`toStandaloneModule()` were deprecated in 0.22.0 and removed in 1.0.0 in favor of the `ata-validator/build` functions.

## Spec coverage

ata-validator targets JSON Schema Draft 2020-12 (plus Draft 7) and passes 98.5% of the official test suite. Known limitations are documented in the README's "Known limitations" section and are considered scope decisions, not bugs, for the 1.x line.

## Platform support

Native prebuilds ship for Linux x64/arm64 (glibc and musl), macOS arm64, and Windows x64. On any other platform the package installs and runs on the pure-JS engine; the buffer-based APIs that require the native addon say so in their documentation and error clearly.

Node.js 20 or newer is required as of 1.0.0.
