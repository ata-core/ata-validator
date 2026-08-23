# Working on ata-validator

ata-validator is a JSON Schema validator with two faces: a runtime `Validator` that
compiles schemas on demand, and an ahead-of-time compiler (`ata build`) that turns
schemas into standalone JavaScript modules importing nothing at all. The native C++
engine is an optional accelerator, not the product: the default install works without
it, and `validate()` runs on pure JS everywhere including the browser.

`ARCHITECTURE.md` has the design in depth. Read it before changing engine internals.

## Checks

Run these before proposing a change. They are not optional and CI runs all of them.

```bash
npm test               # unit and integration suite
npm run test:suite     # official JSON Schema Test Suite, three dialects
node tests/test_no_eval.js   # the whole suite with eval and new Function blocked
npm run release:check  # pack purity, doc coverage, error-code lock, version sync
```

`npm run build` rebuilds the native addon and needs CMake. If you change the version
in `package.json` you must also change `lib/version.js` and `include/ata.h`, and
rebuild, or the loader will refuse the addon as mismatched. `test_version_sync.js`
enforces this.

## Things that have bitten us

**Three code generation entry points.** `compileToJSCodegen`, `compileToJSCombined`
and `compileToJSCodegenWithErrors` each build their own context and each must run the
same safety bails (`hasUnresolvableRef`, `needsBaseTracking`). When one of them was
missing those bails it emitted an empty program and returned it as always-valid, so
every constraint behind a `$ref` was silently dropped. That has now happened three
times in `$ref` handling. If you touch one entry point, check the other two, and never
let "emitted no lines" mean "valid".

**Their signatures differ.** `compileToJS(schema, defs, schemaMap)` but
`compileToJSCodegen(schema, schemaMap, userFormats)`. Passing the wrong argument order
makes a path look like it declines when it does not.

**Silent acceptance is the worst failure mode here.** A validator that wrongly rejects
gets a bug report. One that wrongly accepts does not. Prefer declining to compile and
falling back to the interpreted engine over emitting something that might be vacuous.

**The test suite is a submodule.** It drifts. Check `git -C tests/suite log -1` before
quoting any figure; a stale pin once hid a real bug for five months.

## Numbers

Every figure in the README, the docs and on the site is measured, not estimated. If a
change moves one, remeasure and update all of them together. Current figures, all with
zero regressions: Draft 2020-12 1294 of 1299, draft 7 916 of 927, the v1 dialect 1131
of 1133; with code generation blocked, 1295 of 1299 and 1132 of 1133. The buffer path
disagrees with `validate()` on 245 of 2222 cases and that number may not grow.

Do not write a number you have not run. Do not round a measured figure into a claim.

## Writing

Everything here is public, so it has to read like a person wrote it.

- Plain, factual, specific. No marketing language, no hype words, no "blazingly fast",
  no exclamation marks, no emoji.
- Never use em dashes. Use commas or full stops.
- Say what changed and why it matters. Skip the throat-clearing.
- State limitations plainly. If something is not covered, say so rather than implying
  it is.
- Do not lean on comparisons with other validators. Describe what ata does. Naming a
  competitor is for cases where the context genuinely needs it, not for contrast.

Commit messages: short, lowercase conventional prefix where it fits (`fix:`, `feat:`,
`docs:`, `test:`), one line saying what changed. No hype. **Never add a
`Co-Authored-By` trailer, and never append a session or assistant link.**

Pull request descriptions follow the same rules: what changed, why, how it was
verified, and what was not covered. No checklists of adjectives.
