# Correctness report

This file is written by `node scripts/gate-report.js`. Do not edit it by hand: every figure in it was printed by the run that wrote it, and `tests/test_gate_report.js` fails when the text and the run it records disagree.

## Summary

- Tree: ata-validator 1.66.0 at commit `144cf7d`. Node v25.2.1 on darwin-arm64.
- Gate: 17 paths, each held to the Validator on the same documents. Official suite: 1945 schemas. SchemaStore: 492 schemas. Documents that differ or threw: 0.
- Official JSON Schema Test Suite at `e2a68a1`: draft2020-12 1319 of 1319, draft2019-09 1292 of 1292, draft7 972 of 972, draft6 878 of 878, draft4 672 of 672, v1 1290 of 1290.
- With `eval` and `new Function` blocked: draft2020-12 1319 of 1319, draft2019-09 1292 of 1292, draft7 972 of 972, draft6 878 of 878, draft4 672 of 672, v1 1290 of 1290.
- Native engine: loaded from local build, version 1.66.0.
- Sweep classes: 19. Closed in this tree, with their tests passing: 19. Open in this tree: 0.

## What the gate compares

`scripts/gate.js` builds each schema through every path the package answers by and compares each path with `new Validator(schema)`, default options, or the options a path is the counterpart of (plain errors, no default filling). For every document it compares:

- the verdict of `validate()` and of the boolean check;
- the error fields the path promises, in order where it promises order (`rich`: every field of a Validator error; `module`: code, keyword, instancePath, schemaPath, params, message, docUrl; `plain`: keyword, instancePath, schemaPath, params, message, and no other keys);
- the document afterwards, where the path fills defaults itself.

A path may decline a schema. A declined schema is counted and not compared: that path refuses to build it, and the Validator answers it instead. Two differences are allowed and counted apart. A module that cannot build error detail reports the single error ATA9000 ("allowed as ATA9000"). A path that promises the errors but not their order is compared without order ("other order, none promised"). An entry under "known" is listed in `scripts/gate.js` with its reason, below.

The documents are the official suite's test data; for SchemaStore, each schema's positive and negative samples and copies of them changed in one place by a seeded generator. Every schema also meets documents no sample holds: empty and non-empty arrays, an empty object, primitives, and for a schema with `properties`, a name on the prototype, an undefined value, a non-enumerable name and an array with a named key. The JSON text path is given only what JSON can carry.

## Corpora

