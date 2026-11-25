# Correctness report

This file is written by `node scripts/gate-report.js`. Do not edit it by hand: every figure in it was printed by the run that wrote it, and `tests/test_gate_report.js` fails when the text and the run it records disagree.

## Summary

- Tree: ata-validator 1.66.0 at commit `01be37e`. Node v25.2.1 on darwin-arm64.
- Gate: 23 paths, each held to the Validator on the same documents. Official suite: 1767 schemas. SchemaStore: 492 schemas. Documents that differ or threw: 250.
- Official JSON Schema Test Suite at `245a45a`: draft2020-12 1300 of 1300, draft2019-09 1259 of 1259, draft7 927 of 927, draft6 839 of 839, draft4 616 of 616, v1 1147 of 1147.
- With `eval` and `new Function` blocked: draft2020-12 1300 of 1300, draft2019-09 1259 of 1259, draft7 927 of 927, draft6 839 of 839, draft4 616 of 616, v1 1147 of 1147.
- Native engine: loaded from @ata-validator/native-darwin-arm64, version 1.66.0.
- Sweep classes: 19. Closed in this tree, with their tests passing: 0. Open in this tree: 19.

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
| JSON Schema Test Suite (`tests/suite`) | `245a45abc90190c0bff04d97e6d2b541b4bb9f12` | 2026-11-03 | test: add missing RFC 3987 coverage to iri and iri-reference (#1249) | draft2020-12, draft2019-09, draft7, draft6, draft4, v1: the required tests, `optional/format` and `optional/non-bmp-regex.json` |
| SchemaStore | `ce64da2a95a2bd40740c2d608206f8a36024d30b` | 2026-10-08 | fix(claude-code-settings): accept skills-dir marketplace source (#6469) | 990 schema files in `src/schemas/json`; those with sample documents the Validator builds are checked |

The suite checkout is at the commit this tree pins.

## Paths, official suite

1767 schemas the Validator builds. Gate exit status 0.

| path | error fields compared | order compared | schemas taken | declined | documents | differ | threw | allowed as ATA9000 | other order, none promised | known |
|---|---|---|---|---|---|---|---|---|---|---|
| interpreted engine | rich | yes | 1767 | 0 | 24545 | 0 | 0 | 0 | 0 | 1 |
| generated code, warm | rich | yes | 1767 | 0 | 24545 | 0 | 0 | 0 | 0 | 0 |
| small engine | rich | yes | 1609 | 158 | 22625 | 0 | 0 | 0 | 0 | 1 |
| v2 core + featuresFor | plain | yes | 1767 | 0 | 24545 | 0 | 0 | 0 | 0 | 1 |
| v2 core + featuresFor, no defaults | plain | yes | 1767 | 0 | 24545 | 0 | 0 | 0 | 0 | 1 |
| v2 core + featuresFor, formats off | plain | yes | 1767 | 0 | 24545 | 0 | 0 | 0 | 0 | 1 |
| v2 core + featuresFor, formats given | plain | yes | 1767 | 0 | 24545 | 0 | 0 | 0 | 0 | 1 |
| v2 core + featuresFor, schemas map | plain | yes | 1767 | 0 | 24545 | 0 | 0 | 0 | 0 | 0 |
| closure tree | rich | yes | 1767 | 0 | 24545 | 0 | 0 | 0 | 0 | 1 |
| JSON text | rich | yes | 1767 | 0 | 23421 | 0 | 0 | 0 | 0 | 0 |
| plain errors | plain | yes | 1767 | 0 | 24545 | 0 | 0 | 0 | 0 | 1 |
| module | module | yes | 1635 | 132 | 23018 | 0 | 0 | 72 | 0 | 0 |
| module, one pass | module | no | 1635 | 132 | 23018 | 0 | 0 | 72 | 0 | 0 |
| module, plain errors | plain | yes | 1625 | 142 | 22918 | 0 | 0 | 0 | 0 | 0 |
| compact module | module | yes | 1625 | 142 | 22918 | 0 | 0 | 0 | 0 | 1 |
| schema module | module | yes | 1743 | 24 | 24235 | 0 | 0 | 0 | 0 | 1 |
| ir module | rich | yes | 1763 | 4 | 24505 | 0 | 0 | 0 | 0 | 1 |
| ir module, plain errors | plain | yes | 1763 | 4 | 24505 | 0 | 0 | 0 | 0 | 1 |
| ir closures | rich | yes | 1765 | 2 | 24525 | 0 | 0 | 0 | 0 | 1 |
| ir table | rich | yes | 1501 | 266 | 21363 | 0 | 0 | 0 | 0 | 0 |
| ir table, plain errors | plain | yes | 1501 | 266 | 21363 | 0 | 0 | 0 | 0 | 0 |
| ir plan as JSON | rich | yes | 1460 | 307 | 20830 | 0 | 0 | 0 | 0 | 0 |
| ir closure module | plain | yes | 601 | 1166 | 10762 | 0 | 0 | 0 | 0 | 0 |

## Paths, SchemaStore

492 schemas the Validator builds. Gate exit status 1.

| path | error fields compared | order compared | schemas taken | declined | documents | differ | threw | allowed as ATA9000 | other order, none promised | known |
|---|---|---|---|---|---|---|---|---|---|---|
| interpreted engine | rich | yes | 492 | 0 | 14756 | 0 | 0 | 0 | 0 | 0 |
| generated code, warm | rich | yes | 492 | 0 | 14756 | 0 | 0 | 0 | 0 | 0 |
| small engine | rich | yes | 489 | 3 | 14708 | 50 | 0 | 0 | 0 | 0 |
| v2 core + featuresFor | plain | yes | 492 | 0 | 14756 | 50 | 0 | 0 | 0 | 0 |
| v2 core + featuresFor, no defaults | plain | yes | 492 | 0 | 14756 | 50 | 0 | 0 | 0 | 0 |
| v2 core + featuresFor, formats off | plain | yes | 492 | 0 | 14756 | 50 | 0 | 0 | 0 | 0 |
| v2 core + featuresFor, formats given | plain | yes | 492 | 0 | 14756 | 50 | 0 | 0 | 0 | 0 |
| v2 core + featuresFor, schemas map | plain | yes | 492 | 0 | 14756 | 0 | 0 | 0 | 0 | 0 |
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

- SchemaStore: 48 documents of `small engine \| errors \| sample`, the first: `schemastore/anywork-ac-1.0 \| errors
      Validator ["ATA5001","$ref","","#",{"ref":"base.json#/definitions/path"},"cannot resolve $ref base.json#/definitions/path",null,"[object, 3 keys]",null,null,null,2,"https://ata-validator.com/e/ATA5001",null]
      path      ["ATA4003","anyOf","/swagger-codeg`
- SchemaStore: 48 documents of `v2 core + featuresFor \| errors \| sample`, the first: `schemastore/anywork-ac-1.0 \| errors
      Validator ["$ref","","#",{"ref":"base.json#/definitions/path"},"cannot resolve $ref base.json#/definitions/path",null] keys instancePath,keyword,message,params,schemaPath
      path      ["anyOf","/swagger-codegen/actions","#/allOf/0/then/properties/swagger-`
- SchemaStore: 48 documents of `v2 core + featuresFor, no defaults \| errors \| sample`, the first: `schemastore/anywork-ac-1.0 \| errors
      Validator ["$ref","","#",{"ref":"base.json#/definitions/path"},"cannot resolve $ref base.json#/definitions/path",null] keys instancePath,keyword,message,params,schemaPath
      path      ["anyOf","/swagger-codegen/actions","#/allOf/0/then/properties/swagger-`
- SchemaStore: 48 documents of `v2 core + featuresFor, formats off \| errors \| sample`, the first: `schemastore/anywork-ac-1.0 \| errors
      Validator ["$ref","","#",{"ref":"base.json#/definitions/path"},"cannot resolve $ref base.json#/definitions/path",null] keys instancePath,keyword,message,params,schemaPath
      path      ["anyOf","/swagger-codegen/actions","#/allOf/0/then/properties/swagger-`
- SchemaStore: 48 documents of `v2 core + featuresFor, formats given \| errors \| sample`, the first: `schemastore/anywork-ac-1.0 \| errors
      Validator ["$ref","","#",{"ref":"base.json#/definitions/path"},"cannot resolve $ref base.json#/definitions/path",null] keys instancePath,keyword,message,params,schemaPath
      path      ["anyOf","/swagger-codegen/actions","#/allOf/0/then/properties/swagger-`
- SchemaStore: 2 documents of `small engine \| verdict \| sample`, the first: `schemastore/minecraft-texture-mcmeta \| verdict: Validator false, validate true, isValid true \| {"animation":{"frames":[0,1,2,{"index":10,"time":20}],"frametime":8,"height":8,"interpolate":true,"w keys ["animation","fusion"]`
- SchemaStore: 2 documents of `v2 core + featuresFor \| verdict \| sample`, the first: `schemastore/minecraft-texture-mcmeta \| verdict: Validator false, validate true, isValid true \| {"animation":{"frames":[0,1,2,{"index":10,"time":20}],"frametime":8,"height":8,"interpolate":true,"w keys ["animation","fusion"]`
- SchemaStore: 2 documents of `v2 core + featuresFor, no defaults \| verdict \| sample`, the first: `schemastore/minecraft-texture-mcmeta \| verdict: Validator false, validate true, isValid true \| {"animation":{"frames":[0,1,2,{"index":10,"time":20}],"frametime":8,"height":8,"interpolate":true,"w keys ["animation","fusion"]`
- SchemaStore: 2 documents of `v2 core + featuresFor, formats off \| verdict \| sample`, the first: `schemastore/minecraft-texture-mcmeta \| verdict: Validator false, validate true, isValid true \| {"animation":{"frames":[0,1,2,{"index":10,"time":20}],"frametime":8,"height":8,"interpolate":true,"w keys ["animation","fusion"]`
- SchemaStore: 2 documents of `v2 core + featuresFor, formats given \| verdict \| sample`, the first: `schemastore/minecraft-texture-mcmeta \| verdict: Validator false, validate true, isValid true \| {"animation":{"frames":[0,1,2,{"index":10,"time":20}],"frametime":8,"height":8,"interpolate":true,"w keys ["animation","fusion"]`

## Known exceptions

- Error order, for a suite group whose description ends in "unevaluatedItems with $dynamicRef". A `$ref` to an embedded resource that holds a `$dynamicRef`: the errors name paths in two resources and neither engine ranks them, so generated code and the interpreted walk list the same errors in a different order. The verdict and the set of errors agree. Open, not decided.
  - interpreted engine, official suite: `draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef`, document kind "array".
  - small engine, official suite: `draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef`, document kind "array".
  - v2 core + featuresFor, official suite: `draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef`, document kind "array".
  - v2 core + featuresFor, no defaults, official suite: `draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef`, document kind "array".
  - v2 core + featuresFor, formats off, official suite: `draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef`, document kind "array".
  - v2 core + featuresFor, formats given, official suite: `draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef`, document kind "array".
  - closure tree, official suite: `draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef`, document kind "array".
  - plain errors, official suite: `draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef`, document kind "array".
  - compact module, official suite: `draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef`, document kind "array".
  - schema module, official suite: `draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef`, document kind "array".
  - ir module, official suite: `draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef`, document kind "array".
  - ir module, plain errors, official suite: `draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef`, document kind "array".
  - ir closures, official suite: `draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef`, document kind "array".

## Official test suite

`node tests/run_suite.js <dialect>`, suite at `245a45a`. Every case of the dialect directory runs; a schema that does not compile counts as failed. `format` is an annotation, as the suite expects, and the suite's remote documents are registered from `tests/suite/remotes`. The optional tests are not in these figures.

| dialect | passed | cases | listed known failures | regressions | exit status |
|---|---|---|---|---|---|
| draft2020-12 | 1300 | 1300 | 0 | 0 | 0 |
| draft2019-09 | 1259 | 1259 | 0 | 0 | 0 |
| draft7 | 927 | 927 | 0 | 0 | 0 |
| draft6 | 839 | 839 | 0 | 0 | 0 |
| draft4 | 616 | 616 | 0 | 0 | 0 |
| v1 | 1147 | 1147 | 0 | 0 | 0 |

## With code generation blocked

`node tests/test_no_eval.js` replaces `eval` and `Function` before the package loads, so that building a function from source throws, turns the native engine off, and runs every case of each dialect directory through `validate()`.

| dialect | passed | cases | failed | errored |
|---|---|---|---|---|
| draft2020-12 | 1300 | 1300 | 0 | 0 |
| draft2019-09 | 1259 | 1259 | 0 | 0 |
| draft7 | 927 | 927 | 0 | 0 |
| draft6 | 839 | 839 | 0 | 0 |
| draft4 | 616 | 616 | 0 | 0 |
| v1 | 1147 | 1147 | 0 | 0 |

Code generation attempts blocked: 1. Standard Schema check with code generation blocked: passed. Exit status 0.

## Native engine

The gate loaded the native engine from @ata-validator/native-darwin-arm64. With it loaded, the JSON text path hands long text to it. The gate has no path of its own for the buffer APIs (`isValid(buffer)`, `countValid`, `isValidParallel`, `isValidNDJSON`, `batchIsValid`).

## Sweep classes

The classes found by the sweep of 1.x for answers that differ between paths, one per changelog entry of their fixes, whether those fixes are in this tree or not yet merged into it. A class is closed in this tree when every commit that fixes it is in this tree's history and every test that holds it is present, listed in `tests/run.js` and passed in this run. The tests of a class whose fix is not in this tree were not run: they would pass without saying anything about the class.

| class | effect before the fix | fix commits | in this tree | tests | result |
|---|---|---|---|---|---|
| A `$ref` that does not resolve, inside a document given through `schemas` and reached through another reference: generated code and the modules wrote no check for it. | accepted documents it should reject | `3429ae8`, `45052bb` | no | `tests/test_registered_ref_resolution.js`, `tests/test_codegen_entrypoint_agreement.js` | open: fix not in this tree |
| The defaults, `removeAdditional` and `coerceTypes` passes followed a relative `$ref` into another document by path suffix. | filled, removed or coerced by one document while validation read another | `bb8a738`, `73d307f` | no | `tests/test_registered_ref_resolution.js` | open: fix not in this tree |
| A cycle of references across registered documents reached the verdict generator as written, and it wrote no check for the reference back. | accepted documents it should reject | `8f41bb7` | no | `tests/test_registered_ref_resolution.js` | open: fix not in this tree |
| A local definition reached again through an anchor, or an anchor that refers to itself, on a cycle the generator does not detect. | accepted documents it should reject | `3953dcd` | no | `tests/test_registered_ref_resolution.js` | open: fix not in this tree |
| `minLength` and `maxLength` in the interpreted engine counted a lone high surrogate and the unit after it as one code point. | accepted documents it should reject | `dc9bf05` | no | `tests/test_code_point_pairs.js` | open: fix not in this tree |
| `enum`, `const` and `uniqueItems` compared two objects by the keys of one side only, for objects with a non-enumerable own property. | the answer depended on the order of the two values compared | `333707e`, `95f3e90` | no | `tests/test_deep_equal_enumerable.js` | open: fix not in this tree |
| A module from `ata-validator/ir` for a schema with `propertyDependencies` or draft-07 `dependencies` did not declare the object flag it reads. | threw instead of answering | `57a1e22` | no | `tests/test_ir_object_flag.mjs` | open: fix not in this tree |
| `propertyNames` with `minLength` or `maxLength` counted UTF-16 units in the three code generators, where the interpreted engine counts code points. | accepted documents it should reject and rejected documents it should accept | `05ab41e` | no | `tests/test_code_point_pairs.js` | open: fix not in this tree |
| The closure compiler compared `enum`, `const` and `uniqueItems` values by a canonical string that wrote a string inside an array without quotes. | accepted documents it should reject and rejected documents it should accept | `96849ae` | no | `tests/test_closure_equality.js` | open: fix not in this tree |
| A schema reached by a JSON pointer through a name no keyword reads had its own references resolved against the root. | accepted documents it should reject | `b42396e`, `7ab4de4` | no | `tests/test_registered_ref_resolution.js`, `tests/test_ir_registered_docs.mjs` | open: fix not in this tree |
| `ata-validator/ir` registered a draft-07 document whose root is a `$ref` under no name. | rejected documents it should accept | `6cc0b8d` | no | `tests/test_ir_registered_docs.mjs` | open: fix not in this tree |
| A module from `ata-validator/ir` called the shared defaults pass for defaults that pass cannot reach. | threw instead of answering | `86f4a91` | no | `tests/test_ir_registered_docs.mjs` | open: fix not in this tree |
| The native engine skipped a length, item or property count bound that is not a whole number from zero. | accepted documents it should reject | `d76b4a9` | no | `tests/test_buffer_gate.js`, `tests/test_code_point_pairs.js` | open: fix not in this tree |
| The small engine that answers a simple schema's first calls read `maxLength: -1` as no bound. | accepted documents it should reject | `8f77b65` | no | `tests/test_code_point_pairs.js` | open: fix not in this tree |
| The buffer APIs answered from the native walker for a validator with defaults, `coerceTypes` or `removeAdditional`, judging the bytes before those passes. | accepted documents it should reject and rejected documents it should accept | `641f9e2`, `e114137` | no | `tests/test_buffer_gate.js`, `tests/test_buffer_defaults_static.js` | open: fix not in this tree |
| The native walkers read JSON text that names a member twice, or holds a surrogate escape outside a pair, differently from JSON.parse. | accepted documents it should reject and rejected documents it should accept | `56c03df`, `dbc0434`, `55e89a0`, `b11c120` | no | `tests/test_native_duplicate_names.js` | open: fix not in this tree |
| A schema holding a value JSON cannot carry (NaN, Infinity, a hole) shared compiled code with the schema its JSON text spells. | accepted documents it should reject | `65332c5`, `a587dbf` | no | `tests/test_compile_cache_unfaithful.js` | open: fix not in this tree |
| `Validator.fromStandalone()` built its defaults pass from the root schema alone and ran it only in `validate()`. | accepted documents it should reject and rejected documents it should accept | `96e6647` | no | `tests/test_from_standalone_defaults.js` | open: fix not in this tree |
| A name that is also a keyword, under `properties` or another map of names, was read as the keyword: generated code dropped the schema of a property named `$id`, which the draft-07 and draft-06 meta-schemas constrain; a name spelled `$dynamicRef` threw; the native routing missed a reference behind a property named `const`. | accepted documents it should reject and rejected documents it should accept | `2791680` | no | `tests/test_keyword_named_names.js` | open: fix not in this tree |

## Not covered

- The gate holds paths to the Validator, not to the specification. A defect the Validator shares with every path does not show in it. The official suite figures are the check against the specification, and they cover what the suite's cases cover.
- Every run here is Node v25.2.1 on darwin-arm64. Deno, Bun, browsers and Cloudflare Workers were not run, and neither were other operating systems.
- The package entries for browsers and Workers (`index.browser.mjs`, `index.edge.js`), `ata-validator/lite`, `ata-validator/compat` and `ata-validator/stream` are not gate paths. How `ata-validator/compat` differs from the default validator is not part of this report.
- The `ata` command line binary is not run. The modules the gate checks are built through library calls (`toStandaloneModule`, `toCompactModule`, `toSchemaModule`, `compiledModuleFor`), not through the binary.
- The buffer APIs have no gate path. The native engine with code generation blocked is not run anywhere here: the run with code generation blocked turns the native engine off.
- The gate leaves out the suite groups whose schema names `http://localhost:1234`, the suite's remote documents; `tests/run_suite.js` and `tests/test_no_eval.js` include them.
- The documents a SchemaStore schema meets are its samples, copies changed in one place and the extra documents above. A schema with no sample document is not checked.
- The 2.0 entries are not in this tree and not in this report.

## Known open items

- Sweep class open in this tree: A `$ref` that does not resolve, inside a document given through `schemas` and reached through another reference: generated code and the modules wrote no check for it.
- Sweep class open in this tree: The defaults, `removeAdditional` and `coerceTypes` passes followed a relative `$ref` into another document by path suffix.
- Sweep class open in this tree: A cycle of references across registered documents reached the verdict generator as written, and it wrote no check for the reference back.
- Sweep class open in this tree: A local definition reached again through an anchor, or an anchor that refers to itself, on a cycle the generator does not detect.
- Sweep class open in this tree: `minLength` and `maxLength` in the interpreted engine counted a lone high surrogate and the unit after it as one code point.
- Sweep class open in this tree: `enum`, `const` and `uniqueItems` compared two objects by the keys of one side only, for objects with a non-enumerable own property.
- Sweep class open in this tree: A module from `ata-validator/ir` for a schema with `propertyDependencies` or draft-07 `dependencies` did not declare the object flag it reads.
- Sweep class open in this tree: `propertyNames` with `minLength` or `maxLength` counted UTF-16 units in the three code generators, where the interpreted engine counts code points.
- Sweep class open in this tree: The closure compiler compared `enum`, `const` and `uniqueItems` values by a canonical string that wrote a string inside an array without quotes.
- Sweep class open in this tree: A schema reached by a JSON pointer through a name no keyword reads had its own references resolved against the root.
- Sweep class open in this tree: `ata-validator/ir` registered a draft-07 document whose root is a `$ref` under no name.
- Sweep class open in this tree: A module from `ata-validator/ir` called the shared defaults pass for defaults that pass cannot reach.
- Sweep class open in this tree: The native engine skipped a length, item or property count bound that is not a whole number from zero.
- Sweep class open in this tree: The small engine that answers a simple schema's first calls read `maxLength: -1` as no bound.
- Sweep class open in this tree: The buffer APIs answered from the native walker for a validator with defaults, `coerceTypes` or `removeAdditional`, judging the bytes before those passes.
- Sweep class open in this tree: The native walkers read JSON text that names a member twice, or holds a surrogate escape outside a pair, differently from JSON.parse.
- Sweep class open in this tree: A schema holding a value JSON cannot carry (NaN, Infinity, a hole) shared compiled code with the schema its JSON text spells.
- Sweep class open in this tree: `Validator.fromStandalone()` built its defaults pass from the root schema alone and ran it only in `validate()`.
- Sweep class open in this tree: A name that is also a keyword, under `properties` or another map of names, was read as the keyword: generated code dropped the schema of a property named `$id`, which the draft-07 and draft-06 meta-schemas constrain; a name spelled `$dynamicRef` threw; the native routing missed a reference behind a property named `const`.
- The error order exception "unevaluatedItems with $dynamicRef" in `scripts/gate.js`.
- 250 documents differ in the gate.

## Reproduce

From a clean clone at the commit that adds this file, whose code is that of `01be37e`, with Node and git:

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
  "commit": "01be37e80530eadfb7637ecdb7e8b156047b3655",
  "version": "1.66.0",
  "uncommitted": []
 },
 "corpora": {
  "suite": {
   "commit": "245a45abc90190c0bff04d97e6d2b541b4bb9f12",
   "date": "2026-11-03",
   "subject": "test: add missing RFC 3987 coverage to iri and iri-reference (#1249)",
   "pinned": "245a45abc90190c0bff04d97e6d2b541b4bb9f12",
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
    "source": "@ata-validator/native-darwin-arm64",
    "found": [
     {
      "source": "@ata-validator/native-darwin-arm64",
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
   "schemas": 1767,
   "paths": [
    {
     "name": "interpreted engine",
     "fields": "rich",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 1767,
     "declined": 0,
     "docs": 24545,
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
     "taken": 1767,
     "declined": 0,
     "docs": 24545,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    },
    {
     "name": "small engine",
     "fields": "rich",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 1609,
     "declined": 158,
     "docs": 22625,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 1,
     "unordered": 0
    },
    {
     "name": "v2 core + featuresFor",
     "fields": "plain",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 1767,
     "declined": 0,
     "docs": 24545,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 1,
     "unordered": 0
    },
    {
     "name": "v2 core + featuresFor, no defaults",
     "fields": "plain",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 1767,
     "declined": 0,
     "docs": 24545,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 1,
     "unordered": 0
    },
    {
     "name": "v2 core + featuresFor, formats off",
     "fields": "plain",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 1767,
     "declined": 0,
     "docs": 24545,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 1,
     "unordered": 0
    },
    {
     "name": "v2 core + featuresFor, formats given",
     "fields": "plain",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 1767,
     "declined": 0,
     "docs": 24545,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 1,
     "unordered": 0
    },
    {
     "name": "v2 core + featuresFor, schemas map",
     "fields": "plain",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 1767,
     "declined": 0,
     "docs": 24545,
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
     "taken": 1767,
     "declined": 0,
     "docs": 24545,
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
     "taken": 1767,
     "declined": 0,
     "docs": 23421,
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
     "taken": 1767,
     "declined": 0,
     "docs": 24545,
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
     "taken": 1635,
     "declined": 132,
     "docs": 23018,
     "diffs": 0,
     "threw": 0,
     "abort": 72,
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
     "taken": 1635,
     "declined": 132,
     "docs": 23018,
     "diffs": 0,
     "threw": 0,
     "abort": 72,
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
     "taken": 1625,
     "declined": 142,
     "docs": 22918,
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
     "taken": 1625,
     "declined": 142,
     "docs": 22918,
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
     "taken": 1743,
     "declined": 24,
     "docs": 24235,
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
     "taken": 1763,
     "declined": 4,
     "docs": 24505,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 1,
     "unordered": 0
    },
    {
     "name": "ir module, plain errors",
     "fields": "plain",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 1763,
     "declined": 4,
     "docs": 24505,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 1,
     "unordered": 0
    },
    {
     "name": "ir closures",
     "fields": "rich",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 1765,
     "declined": 2,
     "docs": 24525,
     "diffs": 0,
     "threw": 0,
     "abort": 0,
     "known": 1,
     "unordered": 0
    },
    {
     "name": "ir table",
     "fields": "rich",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 1501,
     "declined": 266,
     "docs": 21363,
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
     "taken": 1501,
     "declined": 266,
     "docs": 21363,
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
     "taken": 1460,
     "declined": 307,
     "docs": 20830,
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
     "taken": 601,
     "declined": 1166,
     "docs": 10762,
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
    "unevaluatedItems with $dynamicRef"
   ],
   "knownSeen": [
    {
     "path": "interpreted engine",
     "label": "draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef",
     "tag": "array",
     "what": "errors"
    },
    {
     "path": "small engine",
     "label": "draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef",
     "tag": "array",
     "what": "errors"
    },
    {
     "path": "v2 core + featuresFor",
     "label": "draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef",
     "tag": "array",
     "what": "errors"
    },
    {
     "path": "v2 core + featuresFor, no defaults",
     "label": "draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef",
     "tag": "array",
     "what": "errors"
    },
    {
     "path": "v2 core + featuresFor, formats off",
     "label": "draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef",
     "tag": "array",
     "what": "errors"
    },
    {
     "path": "v2 core + featuresFor, formats given",
     "label": "draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef",
     "tag": "array",
     "what": "errors"
    },
    {
     "path": "closure tree",
     "label": "draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef",
     "tag": "array",
     "what": "errors"
    },
    {
     "path": "plain errors",
     "label": "draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef",
     "tag": "array",
     "what": "errors"
    },
    {
     "path": "compact module",
     "label": "draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef",
     "tag": "array",
     "what": "errors"
    },
    {
     "path": "schema module",
     "label": "draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef",
     "tag": "array",
     "what": "errors"
    },
    {
     "path": "ir module",
     "label": "draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef",
     "tag": "array",
     "what": "errors"
    },
    {
     "path": "ir module, plain errors",
     "label": "draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef",
     "tag": "array",
     "what": "errors"
    },
    {
     "path": "ir closures",
     "label": "draft2020-12/unevaluatedItems.json: unevaluatedItems with $dynamicRef",
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
    "source": "@ata-validator/native-darwin-arm64",
    "found": [
     {
      "source": "@ata-validator/native-darwin-arm64",
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
     "name": "small engine",
     "fields": "rich",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 489,
     "declined": 3,
     "docs": 14708,
     "diffs": 50,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    },
    {
     "name": "v2 core + featuresFor",
     "fields": "plain",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 492,
     "declined": 0,
     "docs": 14756,
     "diffs": 50,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    },
    {
     "name": "v2 core + featuresFor, no defaults",
     "fields": "plain",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 492,
     "declined": 0,
     "docs": 14756,
     "diffs": 50,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    },
    {
     "name": "v2 core + featuresFor, formats off",
     "fields": "plain",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 492,
     "declined": 0,
     "docs": 14756,
     "diffs": 50,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    },
    {
     "name": "v2 core + featuresFor, formats given",
     "fields": "plain",
     "ordered": true,
     "abortAllowed": false,
     "json": false,
     "fills": true,
     "taken": 492,
     "declined": 0,
     "docs": 14756,
     "diffs": 50,
     "threw": 0,
     "abort": 0,
     "known": 0,
     "unordered": 0
    },
    {
     "name": "v2 core + featuresFor, schemas map",
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
   "kinds": [
    {
     "kind": "small engine | errors | sample",
     "n": 48,
     "first": "schemastore/anywork-ac-1.0 | errors\n      Validator [\"ATA5001\",\"$ref\",\"\",\"#\",{\"ref\":\"base.json#/definitions/path\"},\"cannot resolve $ref base.json#/definitions/path\",null,\"[object, 3 keys]\",null,null,null,2,\"https://ata-validator.com/e/ATA5001\",null]\n      path      [\"ATA4003\",\"anyOf\",\"/swagger-codegen/actions\",\"#/allOf/0/then/properties/swagger-codegen/properties/actions/anyOf\",{\"variants\":2,\"closest\":1,\"closestName\":\"variant 2\"},\"value matched 0 of 2 anyOf variants\",null,\"[array, 2 items]\",null,null,null,3,\"https://ata-validator.com/e/ATA4003\",[[\"ATA4001\",\"on | {\"ctype\":\"swagger-codegen\",\"cversion\":1,\"swagger-codegen\":{\"actions\":[\"all\",{\"schema\":\"authenticatio keys [\"ctype\",\"cversion\",\"swagger-codegen\"]"
    },
    {
     "kind": "v2 core + featuresFor | errors | sample",
     "n": 48,
     "first": "schemastore/anywork-ac-1.0 | errors\n      Validator [\"$ref\",\"\",\"#\",{\"ref\":\"base.json#/definitions/path\"},\"cannot resolve $ref base.json#/definitions/path\",null] keys instancePath,keyword,message,params,schemaPath\n      path      [\"anyOf\",\"/swagger-codegen/actions\",\"#/allOf/0/then/properties/swagger-codegen/properties/actions/anyOf\",{\"variants\":2,\"closest\":1,\"closestName\":\"variant 2\"},\"value matched 0 of 2 anyOf variants\",[[\"oneOf\",\"/swagger-codegen/actions/1\",\"#/allOf/0/then/properties/swagger-codegen/properties/actions/any | {\"ctype\":\"swagger-codegen\",\"cversion\":1,\"swagger-codegen\":{\"actions\":[\"all\",{\"schema\":\"authenticatio keys [\"ctype\",\"cversion\",\"swagger-codegen\"]"
    },
    {
     "kind": "v2 core + featuresFor, no defaults | errors | sample",
     "n": 48,
     "first": "schemastore/anywork-ac-1.0 | errors\n      Validator [\"$ref\",\"\",\"#\",{\"ref\":\"base.json#/definitions/path\"},\"cannot resolve $ref base.json#/definitions/path\",null] keys instancePath,keyword,message,params,schemaPath\n      path      [\"anyOf\",\"/swagger-codegen/actions\",\"#/allOf/0/then/properties/swagger-codegen/properties/actions/anyOf\",{\"variants\":2,\"closest\":1,\"closestName\":\"variant 2\"},\"value matched 0 of 2 anyOf variants\",[[\"oneOf\",\"/swagger-codegen/actions/1\",\"#/allOf/0/then/properties/swagger-codegen/properties/actions/any | {\"ctype\":\"swagger-codegen\",\"cversion\":1,\"swagger-codegen\":{\"actions\":[\"all\",{\"schema\":\"authenticatio keys [\"ctype\",\"cversion\",\"swagger-codegen\"]"
    },
    {
     "kind": "v2 core + featuresFor, formats off | errors | sample",
     "n": 48,
     "first": "schemastore/anywork-ac-1.0 | errors\n      Validator [\"$ref\",\"\",\"#\",{\"ref\":\"base.json#/definitions/path\"},\"cannot resolve $ref base.json#/definitions/path\",null] keys instancePath,keyword,message,params,schemaPath\n      path      [\"anyOf\",\"/swagger-codegen/actions\",\"#/allOf/0/then/properties/swagger-codegen/properties/actions/anyOf\",{\"variants\":2,\"closest\":1,\"closestName\":\"variant 2\"},\"value matched 0 of 2 anyOf variants\",[[\"oneOf\",\"/swagger-codegen/actions/1\",\"#/allOf/0/then/properties/swagger-codegen/properties/actions/any | {\"ctype\":\"swagger-codegen\",\"cversion\":1,\"swagger-codegen\":{\"actions\":[\"all\",{\"schema\":\"authenticatio keys [\"ctype\",\"cversion\",\"swagger-codegen\"]"
    },
    {
     "kind": "v2 core + featuresFor, formats given | errors | sample",
     "n": 48,
     "first": "schemastore/anywork-ac-1.0 | errors\n      Validator [\"$ref\",\"\",\"#\",{\"ref\":\"base.json#/definitions/path\"},\"cannot resolve $ref base.json#/definitions/path\",null] keys instancePath,keyword,message,params,schemaPath\n      path      [\"anyOf\",\"/swagger-codegen/actions\",\"#/allOf/0/then/properties/swagger-codegen/properties/actions/anyOf\",{\"variants\":2,\"closest\":1,\"closestName\":\"variant 2\"},\"value matched 0 of 2 anyOf variants\",[[\"oneOf\",\"/swagger-codegen/actions/1\",\"#/allOf/0/then/properties/swagger-codegen/properties/actions/any | {\"ctype\":\"swagger-codegen\",\"cversion\":1,\"swagger-codegen\":{\"actions\":[\"all\",{\"schema\":\"authenticatio keys [\"ctype\",\"cversion\",\"swagger-codegen\"]"
    },
    {
     "kind": "small engine | verdict | sample",
     "n": 2,
     "first": "schemastore/minecraft-texture-mcmeta | verdict: Validator false, validate true, isValid true | {\"animation\":{\"frames\":[0,1,2,{\"index\":10,\"time\":20}],\"frametime\":8,\"height\":8,\"interpolate\":true,\"w keys [\"animation\",\"fusion\"]"
    },
    {
     "kind": "v2 core + featuresFor | verdict | sample",
     "n": 2,
     "first": "schemastore/minecraft-texture-mcmeta | verdict: Validator false, validate true, isValid true | {\"animation\":{\"frames\":[0,1,2,{\"index\":10,\"time\":20}],\"frametime\":8,\"height\":8,\"interpolate\":true,\"w keys [\"animation\",\"fusion\"]"
    },
    {
     "kind": "v2 core + featuresFor, no defaults | verdict | sample",
     "n": 2,
     "first": "schemastore/minecraft-texture-mcmeta | verdict: Validator false, validate true, isValid true | {\"animation\":{\"frames\":[0,1,2,{\"index\":10,\"time\":20}],\"frametime\":8,\"height\":8,\"interpolate\":true,\"w keys [\"animation\",\"fusion\"]"
    },
    {
     "kind": "v2 core + featuresFor, formats off | verdict | sample",
     "n": 2,
     "first": "schemastore/minecraft-texture-mcmeta | verdict: Validator false, validate true, isValid true | {\"animation\":{\"frames\":[0,1,2,{\"index\":10,\"time\":20}],\"frametime\":8,\"height\":8,\"interpolate\":true,\"w keys [\"animation\",\"fusion\"]"
    },
    {
     "kind": "v2 core + featuresFor, formats given | verdict | sample",
     "n": 2,
     "first": "schemastore/minecraft-texture-mcmeta | verdict: Validator false, validate true, isValid true | {\"animation\":{\"frames\":[0,1,2,{\"index\":10,\"time\":20}],\"frametime\":8,\"height\":8,\"interpolate\":true,\"w keys [\"animation\",\"fusion\"]"
    }
   ],
   "report": [],
   "known": [],
   "knownOrder": [
    "unevaluatedItems with $dynamicRef"
   ],
   "knownSeen": [],
   "exit": 1
  }
 },
 "dialects": [
  {
   "dialect": "draft2020-12",
   "passed": 1300,
   "total": 1300,
   "knownFailures": 0,
   "regressions": 0,
   "exit": 0
  },
  {
   "dialect": "draft2019-09",
   "passed": 1259,
   "total": 1259,
   "knownFailures": 0,
   "regressions": 0,
   "exit": 0
  },
  {
   "dialect": "draft7",
   "passed": 927,
   "total": 927,
   "knownFailures": 0,
   "regressions": 0,
   "exit": 0
  },
  {
   "dialect": "draft6",
   "passed": 839,
   "total": 839,
   "knownFailures": 0,
   "regressions": 0,
   "exit": 0
  },
  {
   "dialect": "draft4",
   "passed": 616,
   "total": 616,
   "knownFailures": 0,
   "regressions": 0,
   "exit": 0
  },
  {
   "dialect": "v1",
   "passed": 1147,
   "total": 1147,
   "knownFailures": 0,
   "regressions": 0,
   "exit": 0
  }
 ],
 "noEval": {
  "dialects": [
   {
    "dialect": "draft2020-12",
    "passed": 1300,
    "total": 1300,
    "failed": 0,
    "errored": 0
   },
   {
    "dialect": "draft2019-09",
    "passed": 1259,
    "total": 1259,
    "failed": 0,
    "errored": 0
   },
   {
    "dialect": "draft7",
    "passed": 927,
    "total": 927,
    "failed": 0,
    "errored": 0
   },
   {
    "dialect": "draft6",
    "passed": 839,
    "total": 839,
    "failed": 0,
    "errored": 0
   },
   {
    "dialect": "draft4",
    "passed": 616,
    "total": 616,
    "failed": 0,
    "errored": 0
   },
   {
    "dialect": "v1",
    "passed": 1147,
    "total": 1147,
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
   "inTree": false,
   "fixes": [
    {
     "commit": "3429ae8",
     "inTree": false
    },
    {
     "commit": "45052bb",
     "inTree": false
    }
   ],
   "tests": [
    {
     "file": "tests/test_registered_ref_resolution.js",
     "present": true,
     "listed": true,
     "result": "not run"
    },
    {
     "file": "tests/test_codegen_entrypoint_agreement.js",
     "present": true,
     "listed": true,
     "result": "not run"
    }
   ],
   "closed": false
  },
  {
   "id": "ref-preprocess-suffix",
   "inTree": false,
   "fixes": [
    {
     "commit": "bb8a738",
     "inTree": false
    },
    {
     "commit": "73d307f",
     "inTree": false
    }
   ],
   "tests": [
    {
     "file": "tests/test_registered_ref_resolution.js",
     "present": true,
     "listed": true,
     "result": "not run"
    }
   ],
   "closed": false
  },
  {
   "id": "ref-cycle-documents",
   "inTree": false,
   "fixes": [
    {
     "commit": "8f41bb7",
     "inTree": false
    }
   ],
   "tests": [
    {
     "file": "tests/test_registered_ref_resolution.js",
     "present": true,
     "listed": true,
     "result": "not run"
    }
   ],
   "closed": false
  },
  {
   "id": "ref-cycle-local",
   "inTree": false,
   "fixes": [
    {
     "commit": "3953dcd",
     "inTree": false
    }
   ],
   "tests": [
    {
     "file": "tests/test_registered_ref_resolution.js",
     "present": true,
     "listed": true,
     "result": "not run"
    }
   ],
   "closed": false
  },
  {
   "id": "length-lone-high-surrogate",
   "inTree": false,
   "fixes": [
    {
     "commit": "dc9bf05",
     "inTree": false
    }
   ],
   "tests": [
    {
     "file": "tests/test_code_point_pairs.js",
     "present": true,
     "listed": true,
     "result": "not run"
    }
   ],
   "closed": false
  },
  {
   "id": "equality-enumerable",
   "inTree": false,
   "fixes": [
    {
     "commit": "333707e",
     "inTree": false
    },
    {
     "commit": "95f3e90",
     "inTree": false
    }
   ],
   "tests": [
    {
     "file": "tests/test_deep_equal_enumerable.js",
     "present": true,
     "listed": true,
     "result": "not run"
    }
   ],
   "closed": false
  },
  {
   "id": "ir-object-flag",
   "inTree": false,
   "fixes": [
    {
     "commit": "57a1e22",
     "inTree": false
    }
   ],
   "tests": [
    {
     "file": "tests/test_ir_object_flag.mjs",
     "present": true,
     "listed": true,
     "result": "not run"
    }
   ],
   "closed": false
  },
  {
   "id": "property-names-length",
   "inTree": false,
   "fixes": [
    {
     "commit": "05ab41e",
     "inTree": false
    }
   ],
   "tests": [
    {
     "file": "tests/test_code_point_pairs.js",
     "present": true,
     "listed": true,
     "result": "not run"
    }
   ],
   "closed": false
  },
  {
   "id": "closure-equality",
   "inTree": false,
   "fixes": [
    {
     "commit": "96849ae",
     "inTree": false
    }
   ],
   "tests": [
    {
     "file": "tests/test_closure_equality.js",
     "present": true,
     "listed": true,
     "result": "not run"
    }
   ],
   "closed": false
  },
  {
   "id": "ref-pointer-base",
   "inTree": false,
   "fixes": [
    {
     "commit": "b42396e",
     "inTree": false
    },
    {
     "commit": "7ab4de4",
     "inTree": false
    }
   ],
   "tests": [
    {
     "file": "tests/test_registered_ref_resolution.js",
     "present": true,
     "listed": true,
     "result": "not run"
    },
    {
     "file": "tests/test_ir_registered_docs.mjs",
     "present": true,
     "listed": true,
     "result": "not run"
    }
   ],
   "closed": false
  },
  {
   "id": "ir-draft7-root-ref",
   "inTree": false,
   "fixes": [
    {
     "commit": "6cc0b8d",
     "inTree": false
    }
   ],
   "tests": [
    {
     "file": "tests/test_ir_registered_docs.mjs",
     "present": true,
     "listed": true,
     "result": "not run"
    }
   ],
   "closed": false
  },
  {
   "id": "ir-unreachable-defaults",
   "inTree": false,
   "fixes": [
    {
     "commit": "86f4a91",
     "inTree": false
    }
   ],
   "tests": [
    {
     "file": "tests/test_ir_registered_docs.mjs",
     "present": true,
     "listed": true,
     "result": "not run"
    }
   ],
   "closed": false
  },
  {
   "id": "native-count-bounds",
   "inTree": false,
   "fixes": [
    {
     "commit": "d76b4a9",
     "inTree": false
    }
   ],
   "tests": [
    {
     "file": "tests/test_buffer_gate.js",
     "present": true,
     "listed": true,
     "result": "not run"
    },
    {
     "file": "tests/test_code_point_pairs.js",
     "present": true,
     "listed": true,
     "result": "not run"
    }
   ],
   "closed": false
  },
  {
   "id": "small-engine-negative-max",
   "inTree": false,
   "fixes": [
    {
     "commit": "8f77b65",
     "inTree": false
    }
   ],
   "tests": [
    {
     "file": "tests/test_code_point_pairs.js",
     "present": true,
     "listed": true,
     "result": "not run"
    }
   ],
   "closed": false
  },
  {
   "id": "buffer-preprocess",
   "inTree": false,
   "fixes": [
    {
     "commit": "641f9e2",
     "inTree": false
    },
    {
     "commit": "e114137",
     "inTree": false
    }
   ],
   "tests": [
    {
     "file": "tests/test_buffer_gate.js",
     "present": true,
     "listed": true,
     "result": "not run"
    },
    {
     "file": "tests/test_buffer_defaults_static.js",
     "present": true,
     "listed": true,
     "result": "not run"
    }
   ],
   "closed": false
  },
  {
   "id": "native-repeated-names",
   "inTree": false,
   "fixes": [
    {
     "commit": "56c03df",
     "inTree": false
    },
    {
     "commit": "dbc0434",
     "inTree": false
    },
    {
     "commit": "55e89a0",
     "inTree": false
    },
    {
     "commit": "b11c120",
     "inTree": false
    }
   ],
   "tests": [
    {
     "file": "tests/test_native_duplicate_names.js",
     "present": true,
     "listed": true,
     "result": "not run"
    }
   ],
   "closed": false
  },
  {
   "id": "cache-key-unfaithful",
   "inTree": false,
   "fixes": [
    {
     "commit": "65332c5",
     "inTree": false
    },
    {
     "commit": "a587dbf",
     "inTree": false
    }
   ],
   "tests": [
    {
     "file": "tests/test_compile_cache_unfaithful.js",
     "present": true,
     "listed": true,
     "result": "not run"
    }
   ],
   "closed": false
  },
  {
   "id": "from-standalone-defaults",
   "inTree": false,
   "fixes": [
    {
     "commit": "96e6647",
     "inTree": false
    }
   ],
   "tests": [
    {
     "file": "tests/test_from_standalone_defaults.js",
     "present": true,
     "listed": true,
     "result": "not run"
    }
   ],
   "closed": false
  },
  {
   "id": "keyword-named-names",
   "inTree": false,
   "fixes": [
    {
     "commit": "2791680",
     "inTree": false
    }
   ],
   "tests": [
    {
     "file": "tests/test_keyword_named_names.js",
     "present": true,
     "listed": true,
     "result": "not run"
    }
   ],
   "closed": false
  }
 ]
}
-->
