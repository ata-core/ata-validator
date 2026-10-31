# Security Policy

## Reporting a Vulnerability

If you find a security vulnerability in ata-validator, please report it responsibly.

**Do not open a public GitHub issue for security vulnerabilities.**

Instead, report it privately through GitHub (Security tab, "Report a vulnerability") or email mertgold60@gmail.com with:

- Description of the vulnerability
- Steps to reproduce
- Potential impact

We will respond within 48 hours and work with you on a fix before any public disclosure.

## Scope

Security issues we care about:

- ReDoS in pattern validation for patterns without backreferences or lookaround (see below)
- Buffer overflows or memory safety issues in the C++ layer
- Code injection through schema compilation (`new Function()` paths)
- Prototype pollution through validation or coercion

## Supported Versions

| Version | Supported |
|---------|-----------|
| Latest minor release | Yes |
| Older releases | No, upgrade to the latest |

Fixes ship in a new patch or minor release. Every 1.x release is compatible
with the one before it, so moving to the latest minor to get a fix does not
mean changing your code. A change that would break that waits for 2.0.

What a report can expect:

- An answer within 48 hours.
- For a vulnerability that lets crafted input or a crafted schema run code,
  pollute prototypes, crash the process or make validation accept what it
  should reject: a fixed release within 7 days of confirming it.
- A published GitHub security advisory for every fixed vulnerability, naming
  the affected versions and the release that fixes it.

The project has one maintainer (see GOVERNANCE.md). These are commitments one
person can keep, and they are stated so you can hold the project to them.

## ReDoS

Patterns run on ata's own regular expression engine, which matches in linear time. The platform RegExp takes a pattern only when it is shown to run in linear time there too. The linear engine does not take a pattern with a backreference, a lookaround, a Unicode property escape (`\p{...}`), `\B`, `\c` or `\k`, or with counted repeats that expand past its budget of 65,536 instructions (`a{100000}` does, and so does `((a|b){1000}){100}`). Such a pattern runs on the platform RegExp as written, which can backtrack: if your schemas come from untrusted sources, keep those constructs out of them. If you find a slow pattern that uses none of them, please report it.

## What a package scanner reports

Socket and similar scanners flag the published package for the following. Each is in the code on purpose; this is where and why.

- **Dynamic code execution.** The code generator builds a validator for a schema with `new Function` (`lib/js-compiler.js`, `lib/plan-compiler.js` and the modules around them). The input is the schema, never the document being validated, and schema property names are escaped before they reach generated code (fixed in 1.40.1, with a test that holds). Where `new Function` is blocked, by a Content-Security-Policy, a Manifest V3 extension, Cloudflare Workers or Bun's ahead-of-time compiler, the package takes its interpreted engine, which scores the same on the official suite; `tests/test_no_eval.js` runs the whole suite with `eval` and `new Function` disabled.
- **Dynamic require.** `lib/native-load.js` loads the optional native accelerator by a package name built from the platform and architecture (`@ata-validator/darwin-arm64` and six others), and the name is not a literal so a bundler does not try to resolve a package that is not installed. The candidates are the seven names the project publishes, nothing read from the environment or the schema. `ATA_NO_NATIVE=1` skips the lookup.
- **Environment variables.** The ones a user sets: `ATA_NO_NATIVE` (skip the native addon), `ATA_NO_WARM` (skip the engine warm-up on Node), `ATA_ENGINE` and `ATA_FORCE_NAPI` (choose an engine, for the project's own tests), and `ATA_DEBUG`, `ATA_DEBUG_ERRGEN`, `ATA_DUMP_CODEGEN`, `ATA_DUMP_PARTS`, `ATA_CHECK_SORT` (diagnostics that print to stderr). The command line reads `NO_COLOR`, `FORCE_COLOR` and `NODE_ENV` for its output. Each is read, never written, and none of their values leaves the process.
- **Filesystem access.** The `ata` command line reads schema files and writes compiled modules (`bin/ata.js`, `lib/aot-build.js`, `lib/verify.js`, `lib/migrate.js`). `validate()` and the `Validator` class do not touch the filesystem.
- **URL strings.** The meta-schema identifiers of the dialects (`https://json-schema.org/draft/2020-12/schema` and the others), which are names, not addresses the package fetches, and the documentation prefix for error codes (`https://ata-validator.com/e/`), which is written into error objects as text. The package makes no network requests.

The pack purity test (`tests/test_pack_purity.js`) holds the core tarball to pure JavaScript and a size ceiling, so a native binary or an unexpected file cannot enter it unnoticed.