| corpus | commit | date | subject | read by the gate |
|---|---|---|---|---|
| JSON Schema Test Suite (`tests/suite`) | `e2a68a15cd490750fd6b95e604e4054d7d978d1f` | 2026-11-16 | test(email): limit RFC 5321-only rejections to 2020-12 and later (#1271) | draft2020-12, draft2019-09, draft7, draft6, draft4, v1: every case at the top level of `validation/tests` that applies to the dialect, format-assertion cases included, the format-assertion cases of `optional` and `optional/non-bmp-regex.json` |
| SchemaStore | `ce64da2a95a2bd40740c2d608206f8a36024d30b` | 2026-10-08 | fix(claude-code-settings): accept skills-dir marketplace source (#6469) | 990 schema files in `src/schemas/json`; those with sample documents the Validator builds are checked |

The suite checkout is at the commit this tree pins.

## Paths, official suite

1945 schemas the Validator builds. Gate exit status 0.

| path | error fields compared | order compared | schemas taken | declined | documents | differ | threw | allowed as ATA9000 | other order, none promised | known |
|---|---|---|---|---|---|---|---|---|---|---|
| interpreted engine | rich | yes | 1945 | 0 | 26664 | 0 | 0 | 0 | 0 | 1 |
| generated code, warm | rich | yes | 1945 | 0 | 26664 | 0 | 0 | 0 | 0 | 0 |
| closure tree | rich | yes | 1945 | 0 | 26664 | 0 | 0 | 0 | 0 | 1 |
| JSON text | rich | yes | 1945 | 0 | 25404 | 0 | 0 | 0 | 0 | 0 |
| plain errors | plain | yes | 1945 | 0 | 26664 | 0 | 0 | 0 | 0 | 1 |
| module | module | yes | 1810 | 135 | 25069 | 0 | 0 | 0 | 0 | 0 |
| module, one pass | module | no | 1810 | 135 | 25069 | 0 | 0 | 0 | 0 | 0 |
| module, plain errors | plain | yes | 1810 | 135 | 25069 | 0 | 0 | 0 | 0 | 0 |
| compact module | module | yes | 1810 | 135 | 25069 | 0 | 0 | 0 | 0 | 1 |
| schema module | module | yes | 1926 | 19 | 26400 | 0 | 0 | 0 | 0 | 1 |
| ir module | rich | yes | 1938 | 7 | 26556 | 0 | 0 | 0 | 0 | 2 |
| ir module, plain errors | plain | yes | 1938 | 7 | 26556 | 0 | 0 | 0 | 0 | 2 |
| ir closures | rich | yes | 1940 | 5 | 26576 | 0 | 0 | 0 | 0 | 2 |
| ir table | rich | yes | 1685 | 260 | 23504 | 0 | 0 | 0 | 0 | 0 |
| ir table, plain errors | plain | yes | 1685 | 260 | 23504 | 0 | 0 | 0 | 0 | 0 |
| ir plan as JSON | rich | yes | 1644 | 301 | 22971 | 0 | 0 | 0 | 0 | 0 |
| ir closure module | plain | yes | 753 | 1192 | 12417 | 0 | 0 | 0 | 0 | 0 |

## Paths, SchemaStore

492 schemas the Validator builds. Gate exit status 0.

| path | error fields compared | order compared | schemas taken | declined | documents | differ | threw | allowed as ATA9000 | other order, none promised | known |
|---|---|---|---|---|---|---|---|---|---|---|
| interpreted engine | rich | yes | 492 | 0 | 14756 | 0 | 0 | 0 | 0 | 0 |
| generated code, warm | rich | yes | 492 | 0 | 14756 | 0 | 0 | 0 | 0 | 0 |
| closure tree | rich | yes | 492 | 0 | 14756 | 0 | 0 | 0 | 0 | 0 |
| JSON text | rich | yes | 492 | 0 | 13028 | 0 | 0 | 0 | 0 | 0 |
| plain errors | plain | yes | 492 | 0 | 14756 | 0 | 0 | 0 | 0 | 0 |
| module | module | yes | 445 | 47 | 13128 | 0 | 0 | 158 | 0 | 0 |
| module, one pass | module | no | 445 | 47 | 13128 | 0 | 0 | 158 | 237 | 0 |
| module, plain errors | plain | yes | 438 | 54 | 12724 | 0 | 0 | 0 | 0 | 0 |
| compact module | module | yes | 445 | 47 | 13128 | 0 | 0 | 0 | 0 | 0 |
| schema module | module | yes | 447 | 45 | 13240 | 0 | 0 | 0 | 0 | 0 |
| ir module | rich | yes | 483 | 9 | 14548 | 0 | 0 | 0 | 0 | 0 |
| ir module, plain errors | plain | yes | 483 | 9 | 14548 | 0 | 0 | 0 | 0 | 0 |
| ir closures | rich | yes | 484 | 8 | 14564 | 0 | 0 | 0 | 0 | 0 |
| ir table | rich | yes | 442 | 50 | 13092 | 0 | 0 | 0 | 0 | 0 |
| ir table, plain errors | plain | yes | 442 | 50 | 13092 | 0 | 0 | 0 | 0 | 0 |
| ir plan as JSON | rich | yes | 358 | 134 | 10364 | 0 | 0 | 0 | 0 | 0 |
| ir closure module | plain | yes | 34 | 458 | 724 | 0 | 0 | 0 | 0 | 0 |

## Differences

None. No path gave an answer that differs from the Validator's, and no path threw.

## Known exceptions

- Error order, for a suite group whose description ends in "unevaluatedItems with $dynamicRef (2020-12)". A `$ref` to an embedded resource that holds a `$dynamicRef`: the errors name paths in two resources and neither engine ranks them, so generated code and the interpreted walk list the same errors in a different order. The verdict and the set of errors agree. Open, not decided.
  - interpreted engine, official suite: `draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef (2020-12)`, document kind "array".
  - closure tree, official suite: `draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef (2020-12)`, document kind "array".
  - plain errors, official suite: `draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef (2020-12)`, document kind "array".
  - compact module, official suite: `draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef (2020-12)`, document kind "array".
  - schema module, official suite: `draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef (2020-12)`, document kind "array".
  - ir module, official suite: `draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef (2020-12)`, document kind "array".
  - ir module, plain errors, official suite: `draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef (2020-12)`, document kind "array".
  - ir closures, official suite: `draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef (2020-12)`, document kind "array".
- Error order, for a suite group whose description ends in "v1/unevaluatedItems.json: unevaluatedItems with $dynamicRef". A `$ref` to an embedded resource that holds a `$dynamicRef`: the errors name paths in two resources and neither engine ranks them, so generated code and the interpreted walk list the same errors in a different order. The verdict and the set of errors agree. Open, not decided.
  - ir module, official suite: `v1/unevaluatedItems.json: unevaluatedItems with $dynamicRef`, document kind "array".
  - ir module, plain errors, official suite: `v1/unevaluatedItems.json: unevaluatedItems with $dynamicRef`, document kind "array".
  - ir closures, official suite: `v1/unevaluatedItems.json: unevaluatedItems with $dynamicRef`, document kind "array".

## Official test suite

`node tests/run_suite.js <dialect>`, suite at `e2a68a1`. Every case at the top level of `validation/tests` that applies to the dialect runs, the cases tagged format-assertion aside; a schema that does not compile counts as failed. `format` is an annotation, as the suite expects, and each case's external documents (`externalSchemas`) are registered for that case alone. The cases tagged format-assertion run after them with `assertFormat: true` and have columns of their own; the listed known failures count both runs. The optional tests are not in these figures.

| dialect | passed | cases | format assertion passed | format assertion cases | listed known failures | regressions | exit status |
|---|---|---|---|---|---|---|---|
| draft2020-12 | 1319 | 1319 | 763 | 763 | 0 | 0 | 0 |
| draft2019-09 | 1292 | 1292 | 751 | 751 | 0 | 0 | 0 |
| draft7 | 972 | 972 | 683 | 683 | 0 | 0 | 0 |
| draft6 | 878 | 878 | 340 | 340 | 0 | 0 | 0 |
| draft4 | 672 | 672 | 239 | 239 | 0 | 0 | 0 |
| v1 | 1290 | 1290 | 737 | 745 | 8 | 0 | 0 |

## With code generation blocked

`node tests/test_no_eval.js` replaces `eval` and `Function` before the package loads, so that building a function from source throws, turns the native engine off, and runs the same cases as `tests/run_suite.js` through `validate()`, the format-assertion cases aside.

| dialect | passed | cases | failed | errored |
|---|---|---|---|---|
| draft2020-12 | 1319 | 1319 | 0 | 0 |
| draft2019-09 | 1292 | 1292 | 0 | 0 |
| draft7 | 972 | 972 | 0 | 0 |
| draft6 | 878 | 878 | 0 | 0 |
| draft4 | 672 | 672 | 0 | 0 |
| v1 | 1290 | 1290 | 0 | 0 |

Code generation attempts blocked: 1. Standard Schema check with code generation blocked: passed. Exit status 0.

## Native engine

The gate loaded the native engine from local build. With it loaded, the JSON text path hands long text to it. The gate has no path of its own for the buffer APIs (`isValid(buffer)`, `countValid`, `isValidParallel`, `isValidNDJSON`, `batchIsValid`).

## Sweep classes

The classes found by the sweep of 1.x for answers that differ between paths, one per changelog entry of their fixes, whether those fixes are in this tree or not yet merged into it. A class is closed in this tree when every commit that fixes it is in this tree's history and every test that holds it is present, listed in `tests/run.js` and passed in this run. The tests of a class whose fix is not in this tree were not run: they would pass without saying anything about the class.

| class | effect before the fix | fix commits | in this tree | tests | result |
|---|---|---|---|---|---|
| A `$ref` that does not resolve, inside a document given through `schemas` and reached through another reference: generated code and the modules wrote no check for it. | accepted documents it should reject | `3429ae8`, `45052bb` | yes | `tests/test_registered_ref_resolution.js`, `tests/test_codegen_entrypoint_agreement.js` | closed |
| The defaults, `removeAdditional` and `coerceTypes` passes followed a relative `$ref` into another document by path suffix. | filled, removed or coerced by one document while validation read another | `bb8a738`, `73d307f` | yes | `tests/test_registered_ref_resolution.js` | closed |
| A cycle of references across registered documents reached the verdict generator as written, and it wrote no check for the reference back. | accepted documents it should reject | `8f41bb7` | yes | `tests/test_registered_ref_resolution.js` | closed |
| A local definition reached again through an anchor, or an anchor that refers to itself, on a cycle the generator does not detect. | accepted documents it should reject | `3953dcd` | yes | `tests/test_registered_ref_resolution.js` | closed |
| `minLength` and `maxLength` in the interpreted engine counted a lone high surrogate and the unit after it as one code point. | accepted documents it should reject | `dc9bf05` | yes | `tests/test_code_point_pairs.js` | closed |
| `enum`, `const` and `uniqueItems` compared two objects by the keys of one side only, for objects with a non-enumerable own property. | the answer depended on the order of the two values compared | `333707e`, `95f3e90` | yes | `tests/test_deep_equal_enumerable.js` | closed |
| A module from `ata-validator/ir` for a schema with `propertyDependencies` or draft-07 `dependencies` did not declare the object flag it reads. | threw instead of answering | `57a1e22` | yes | `tests/test_ir_object_flag.mjs` | closed |
| `propertyNames` with `minLength` or `maxLength` counted UTF-16 units in the three code generators, where the interpreted engine counts code points. | accepted documents it should reject and rejected documents it should accept | `05ab41e` | yes | `tests/test_code_point_pairs.js` | closed |
| The closure compiler compared `enum`, `const` and `uniqueItems` values by a canonical string that wrote a string inside an array without quotes. | accepted documents it should reject and rejected documents it should accept | `96849ae` | yes | `tests/test_closure_equality.js` | closed |
| A schema reached by a JSON pointer through a name no keyword reads had its own references resolved against the root. | accepted documents it should reject | `b42396e`, `7ab4de4` | yes | `tests/test_registered_ref_resolution.js`, `tests/test_ir_registered_docs.mjs` | closed |
| `ata-validator/ir` registered a draft-07 document whose root is a `$ref` under no name. | rejected documents it should accept | `6cc0b8d` | yes | `tests/test_ir_registered_docs.mjs` | closed |
| A module from `ata-validator/ir` called the shared defaults pass for defaults that pass cannot reach. | threw instead of answering | `86f4a91` | yes | `tests/test_ir_registered_docs.mjs` | closed |
| The native engine skipped a length, item or property count bound that is not a whole number from zero. | accepted documents it should reject | `d76b4a9` | yes | `tests/test_buffer_gate.js`, `tests/test_code_point_pairs.js` | closed |
| The small engine that answers a simple schema's first calls read `maxLength: -1` as no bound. | accepted documents it should reject | `8f77b65` | yes | `tests/test_code_point_pairs.js` | closed |
| The buffer APIs answered from the native walker for a validator with defaults, `coerceTypes` or `removeAdditional`, judging the bytes before those passes. | accepted documents it should reject and rejected documents it should accept | `641f9e2`, `e114137` | yes | `tests/test_buffer_gate.js`, `tests/test_buffer_defaults_static.js` | closed |
| The native walkers read JSON text that names a member twice, or holds a surrogate escape outside a pair, differently from JSON.parse. | accepted documents it should reject and rejected documents it should accept | `56c03df`, `dbc0434`, `55e89a0`, `b11c120` | yes | `tests/test_native_duplicate_names.js` | closed |
| A schema holding a value JSON cannot carry (NaN, Infinity, a hole) shared compiled code with the schema its JSON text spells. | accepted documents it should reject | `65332c5`, `a587dbf` | yes | `tests/test_compile_cache_unfaithful.js` | closed |
| `Validator.fromStandalone()` built its defaults pass from the root schema alone and ran it only in `validate()`. | accepted documents it should reject and rejected documents it should accept | `96e6647` | yes | `tests/test_from_standalone_defaults.js` | closed |
| A name that is also a keyword, under `properties` or another map of names, was read as the keyword: generated code dropped the schema of a property named `$id`, which the draft-07 and draft-06 meta-schemas constrain; a name spelled `$dynamicRef` threw; the native routing missed a reference behind a property named `const`. | accepted documents it should reject and rejected documents it should accept | `2791680` | yes | `tests/test_keyword_named_names.js` | closed |

## Not covered

- The gate holds paths to the Validator, not to the specification. A defect the Validator shares with every path does not show in it. The official suite figures are the check against the specification, and they cover what the suite's cases cover.
- Every run here is Node v25.2.1 on darwin-arm64. Deno, Bun, browsers and Cloudflare Workers were not run, and neither were other operating systems.
- The package entries for browsers and Workers (`index.browser.mjs`, `index.edge.js`), `ata-validator/lite`, `ata-validator/compat` and `ata-validator/stream` are not gate paths. How `ata-validator/compat` differs from the default validator is not part of this report.
- The `ata` command line binary is not run. The modules the gate checks are built through library calls (`toStandaloneModule`, `toCompactModule`, `toSchemaModule`, `compiledModuleFor`), not through the binary.
- The buffer APIs have no gate path. The native engine with code generation blocked is not run anywhere here: the run with code generation blocked turns the native engine off.
- The gate leaves out the suite cases that bring external documents (`externalSchemas`) or name `http://localhost:1234`; `tests/run_suite.js` and `tests/test_no_eval.js` include them.
- The documents a SchemaStore schema meets are its samples, copies changed in one place and the extra documents above. A schema with no sample document is not checked.
- The 2.0 entries are not in this tree and not in this report.

## Known open items

- The error order exception "unevaluatedItems with $dynamicRef (2020-12)" in `scripts/gate.js`.
- The error order exception "v1/unevaluatedItems.json: unevaluatedItems with $dynamicRef" in `scripts/gate.js`.

## Reproduce

From a clean clone at the commit that adds this file, whose code is that of `144cf7d`, with Node and git:

```sh
git clone https://github.com/ata-core/ata-validator.git && cd ata-validator
git checkout <the commit that adds docs/correctness-report.md>
git submodule update --init tests/suite
npm ci
git clone https://github.com/SchemaStore/schemastore.git ../schemastore
git -C ../schemastore checkout ce64da2
node scripts/gate-report.js --schemastore ../schemastore
git diff --exit-code docs/correctness-report.md
```

The last command prints nothing and exits 0 when every figure reproduces. On another machine the Node version, the platform and the native engine line can differ, since `npm ci` installs the native package for that platform when one is published; those lines then differ and the counts are what to compare. `node scripts/gate-report.js --record <file>` also writes the record below as a file. The gate alone: `node scripts/gate.js --schemastore ../schemastore`.

<!-- record
{
 "format": "ata-correctness-report/1",
 "tree": {
  "commit": "144cf7d9ec47e8e5a9cb9f4a9de04f48a6efbe2b",
  "version": "1.66.0",
  "uncommitted": []
 },
 "corpora": {
  "suite": {
   "commit": "e2a68a15cd490750fd6b95e604e4054d7d978d1f",
   "date": "2026-11-16",
   "subject": "test(email): limit RFC 5321-only rejections to 2020-12 and later (#1271)",
   "pinned": "e2a68a15cd490750fd6b95e604e4054d7d978d1f",
   "atPin": true
  },
  "schemastore": {
   "commit": "ce64da2a95a2bd40740c2d608206f8a36024d30b",
   "date": "2026-10-08",
   "subject": "fix(claude-code-settings): accept skills-dir marketplace source (#6469)",
   "schemaFiles": 990,
   "dirty": false
  }
 },
 "gate": {
  "suite": {
   "format": "ata-gate/1",
   "ata": "1.66.0",
   "node": "v25.2.1",
   "platform": "darwin",
   "arch": "arm64",
   "native": {
    "loaded": true,
    "noNative": false,
    "source": "local build",
    "found": [
     {
      "source": "@ata-validator/native-darwin-arm64",
      "version": "1.64.0"
     },
     {
      "source": "local build",
      "version": "1.66.0"
     }
    ]
   },
   "given": {
    "suite": true,
    "schemastore": false,
    "paths": null,
    "every": 1
   },
   "schemas": 1945,
   "paths": [
    {
     "name": "interpreted engine",
     "fields": "rich",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 1945,
     "declined": 0,
     "docs": 26664,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 1,
     "unordered": 0
    },
    {
     "name": "generated code, warm",
     "fields": "rich",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 1945,
     "declined": 0,
     "docs": 26664,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    },
    {
     "name": "closure tree",
     "fields": "rich",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 1945,
     "declined": 0,
     "docs": 26664,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 1,
     "unordered": 0
    },
    {
     "name": "JSON text",
     "fields": "rich",
     "ordered": true,
     "abortAllowed": false,
     "json": true,
     "fills": false,
     "taken": 1945,
     "declined": 0,
     "docs": 25404,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    },
    {
     "name": "plain errors",
     "fields": "plain",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 1945,
     "declined": 0,
     "docs": 26664,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 1,
     "unordered": 0
    },
    {
     "name": "module",
     "fields": "module",
     "ordered": true,
     "abortAllowed": true,
     "json": false,
     "fills": false,
     "taken": 1810,
     "declined": 135,
     "docs": 25069,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    },
    {
     "name": "module, one pass",
     "fields": "module",
     "ordered": false,
     "abortAllowed": true,
     "json": false,
     "fills": false,
     "taken": 1810,
     "declined": 135,
     "docs": 25069,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    },
    {
     "name": "module, plain errors",
     "fields": "plain",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 1810,
     "declined": 135,
     "docs": 25069,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    },
    {
     "name": "compact module",
     "fields": "module",
     "ordered": true,
     "abortAllowed": true,
     "json": false,
     "fills": false,
     "taken": 1810,
     "declined": 135,
     "docs": 25069,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 1,
     "unordered": 0
    },
    {
     "name": "schema module",
     "fields": "module",
     "ordered": true,
     "abortAllowed": true,
     "json": false,
     "fills": false,
     "taken": 1926,
     "declined": 19,
     "docs": 26400,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 1,
     "unordered": 0
    },
    {
     "name": "ir module",
     "fields": "rich",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 1938,
     "declined": 7,
     "docs": 26556,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 2,
     "unordered": 0
    },
    {
     "name": "ir module, plain errors",
     "fields": "plain",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 1938,
     "declined": 7,
     "docs": 26556,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 2,
     "unordered": 0
    },
    {
     "name": "ir closures",
     "fields": "rich",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 1940,
     "declined": 5,
     "docs": 26576,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 2,
     "unordered": 0
    },
    {
     "name": "ir table",
     "fields": "rich",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 1685,
     "declined": 260,
     "docs": 23504,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    },
    {
     "name": "ir table, plain errors",
     "fields": "plain",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 1685,
     "declined": 260,
     "docs": 23504,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    },
    {
     "name": "ir plan as JSON",
     "fields": "rich",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 1644,
     "declined": 301,
     "docs": 22971,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    },
    {
     "name": "ir closure module",
     "fields": "plain",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": false,
     "taken": 753,
     "declined": 1192,
     "docs": 12417,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    }
   ],
   "kinds": [],
   "report": [],
   "known": [],
   "knownOrder": [
    "unevaluatedItems with $dynamicRef (2020-12)",
    "v1/unevaluatedItems.json: unevaluatedItems with $dynamicRef"
   ],
   "knownSeen": [
    {
     "path": "interpreted engine",
     "label": "draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef (2020-12)",
     "tag": "array",
     "what": "errors"
    },
    {
     "path": "closure tree",
     "label": "draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef (2020-12)",
     "tag": "array",
     "what": "errors"
    },
    {
     "path": "plain errors",
     "label": "draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef (2020-12)",
     "tag": "array",
     "what": "errors"
    },
    {
     "path": "compact module",
     "label": "draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef (2020-12)",
     "tag": "array",
     "what": "errors"
    },
    {
     "path": "schema module",
     "label": "draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef (2020-12)",
     "tag": "array",
     "what": "errors"
    },
    {
     "path": "ir module",
     "label": "draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef (2020-12)",
     "tag": "array",
     "what": "errors"
    },
    {
     "path": "ir module, plain errors",
     "label": "draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef (2020-12)",
     "tag": "array",
     "what": "errors"
    },
    {
     "path": "ir closures",
     "label": "draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef (2020-12)",
     "tag": "array",
     "what": "errors"
    },
    {
     "path": "ir module",
     "label": "v1/unevaluatedItems.json: unevaluatedItems with $dynamicRef",
     "tag": "array",
     "what": "errors"
    },
    {
     "path": "ir module, plain errors",
     "label": "v1/unevaluatedItems.json: unevaluatedItems with $dynamicRef",
     "tag": "array",
     "what": "errors"
    },
    {
     "path": "ir closures",
     "label": "v1/unevaluatedItems.json: unevaluatedItems with $dynamicRef",
     "tag": "array",
     "what": "errors"
    }
   ],
   "exit": 0
  },
  "schemastore": {
   "format": "ata-gate/1",
   "ata": "1.66.0",
   "node": "v25.2.1",
   "platform": "darwin",
   "arch": "arm64",
   "native": {
    "loaded": true,
    "noNative": false,
    "source": "local build",
    "found": [
     {
      "source": "@ata-validator/native-darwin-arm64",
      "version": "1.64.0"
     },
     {
      "source": "local build",
      "version": "1.66.0"
     }
    ]
   },
   "given": {
    "suite": false,
    "schemastore": true,
    "paths": null,
    "every": 1
   },
   "schemas": 492,
   "paths": [
    {
     "name": "interpreted engine",
     "fields": "rich",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 492,
     "declined": 0,
     "docs": 14756,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    },
    {
     "name": "generated code, warm",
     "fields": "rich",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 492,
     "declined": 0,
     "docs": 14756,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    },
    {
     "name": "closure tree",
     "fields": "rich",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 492,
     "declined": 0,
     "docs": 14756,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    },
    {
     "name": "JSON text",
     "fields": "rich",
     "ordered": true,
     "abortAllowed": false,
     "json": true,
     "fills": false,
     "taken": 492,
     "declined": 0,
     "docs": 13028,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    },
    {
     "name": "plain errors",
     "fields": "plain",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 492,
     "declined": 0,
     "docs": 14756,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    },
    {
     "name": "module",
     "fields": "module",
     "ordered": true,
     "abortAllowed": true,
     "json": false,
     "fills": false,
     "taken": 445,
     "declined": 47,
     "docs": 13128,
     "diffs": 0,
     "threw": 0,
     "abort": 158,
     "known": 0,
     "unordered": 0
    },
    {
     "name": "module, one pass",
     "fields": "module",
     "ordered": false,
     "abortAllowed": true,
     "json": false,
     "fills": false,
     "taken": 445,
     "declined": 47,
     "docs": 13128,
     "diffs": 0,
     "threw": 0,
     "abort": 158,
     "known": 0,
     "unordered": 237
    },
    {
     "name": "module, plain errors",
     "fields": "plain",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 438,
     "declined": 54,
     "docs": 12724,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    },
    {
     "name": "compact module",
     "fields": "module",
     "ordered": true,
     "abortAllowed": true,
     "json": false,
     "fills": false,
     "taken": 445,
     "declined": 47,
     "docs": 13128,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    },
    {
     "name": "schema module",
     "fields": "module",
     "ordered": true,
     "abortAllowed": true,
     "json": false,
     "fills": false,
     "taken": 447,
     "declined": 45,
     "docs": 13240,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    },
    {
     "name": "ir module",
     "fields": "rich",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 483,
     "declined": 9,
     "docs": 14548,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    },
    {
     "name": "ir module, plain errors",
     "fields": "plain",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 483,
     "declined": 9,
     "docs": 14548,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    },
    {
     "name": "ir closures",
     "fields": "rich",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 484,
     "declined": 8,
     "docs": 14564,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    },
    {
     "name": "ir table",
     "fields": "rich",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 442,
     "declined": 50,
     "docs": 13092,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    },
    {
     "name": "ir table, plain errors",
     "fields": "plain",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 442,
     "declined": 50,
     "docs": 13092,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    },
    {
     "name": "ir plan as JSON",
     "fields": "rich",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 358,
     "declined": 134,
     "docs": 10364,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    },
    {
     "name": "ir closure module",
     "fields": "plain",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": false,
     "taken": 34,
     "declined": 458,
     "docs": 724,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    }
   ],
   "kinds": [],
   "report": [],
   "known": [],
   "knownOrder": [
    "unevaluatedItems with $dynamicRef (2020-12)",
    "v1/unevaluatedItems.json: unevaluatedItems with $dynamicRef"
   ],
   "knownSeen": [],
   "exit": 0
  }
 },
 "dialects": [
  {
   "dialect": "draft2020-12",
   "passed": 1319,
   "total": 1319,
   "formatPassed": 763,
   "formatTotal": 763,
   "knownFailures": 0,
   "regressions": 0,
   "exit": 0
  },
  {
   "dialect": "draft2019-09",
   "passed": 1292,
   "total": 1292,
   "formatPassed": 751,
   "formatTotal": 751,
   "knownFailures": 0,
   "regressions": 0,
   "exit": 0
  },
  {
   "dialect": "draft7",
   "passed": 972,
   "total": 972,
   "formatPassed": 683,
   "formatTotal": 683,
   "knownFailures": 0,
   "regressions": 0,
   "exit": 0
  },
  {
   "dialect": "draft6",
   "passed": 878,
   "total": 878,
   "formatPassed": 340,
   "formatTotal": 340,
   "knownFailures": 0,
   "regressions": 0,
   "exit": 0
  },
  {
   "dialect": "draft4",
   "passed": 672,
   "total": 672,
   "formatPassed": 239,
   "formatTotal": 239,
   "knownFailures": 0,
   "regressions": 0,
   "exit": 0
  },
  {
   "dialect": "v1",
   "passed": 1290,
   "total": 1290,
   "formatPassed": 737,
   "formatTotal": 745,
   "knownFailures": 8,
   "regressions": 0,
   "exit": 0
  }
 ],
 "noEval": {
  "dialects": [
   {
    "dialect": "draft2020-12",
    "passed": 1319,
    "total": 1319,
    "failed": 0,
    "errored": 0
   },
   {
    "dialect": "draft2019-09",
    "passed": 1292,
    "total": 1292,
    "failed": 0,
    "errored": 0
   },
   {
    "dialect": "draft7",
    "passed": 972,
    "total": 972,
    "failed": 0,
    "errored": 0
   },
   {
    "dialect": "draft6",
    "passed": 878,
    "total": 878,
    "failed": 0,
    "errored": 0
   },
   {
    "dialect": "draft4",
    "passed": 672,
    "total": 672,
    "failed": 0,
    "errored": 0
   },
   {
    "dialect": "v1",
    "passed": 1290,
    "total": 1290,
    "failed": 0,
    "errored": 0
   }
  ],
  "blocked": 1,
  "standardSchema": true,
  "exit": 0
 },
 "sweep": [
  {
   "id": "ref-unresolved-registered",
   "inTree": true,
   "fixes": [
    {
     "commit": "3429ae8",
     "inTree": true
    },
    {
     "commit": "45052bb",
     "inTree": true
    }
   ],
   "tests": [
    {
     "file": "tests/test_registered_ref_resolution.js",
     "present": true,
     "listed": true,
     "result": "passed"
    },
    {
     "file": "tests/test_codegen_entrypoint_agreement.js",
     "present": true,
     "listed": true,
     "result": "passed"
    }
   ],
   "closed": true
  },
  {
   "id": "ref-preprocess-suffix",
   "inTree": true,
   "fixes": [
    {
     "commit": "bb8a738",
     "inTree": true
    },
    {
     "commit": "73d307f",
     "inTree": true
    }
   ],
   "tests": [
    {
     "file": "tests/test_registered_ref_resolution.js",
     "present": true,
     "listed": true,
     "result": "passed"
    }
   ],
   "closed": true
  },
  {
   "id": "ref-cycle-documents",
   "inTree": true,
   "fixes": [
    {
     "commit": "8f41bb7",
     "inTree": true
    }
   ],
   "tests": [
    {
     "file": "tests/test_registered_ref_resolution.js",
     "present": true,
     "listed": true,
     "result": "passed"
    }
   ],
   "closed": true
  },
  {
   "id": "ref-cycle-local",
   "inTree": true,
   "fixes": [
    {
     "commit": "3953dcd",
     "inTree": true
    }
   ],
   "tests": [
    {
     "file": "tests/test_registered_ref_resolution.js",
     "present": true,
     "listed": true,
     "result": "passed"
    }
   ],
   "closed": true
  },
  {
   "id": "length-lone-high-surrogate",
   "inTree": true,
   "fixes": [
    {
     "commit": "dc9bf05",
     "inTree": true
    }
   ],
   "tests": [
    {
     "file": "tests/test_code_point_pairs.js",
     "present": true,
     "listed": true,
     "result": "passed"
    }
   ],
   "closed": true
  },
  {
   "id": "equality-enumerable",
   "inTree": true,
   "fixes": [
    {
     "commit": "333707e",
     "inTree": true
    },
    {
     "commit": "95f3e90",
     "inTree": true
    }
   ],
   "tests": [
    {
     "file": "tests/test_deep_equal_enumerable.js",
     "present": true,
     "listed": true,
     "result": "passed"
    }
   ],
   "closed": true
  },
  {
   "id": "ir-object-flag",
   "inTree": true,
   "fixes": [
    {
     "commit": "57a1e22",
     "inTree": true
    }
   ],
   "tests": [
    {
     "file": "tests/test_ir_object_flag.mjs",
     "present": true,
     "listed": true,
     "result": "passed"
    }
   ],
   "closed": true
  },
  {
   "id": "property-names-length",
   "inTree": true,
   "fixes": [
    {
     "commit": "05ab41e",
     "inTree": true
    }
   ],
   "tests": [
    {
     "file": "tests/test_code_point_pairs.js",
     "present": true,
     "listed": true,
     "result": "passed"
    }
   ],
   "closed": true
  },
  {
   "id": "closure-equality",
   "inTree": true,
   "fixes": [
    {
     "commit": "96849ae",
     "inTree": true
    }
   ],
   "tests": [
    {
     "file": "tests/test_closure_equality.js",
     "present": true,
     "listed": true,
     "result": "passed"
    }
   ],
   "closed": true
  },
  {
   "id": "ref-pointer-base",
   "inTree": true,
   "fixes": [
    {
     "commit": "b42396e",
     "inTree": true
    },
    {
     "commit": "7ab4de4",
     "inTree": true
    }
   ],
   "tests": [
    {
     "file": "tests/test_registered_ref_resolution.js",
     "present": true,
     "listed": true,
     "result": "passed"
    },
    {
     "file": "tests/test_ir_registered_docs.mjs",
     "present": true,
     "listed": true,
     "result": "passed"
    }
   ],
   "closed": true
  },
  {
   "id": "ir-draft7-root-ref",
   "inTree": true,
   "fixes": [
    {
     "commit": "6cc0b8d",
     "inTree": true
    }
   ],
   "tests": [
    {
     "file": "tests/test_ir_registered_docs.mjs",
     "present": true,
     "listed": true,
     "result": "passed"
    }
   ],
   "closed": true
  },
  {
   "id": "ir-unreachable-defaults",
   "inTree": true,
   "fixes": [
    {
     "commit": "86f4a91",
     "inTree": true
    }
   ],
   "tests": [
    {
     "file": "tests/test_ir_registered_docs.mjs",
     "present": true,
     "listed": true,
     "result": "passed"
    }
   ],
   "closed": true
  },
  {
   "id": "native-count-bounds",
   "inTree": true,
   "fixes": [
    {
     "commit": "d76b4a9",
     "inTree": true
    }
   ],
   "tests": [
    {
     "file": "tests/test_buffer_gate.js",
     "present": true,
     "listed": true,
     "result": "passed"
    },
    {
     "file": "tests/test_code_point_pairs.js",
     "present": true,
     "listed": true,
     "result": "passed"
    }
   ],
   "closed": true
  },
  {
   "id": "small-engine-negative-max",
   "inTree": true,
   "fixes": [
    {
     "commit": "8f77b65",
     "inTree": true
    }
   ],
   "tests": [
    {
     "file": "tests/test_code_point_pairs.js",
     "present": true,
     "listed": true,
     "result": "passed"
    }
   ],
   "closed": true
  },
  {
   "id": "buffer-preprocess",
   "inTree": true,
   "fixes": [
    {
     "commit": "641f9e2",
     "inTree": true
    },
    {
     "commit": "e114137",
     "inTree": true
    }
   ],
   "tests": [
    {
     "file": "tests/test_buffer_gate.js",
     "present": true,
     "listed": true,
     "result": "passed"
    },
    {
     "file": "tests/test_buffer_defaults_static.js",
     "present": true,
     "listed": true,
     "result": "passed"
    }
   ],
   "closed": true
  },
  {
   "id": "native-repeated-names",
   "inTree": true,
   "fixes": [
    {
     "commit": "56c03df",
     "inTree": true
    },
    {
     "commit": "dbc0434",
     "inTree": true
    },
    {
     "commit": "55e89a0",
     "inTree": true
    },
    {
     "commit": "b11c120",
     "inTree": true
    }
   ],
   "tests": [
    {
     "file": "tests/test_native_duplicate_names.js",
     "present": true,
     "listed": true,
     "result": "passed"
    }
   ],
   "closed": true
  },
  {
   "id": "cache-key-unfaithful",
   "inTree": true,
   "fixes": [
    {
     "commit": "65332c5",
     "inTree": true
    },
    {
     "commit": "a587dbf",
     "inTree": true
    }
   ],
   "tests": [
    {
     "file": "tests/test_compile_cache_unfaithful.js",
     "present": true,
     "listed": true,
     "result": "passed"
    }
   ],
   "closed": true
  },
  {
   "id": "from-standalone-defaults",
   "inTree": true,
   "fixes": [
    {
     "commit": "96e6647",
     "inTree": true
    }
   ],
   "tests": [
    {
     "file": "tests/test_from_standalone_defaults.js",
     "present": true,
     "listed": true,
     "result": "passed"
    }
   ],
   "closed": true
  },
  {
   "id": "keyword-named-names",
   "inTree": true,
   "fixes": [
    {
     "commit": "2791680",
     "inTree": true
    }
   ],
   "tests": [
    {
     "file": "tests/test_keyword_named_names.js",
     "present": true,
     "listed": true,
     "result": "passed"
    }
   ],
   "closed": true
  }
 ]
}
-->
