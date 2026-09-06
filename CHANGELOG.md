# Changelog

All notable changes to ata-validator are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/), and this project adheres to semantic versioning.

## 1.13.1 - 2026-09-06

### Fixed

- The native engine stops printing to stderr for patterns outside RE2's subset. A pattern with lookahead or a backreference is an expected input, not a fault: construction is probed, and the JavaScript engines answer for the pattern instead. RE2 logged every such probe to stderr anyway, so a schema carrying zod's email pattern printed two C++ error lines on compile while validating correctly. RE2 is now constructed with logging off; verdicts are unchanged.

## 1.13.0 - 2026-09-06

### Changed

- The default browser bundle stops carrying the AOT emitters. `lib/aot.js` has promised a browser stub via the package.json `browser` field since the fs-free build, but the mapping was never actually in the field, so every browser bundle shipped the emitters and the embedded safe-regex engine source they pull in, along with the native walker's routing table that only matters when the native addon loads. Both now map to stubs. Emitting validators in a browser still works, through the new `ata-validator/aot` entry, and the `Validator.bundle*` statics in a browser bundle throw a message that points there; `Validator.loadBundle` keeps working in the default bundle, since loading a bundle somebody already built is a runtime act. Measured with the schema-benchmarks rolldown pipeline: minified and gzipped 73,491 to 64,812 bytes, 11.8 percent smaller. The browser-imports guard now bans a token from each excluded file so the mapping cannot regress silently.

### Added

- `ata-validator/aot`: the standalone emitters (`toStandalone`, `toStandaloneModule`, `bundle`, `bundleStandalone`, `bundleCompact`, `loadBundle`) as an explicit, typed import. In Node it is the same module the statics use; in a browser it is the way to opt back into emission without paying for it on pages that never emit.

## 1.12.1 - 2026-09-06

### Fixed

- One format violation reports one error. The error path turns each failing statement of a format check into an error push, and it kept going after pushing, so a single bad value collected one identical error per statement it failed: twelve for `date-time` on a short string, five for `time`, two for `uuid` and `hostname`. The check now leaves the format block on the first failure. Verdicts are unchanged; only the duplicate copies of the same error are gone. `tests/test_format_single_error.js` holds every built-in format to exactly one error across 25 invalid values.

## 1.12.0 - 2026-09-06

### Performance

- `date-time` stopped asking every character where it sits. The scan tested each of nineteen positions against the separator indices before checking the digit; the separators are now read directly by index and each digit becomes its value in the same read that validates it, so the field numbers cost nothing extra. 40.8 to 19.5 ns on a valid value, medians across separate processes. Same answers as before on every month, day and clock boundary and under 150k random mutations.

- `uuid` reads the four hyphens by index and the 32 hex digits in five runs with fixed bounds, instead of a case-insensitive regular expression. A digit is one unsigned compare and a letter one more after folding case with a single OR. 48.4 to 35.1 ns; 300k mutated and random strings against the old expression with 0 mismatches.

- `time` reads fixed positions the same way instead of running a regular expression: 15.6 to 12.1 ns, and 200k mutations against the old pattern with 0 mismatches.

- `uri` reads the scheme from the front and scans the rest once instead of running two regular expressions: 39.3 to 32.8 ns, interleaved medians. The remaining scan then became two tiers, because the measured answer was not the expected one: a hand-written character loop beat the old `\s` expression in isolation but lost to the engine's scanner inside a compiled validator, since `\s` is what forced the Unicode machinery in. The first tier asks whether anything sits outside printable ASCII, a one-byte class the engine scans at its own speed and no ordinary URI ever trips; only a string that trips it pays for the loop that knows the exact reserved set. On a nested schema carrying six URLs, 215.5 to 189.4 ns per document, medians across separate processes. `uri-reference` shares the same scan. Fuzzed over every code point in the BMP in three positions, 0 mismatches.

- The Standard Schema bridge stopped paying for enrichment it throws away. An issue carries a message and a path and nothing else, but `~standard.validate` read the rich error list, which builds suggestions, ranks and source frames per error. It now takes the raw, schema-ordered list through the same build the rich path uses, and `parsePointerPath` walks the pointer in one pass instead of split, filter, map and a regex per segment. A 16-error rejection went from 17.6 to 4.3 microseconds; messages and order are unchanged, and `tests/test_standard_schema.js` holds issues to exact parity with `validate().errors`. Schemas using `errorMessage` keep their custom messages.

### Fixed

- The compiled engine refused a lowercase zone letter in `time` that the interpreter accepted: `00:00:00z` answered differently depending on which engine ran the schema, and `date-time` took either case in both. One implementation now answers for every engine, and it takes both cases, per RFC 3339.

- The ReDoS integration test measured the first call, which includes compiling the schema and the pattern, against a 50 ms budget. On a loaded CI machine that reads as a failure without anything being wrong: the gate exists to separate linear matching from catastrophic backtracking, which differ by minutes, not by milliseconds. It now warms up first and allows 500 ms.

## 1.11.0 - 2026-08-31

### Fixed

- The verdict methods answer the same question as `validate()` again. With `coerceTypes`, `removeAdditional` or a schema `default` in play, `validate()` ran the preprocess pass and `isValidObject()`, `isValidJSON()` and `validateJSON()` did not, so the same validator answered `true` from one and `false` from another for the same document: `validate({ age: '26' })` accepted where `isValidObject({ age: '26' })` rejected. Every path now runs the same pass. Verdict methods on a validator configured this way rewrite the input in place, as `validate()` already did, and the cost of the correction is 0.5 ns on `isValidObject` and 2.7 ns on `isValidJSON`, measured interleaved; validators without those options are unchanged. `tests/test_verdict_preprocess.js` holds all four methods to the same answers.

- The native engine's error codes no longer reach callers untranslated. A type failure answered by the addon came back as `code: 3` with no `keyword` and a `docUrl` pointing at a page that does not exist, while the same failure from the JavaScript engines came back as `ATA1001`; both now report the documented code, keyword and link. `tests/test_native_error_codes.js` holds the table against the enum in `include/ata.h`, so the two cannot drift apart silently.
- The error generator declined self-referencing schemas by emitting nothing for the reference, which accepted whatever that reference guarded: `{ properties: { foo: { $ref: "#" } }, additionalProperties: false }` accepted `{ foo: { bar: false } }` on that path. It now declines the schema outright and the validator falls back to an engine that answers it correctly. The entry-point agreement test covers the shape.

- `ipv6` gave two different answers depending on which engine ran it, and neither was right. The compiled path refused an IPv4-mapped address such as `::ffff:192.168.1.1`, the interpreted path accepted `::ffff:1.2.3.4.5`, and both accepted a group of five hex digits like `12345::1`. One implementation now answers for every engine, following RFC 4291, checked against Node's own `net.isIPv6` and the suite's corpus.

- `date-time` refuses dates that do not exist. The check ran a regular expression for the shape and then handed the string to `Date.parse`, which rolls an out-of-range day into the next month, so `2026-02-30T00:00:00Z`, `2026-02-29T00:00:00Z` and `2026-12-31T24:00:00Z` were all accepted. The month, the day count for that month in that year, the clock and the offset are now checked directly, per RFC 3339. Schemas that relied on the old leniency will see those values rejected.

- Data that points back at itself no longer exhausts the stack. A document with a cycle, which JSON text cannot express but an in-memory object graph can, threw `RangeError: Maximum call stack size exceeded` on the compiled path while the interpreted engine settled on an answer, so the two engines disagreed. Both now follow the same rule: a value already being checked against a schema is a fixed point and counts as satisfied, and a cycle no longer hides a real violation elsewhere in the document. Validation runs a fast pass that only counts depth and a guarded pass that runs when that depth is exceeded, so ordinary documents pay one integer operation per recursive call. Measured interleaved on a self-referencing schema: a four-node document 22.2 to 30.6 ns, a 200-node document 2077 to 1178 ns, non-recursive schemas unchanged at 3.8 ns. `tests/test_cyclic_input.js` holds all three engines to the same answers.

### Performance

- `ipv6` and `hostname` read the string once as well: 54.7 to 29.6 ns and 45.5 to 28.2 ns, interleaved medians. `ipv6` no longer allocates two arrays per check; `hostname` keeps the answers of the expression it replaces, fuzzed over 300k strings with 0 mismatches.

- `date-time` reads the string once, with no regular expression, no date object and no allocation: 95.0 to 39.4 ns on a valid value with a `Z`, 103.8 to 45.3 ns with a numeric offset, interleaved medians. Fuzzed against a reference that spells out RFC 3339, with 0 mismatches over 300k strings; `tests/test_formats_single_pass.js` keeps both the predicate and the generated form on it.

- A constructed Validator is roughly three times smaller on the heap until it is used. The public methods and the Standard Schema entry moved from per-instance closures built in the constructor to memoized prototype accessors, and the JSON position cache is only allocated when the JSON text path first needs it. Measured per instance on a 10-key object schema, double-gc deltas over 2000 instances: 1.61 KB to 0.43 KB with a shared schema object, 2.33 KB to 1.12 KB when each instance owns its schema, 3.93 KB to 3.30 KB once compiled and used. Construction alone went from 1504 to 855 ns; construction plus first validate pays about 0.9 microseconds more, once, because the compile step's method assignments now go through a defining setter. The hot validate() path is unchanged, measured interleaved. Detached method references (`const f = v.validate`) still work; `tests/test_lazy_instance.js` pins the shape.

## 1.10.0 - 2026-08-30

### Performance

- The code generator takes shapes it used to decline for no correctness reason: boolean subschemas in `items`, `properties`, `patternProperties`, `dependentSchemas`, `propertyNames`, `allOf`, `anyOf`, `not`, `contains` and `if`/`then`/`else`, recursive `#/$defs/` references as named functions, and `additionalProperties` as a schema alongside composition or `patternProperties`. Each lands in all three generators and the closure path, held to the interpreter by `tests/test_codegen_edge_shapes.js` and the entry-point agreement test over the whole official suite. Every suite group that moved off the interpreter got faster, 31 of 31 on draft 2020-12 and 28 of 28 on draft 7, summed per-group time down 70 percent. The suite-wide figure, measured interleaved against the previous release in one process, did not move outside that measurement's noise; `benchmark/verdict-bench.md` has the numbers and says why.
- `date` and `ipv4` format checks read the string once with no regular expression and no allocation: 45.7 to 14.2 ns and 54.5 to 27.1 ns on a valid value, interleaved medians. Fuzzed against the previous forms with 0 mismatches; `tests/test_formats_single_pass.js` keeps it that way.

### Fixed

- A key matched only by the second of two `patternProperties` entries, alongside `additionalProperties: false`, was rejected: the generated key loop returned at the first pattern that missed. Found while rewriting that loop; covered by the edge-shape test.
- A declared property that also matched a `patternProperties` entry skipped the pattern's schema in the generated code when `additionalProperties` was a schema. The suite's own interaction case caught it the moment the shape was allowed to compile.

## 1.9.0 - 2026-08-28

### Errors

- Rendered diagnostics now say where the problem is. Every `renderPretty` and `renderCompact` block carries the JSON path, and a source frame with a caret on the failing token when one can be built faithfully: from the text on the `validateJSON` path, or from the object when the renderer is handed `{ data }`. Object-input frames are reconstructed by re-serializing the value and the output says so once, because the line numbers refer to that reconstruction. No frame is reconstructed under `coerceTypes`, `removeAdditional` or a schema with `default` values, since the object in hand is not what the caller sent; the output names the option instead.
- Headlines state the observation rather than the rule: `expected integer, found string` in place of `must be integer`. Two `additionalProperties` violations no longer render as identical blocks; the property name is in the headline. A composition failure with a `const` discriminator names it, `no variant matches kind "circle"`, anchors inside the closest branch, and its branch notes read `minimum: expected ≥0, found -1`.
- A property typed `nmae` where `name` was required renders as one diagnostic with `did you mean "name"?` instead of two. The correlation requires that no other missing or extra key in the same object is equally close; on a tie nothing is merged. Both errors stay in the array and point at each other through the new `related` field, and the footer reads `8 schema violations in input, shown as 7 diagnostics` so the count never drifts from `errors.length`.
- Diagnostics are ordered by document position, with cause before effect only as a tie-break within one container. Carets are clamped to the line they sit under; a root-level error used to draw one the width of the whole document.
- Under `richErrors` (the default) errors gain `detail`, `related`, `anchor` and `rank`. Existing fields, array order and array length are unchanged; `richErrors: false` still returns the v0.14 shape. `useDefaults`, on by default, is now documented.
- Measured on a ten-case corpus scored on four questions per diagnostic (says where, states what was found, distinguishable from its neighbours, offers a way forward): 3 of 60 before, 58 of 58 after, and `tests/test_diagnostics_score.js` holds the floor at 95%. Cost on the reject path when `.errors` is read, master against this change on the same machine: a one-error document 330 to 395 ns, a seven-error document with a typo pair 2.45 to 2.95 µs. `validate().valid` is unchanged at 5 ns. Fastify's own suite through fastify-ata stays at 178 of 184.

## 1.8.2 - 2026-08-28

### Fixed

- A `pattern` of the form `^[class]+$`, `^[class]{m,n}$` or `^[class]{n}$` with n above 16 could be violated without `validate()` saying so. The boolean program compiles those patterns to an inline character loop wrapped in an arrow function, and the rewrite that turns the boolean program into the error-reporting one replaced the `return false` and `return true` inside that arrow with `return E(d)` and `return R`. Both are objects, so the arrow started returning a truthy value on mismatch, the enclosing `!(cond && obj)` went false, and the error program accepted what the boolean program had rejected.

  What that looked like from outside depended on the path. Without preprocessing, `validate()` still rejected, because the boolean verdict runs first, but the error it produced was a generic `schema validation failed` with no keyword, no `params.pattern` and no path. With preprocessing, which means any schema carrying a `default` or a validator built with `coerceTypes` or `removeAdditional`, the error program is installed as `validate()` directly and the result was `valid: true`. `Validator.bundleStandalone` and `bundleCompact` embed the same program and had the same silent accept. `ata compile` output is built from the boolean program and was not affected. The rewrite has been wrong since 0.6.0; the official suite never exercised these pattern shapes, so nothing caught it.

  The rewrite now leaves the body of an arrow function alone, the same way it already left `function` bodies alone. `tests/test_hybrid_agreement.js` compares the rewritten program with the boolean it came from on every affected shape, at the root, in a property, in array items, through `bundleStandalone` and through a compiled module, and checks the two preprocessing cases directly. `tests/test_codegen_entrypoint_agreement.js` now compares the rewritten program as a fifth participant across the whole official suite. `tests/test_ajv_errors.js`, which had been failing on exactly this for as long as the bug existed, is now part of `npm test`.

### Changed

- Ranking an error into schema declaration order no longer re-derives the rank on every error of every failing document. It was splitting the schema path with two regular expressions per segment and then scanning `Object.keys(node)` at each level, which was 8.5% of the error path in a profile, for an answer that depends only on the schema and the path. The rank is now cached per path under its root, each node's keys are indexed once, and escape handling is skipped for segments with no tilde. That function drops from 8.5% to 1.4% of the error path, and the error path as a whole gets 3.5% faster, median of eleven interleaved runs. `docs/performance-notes.md` records the larger gap this was measured against; it is not closed by this change.

## 1.8.1 - 2026-08-27

### Changed

- Constructing a validator no longer clones and serializes every schema to find out whether it needed normalizing. It did that on the root and on each registered schema: serialize, deep clone, normalize the clone, serialize again, compare. For a schema with no `nullable` field and no draft-07 keyword the answer is always no, and the work was thrown away. Every question the normalizers ask is whether some key appears anywhere in the tree, so one walk answers all of them, and the clone now happens only for schemas that need it. No registry and ten fields goes from 18.5 to 4.6 µs; fifty registered schemas of fifty fields, which is a small server's worth, from 2570 to 260 µs.

  The walk descends through every object-valued key rather than the subschema keywords the normalizers recurse through, so it is a superset of what they visit: it can report work where there is none, costing one clone, and cannot miss work there is. Across the 2344 schemas in the official suite it reports work on 335 where normalization changes 334. `tests/test_schema_scan.js` asserts that direction over the whole suite, and asserts the check is load-bearing by breaking the scan deliberately and confirming the broken one is caught.

  The answer is remembered against the schema object, the way whole compiled validators already are, and so is the schema map built from a registry. Both were being redone once per validator, so a server building one validator per route over a shared registry paid for that registry once per route. Fifty routes over twenty shared schemas boots in 0.046 ms rather than 20.66 ms. Validators share the map, and anything that writes to one, which is `addSchema()` and the meta-schema registration during compilation, takes a private copy first.

  Nothing about what any schema validates to changes. The comparison that decided the old answer is still there behind the walk, so a schema the walk sends down the slow path gets exactly the result it got before.

## 1.8.0 - 2026-08-27

### Added

- `$vocabulary` is honoured when a schema names a custom meta-schema in `$schema`. A dialect is a set of vocabularies and a vocabulary is a set of keywords, so a keyword whose vocabulary the meta-schema does not declare is not part of that dialect at all: it is an unknown keyword, and an unknown keyword is ignored. A schema written against a meta-schema which declares only the core and applicator vocabularies now has its `minimum`, `type` and the rest of the validation keywords ignored, while `properties` and the other applicators still apply. The keywords belonging to each vocabulary are read from the vendored meta-schemas rather than from a list kept by hand, so they come from the specification. Removing the keyword before compilation means every engine agrees without any of them knowing what a vocabulary is.

  This closes the last case ata missed. Draft 2020-12 goes from 1298 to **1299 of 1299**, with draft 7 at 927 of 927 and the v1 dialect at 1133 of 1133, the same with code generation blocked. `tests/run_suite.js` has no known failures left.

  Two things it does not do. It does not refuse a schema whose meta-schema requires, with `true`, a vocabulary ata does not recognise; the specification says an implementation must refuse there, and turning what has always been silently accepted into a hard failure is a separate decision, so such a schema is evaluated as before with every keyword applied. And a separate document reached through `$ref` keeps its own keywords rather than inheriting the referring dialect, so a document which should follow one needs to say so with its own `$schema`.

### Fixed

- `bundleStandalone` and `bundleCompact` built the error-reporting function from the schema the caller passed rather than the one the validator compiled. Anything which prepares a schema therefore reached the boolean path and not the error path: with `assertFormat: false` the bundle reported a `format` error the caller had turned off, and only once some other keyword failed first, since the error function runs only after the boolean one says no. `toStandalone` already read the compiled schema; these two now do as well.

## 1.7.4 - 2026-08-26

### Fixed

- `validate()` read past the end of the document the caller handed it. simdjson wants padding after a document so its SIMD loads can run off the end, and the library was claiming that padding on buffers it does not own, on the grounds that a buffer not ending near a page boundary has readable bytes after it. That does not fault, which is why it went unnoticed, but the bytes belong to somebody else: under AddressSanitizer it reports as a heap-buffer-overflow inside simdjson, so anyone fuzzing or sanitizing an application built on ata saw a memory error with no way to tell it was deliberate. Through the Node binding the read landed in V8's heap. The document is now copied into a padded buffer, reused per thread, before it is parsed. The buffer APIs already did this and were never affected. Found by the fuzz targets in `fuzz/`, which were in the repository but had never been run; all three now survive millions of executions clean.

### Changed

- Rejecting a document through the buffer APIs no longer costs more than accepting one. The On-Demand plan answers first, and a `false` from it used to be ambiguous: it could mean the document failed a constraint, or that the plan could not decide. The caller had to assume the second, so it re-created the padded view, parsed the whole document again into a DOM, tried the generated plan, and then walked the tree. A rejected document was therefore parsed twice and walked up to three times. The plan now reports whether it stopped because the document failed a constraint or because it could not be read, and only the second falls through. simdjson's `INCORRECT_TYPE` is a constraint failure rather than a read failure, which is the distinction that makes this work: a property holding a string where the schema wants an integer surfaces as a read error from `get<int64>`, not as a type mismatch. On a 62 KB array of a thousand objects with one bad element: 316 µs to 11 µs when the bad element is first, 315 µs to 40 µs when it is last. On that shape rejecting is no longer dearer than accepting, and when the bad element is early it is several times cheaper. It is still dearer on a small document, where there is no bulk of parsing for an early exit to save: on a two-field object, 129 ns to accept and 278 ns to reject. `tests/test_buffer_path_parity.js` holds the buffer path to the same answers as `validate()` across all 3359 suite cases, and still reports zero disagreements.

## 1.7.3 - 2026-08-26

### Added

- A prebuilt native engine for Intel macOS again, `@ata-validator/native-darwin-x64`. The target was dropped in 0.13.4 because GitHub's x64 macOS runners had stopped being reliably available; `macos-15-intel` brought them back, so the matrix is now seven targets: darwin arm64 and x64, linux x64 and arm64 on both glibc and musl, and win32 x64. Intel Macs went to the pure-JS engine in the meantime, which validates identically but leaves the buffer APIs unavailable, so this only changes speed and reach, not answers.

## 1.7.2 - 2026-08-24

### Fixed

- `enum` compared object members by their serialized form, so `{"b": 2, "a": 1}` was rejected against `enum: [{"a": 1, "b": 2}]`. JSON Schema compares instances by value: two objects with the same members are equal whatever order their keys were written in. All three code generation paths did this, so they agreed with each other and disagreed with the interpreted engine, which has always compared structurally. `const` was already correct but reached the answer by building a canonical string on every call. Both now use one structural comparison hoisted per compiled function. The official suite does not cover reordered keys for `enum`, and the entry-point agreement test compares the generators against each other, so neither would have caught this; `tests/test_value_equality.js` pins the answer through every engine that can produce one and runs as part of `npm test`.
- A draft-07 document passed through the `schemas` option was rejected with "Schema in schemas option must have $id" whenever it carried `$ref` next to `$id`. Draft-07 ignores every keyword sitting beside `$ref`, so normalization drops them and `$id` goes with them, which is the right reading for evaluation: the reference resolves against the URI the document was retrieved from, not the `$id` it declares. It is the wrong reading for registration, where `$id` is the only name the caller gave the document. The identity is now read from what the caller passed when normalization has dropped it, so such a document registers under its `$id` in the array form and is addressable by both its retrieval URI and its `$id` in the map form. A document that declares no `$id` at all is still refused, and a fragment-only `$id` is still an anchor rather than a document name. This is what made all 23 remote-reference cases of the draft-07 suite error out in the Bowtie compliance report; they now answer, and answer correctly.

### Changed

- The closure-tree compiler now covers every schema the interpreted engine accepts. It previously declined `unevaluatedProperties`/`unevaluatedItems` and `$dynamicRef` in any schema with more than one resource, which left 192 of the 987 suite schemas walking the generic evaluator; that count is now zero. Annotations flow through the compiled tree: the compiler decides at compile time which nodes anyone reads annotations from, and those nodes carry a record that in-place children write into directly, with a failed child rolled back by truncating the record rather than by allocating a fresh one per child. `$dynamicRef` resolves against the dynamic scope computed at compile time, so multi-resource schemas no longer search it per call. A schema whose compiled graph has no cycle drops the recursion guard and the `(schema, data)` stack entirely. An unresolvable `$ref` compiles into the same runtime rejection the evaluator produces instead of declining the schema.
- Measured on the official suite with prebuilt validators, several runs each on the same machine: draft 2020-12 went from 94 ns to 77-80 ns per case overall, and the cases that route to the interpreted engine from about 240 ns to about 125 ns when they accept and 235 ns to 160 ns when they reject. Draft 7 went from 59 ns to 49 ns overall. The metaschema-validation case, the worst outlier in the suite, went from 5.5 µs to about 1.4 µs. On a longer steady-state loop over the same suite, where construction is not part of what is timed, draft 2020-12 went from 46 ns to 43 ns per case and draft 7 from 33 ns to 29 ns.
- The value-level keywords of a schema node are compiled into closures over their own operands instead of being answered by a generic evaluator that re-reads a dozen presence flags off the plan on every call. The type of the value is computed once per node rather than once per keyword group, and a node whose keywords never need it does not compute it at all.
- `uniqueItems` on arrays whose item type is not known ahead of time no longer builds a canonicalizing closure and a `Set` on every call. The helpers are hoisted once per compiled function; arrays of twelve items or fewer compare pairwise with a structural equality that ignores key order and allocates nothing, and longer arrays keep the `Set`, using canonical strings only once an object actually appears. Over the draft 7 suite the `uniqueItems` cases went from 125 ns to 24 ns each.
- `ARCHITECTURE.md` documents the interpreted engine and the closure-tree compiler, and no longer claims `$dynamicRef` falls back to the native engine, which stopped being true in 1.7.1.

## 1.7.1 - 2026-08-23

### Added

- A closure-tree compiler for the interpreted engine. A schema the code generator declines is compiled into a tree of plain closures, one per schema node, with every keyword branch decided at compile time and `$ref` targets resolved once; no source generation and no `new Function`, so it works under a CSP and on Workers. Scope: schemas without `unevaluatedProperties`/`unevaluatedItems`, and `$dynamicRef` only in single-resource schemas; everything else keeps the generic evaluator. `tests/test_plan_compiler.js` holds the compiled tree to byte-identical verdicts and errors against the evaluator over 2,864 suite cases.

### Changed

- Plans that check only value-level keywords (most leaves of any schema) skip the evaluator's prologue entirely; `$ref` resolutions are cached with their planned target on the plan itself; the dynamic scope is pushed and popped in place instead of copied per resource. Rejection results are a small class with the `errors` accessor on the prototype, since defining a getter inside an object literal builds a closure and an accessor property on every rejection, which was the single largest cost on the rejection path.
- The interpreted engine gained a verdict-only mode: `isValidObject()` and the internal fast checks walk the schema without constructing a single error object, message string or scratch array. On an interpreter-routed schema the boolean check dropped from 894 ns to 70 ns.
- Object validation for `$dynamicRef` schemas no longer routes to the native engine. The interpreted engine has scored the same on every `$dynamicRef` case of the suite since the dynamic-scope fix in 1.7.0, needs no addon, and carries the verdict-only mode; the suite's `$dynamicRef` rejects dropped from about 1.7 µs to the interpreter's cost.
- String length bounds decide from the UTF-16 length where possible: a string's code point count always sits between half its length and its length, so `minLength`/`maxLength` only count code points inside the narrow band where the answer is genuinely uncertain. The surrogate test is a single wraparound compare. The code generator already worked this way; the interpreter and the closure path now match it.
- Errors are paid for when read, not when produced. `validate()` answers the verdict from the fastest engine for the schema and materializes `errors` through a cached getter on first access; declaration-order sorting and enrichment (received value, suggestions, source frames) moved with it into one presentation layer. A caller that only reads `.valid`, which is every gateway check, no longer pays for error construction at all. The output of `.errors` is byte-for-byte what it was. Measured on a suite-shaped benchmark of prebuilt validators over 1,052 mixed valid and invalid cases, `validate().valid` went from 778 ns to about 150 ns per call, ahead of every error-capable validator we measured, and a rejection that never has its errors read now costs less than `abortEarly` mode used to. One observable edge: mutating the data between `validate()` and the first read of `.errors` now reflects the mutated data in the errors, and if the mutation makes the data valid the errors fall back to a single generic entry.

## 1.7.0 - 2026-08-23

### Fixed

- The four code generation entry points disagreed with each other on 157 instances of the official suite. Most of it was the closure compiler, the boolean fallback behind `isValidObject()` when the code generator declines a schema: it ignored `unevaluatedProperties` and `unevaluatedItems` outright, treated a self-referencing `$ref: "#"` as always true, skipped `additionalProperties` whenever no `properties` map sat next to it, and passed strings in `date-time`, `time`, `uri` and `duration` format without checking them. Each of those accepted input it should have rejected. It now declines those schemas, so they reach an engine that handles them. The remaining disagreements were wrong rejections shared by both boolean paths: `required`, `minProperties` and `maxProperties` applied to non-objects, `multipleOf` had no tolerance for fractional divisors, `const` and `enum` compared objects by key order, and `items` started at index 0 when `prefixItems` was present. `isValidObject()` and `validate()` now agree on every suite instance.
- A `dependentSchemas` branch carrying `additionalProperties: false` had that check hoisted out of its condition to the top level of the compiled function, so the restriction applied whether or not the triggering property was present.
- The error path counted a property matched by `patternProperties` as additional under `additionalProperties: false`. The same path now reports the real pointer (`#/patternProperties/<pattern>/...`) for a failing pattern subschema instead of the synthetic `#/patternProperties`, so source frames resolve for those errors.
- The buffer APIs (`isValid`, `isValidJSON` above the simdjson threshold, `countValid`, `batchIsValid`, `isValidNDJSON`, `isValidParallel`, `isValidPrepadded`) disagreed with `validate()` on 245 of 2222 suite cases, and in 195 of those they accepted a document `validate()` rejects. The native walker behind them does not handle `contains`, `unevaluated*`, `dependencies`, `dependentSchemas`, `dependentRequired`, `propertyNames`, `patternProperties`, tuple-form `items` and `prefixItems`, cross-document `$ref`, embedded `$id`, an empty `enum`, a boolean root schema, Unicode property escapes in `pattern`, or the `hostname`, `date-time`, `time`, `uri-reference` and `duration` formats. For a schema using any of those, every buffer API now parses the bytes and answers through `validate()`; `lib/buffer-gate.js` holds the list. Schemas without them keep the zero-copy path. `tests/test_buffer_path_parity.js` now compares all three dialects, 3359 cases, and holds the disagreement count at zero.
- A value failing a `patternProperties` subschema was reported at runtime as a generic "value invalid for key" error on the parent object with the synthetic pointer `#/patternProperties`. The subschema is now generated in place, so the error comes from its own keyword, at the key's path (`/x-flag`), with the real pointer (`#/patternProperties/^x-/type`), and source frames resolve for it. Patterns containing `/` or `'` produce a correctly escaped pointer.
- `tests/test_codegen_entrypoint_agreement.js` drives the whole suite through each entry point directly and fails on any split verdict. It runs as part of `npm test`.

### Added

- A `$ref` to a dialect's meta-schema (`https://json-schema.org/draft/2020-12/schema`, `http://json-schema.org/draft-07/schema#`, any http/https or trailing-`#` spelling) resolves from copies vendored in `lib/metaschemas.js`, so "validate this schema against its dialect" works with no registry and no network. A copy supplied through `schemas` or `addSchema()` still wins. The 2020-12 meta-schema is eight documents joined by `$dynamicRef`; see the routing change below.

- `validator.engine()` reports which engine answers `validate()` for the schema: `'codegen'`, `'closure'`, `'native'` or `'interpreter'`. A diagnostic for startup logs and benchmarks. Measured over fourteen request-shaped schemas (body, params, query, shared `$ref`, `oneOf`, `if`/`then`, local `$defs`), thirteen take the generated path; `patternProperties` with `additionalProperties: false` is the one that goes to the interpreter.
- `formatMode: 'inject'` for `toStandaloneModule`, `bundleStandalone`, `bundleCompact` and `build()`. The output carries no custom format source; it exports `setFormats(map)` and looks each format up from that registry at validation time, with a named error if one is missing. This is for formats that cannot be serialized: functions that close over variables, bound functions, or code rewritten by coverage and transpile steps. The default `'embed'` is unchanged in behavior, but it now checks each function's source at build time and throws with the format's name when it would not survive embedding, instead of emitting a module that fails on first use.

### Changed

- Draft-07 is now read by its own rules rather than as 2020-12 with renamed keywords. A schema object carrying `$ref` is that reference and nothing else, so sibling keywords, `$id` included, are ignored, as the draft specifies. A fragment-only `$id` (`"$id": "#name"`) is a plain-name anchor. A document supplied through `schemas` or `addSchema()` that declares no `$schema` of its own is read under the root's draft. JSON Pointers written against array-form `items` still resolve after the keyword is normalized to `prefixItems`. Schemas that declare no `$schema` are unaffected. Draft 7 on the official suite goes from 916 to 927 of 927.
- The code generator now declines, and the interpreted engine answers, whenever a document reachable through a cross-document `$ref` uses `$dynamicRef`, `$dynamicAnchor`, `unevaluatedProperties`, `unevaluatedItems`, or an embedded `$id`. Before, the generator emitted a vacuous check for such a reference and accepted everything behind it: `{ "$ref": "https://json-schema.org/draft/2020-12/schema" }` accepted `{ "type": 1 }`. These checks now live in one function, `sharedCodegenGate`, that every entry point runs first. Draft 2020-12 goes from 1294 to 1298 of 1299 and the v1 dialect from 1131 to 1133 of 1133; the one remaining 2020-12 miss needs `$vocabulary`.
- The interpreted engine extends the dynamic scope whenever evaluation enters a schema resource, not only when it lands on the resource's root. A `$dynamicRef` reached through `first#/$defs/stuff` now sees resource `first` in scope, which closes the last `$dynamicRef` case the interpreter missed. With code generation blocked the figures are the same as with it: 1298 of 1299, 927 of 927, 1133 of 1133.
- The interpreted engine is between 4 and 14 times faster depending on the schema. Each schema node is resolved once into a fixed-shape plan (type bitmask, compiled pattern, looked-up format, one flag per keyword group) and children are linked at plan time, so the walk reads no schema properties and does no map lookups. On a six-field object schema a warm `validate()` went from 3786 ns to 343 ns; a `$ref`-heavy schema from 5354 ns to 366 ns; a recursive `$dynamicRef` tree from 5302 ns to 526 ns. The compiled path is unchanged at about 44 ns on the same schema.
- The linear-time pattern matcher now runs a lazily built DFA over the Thompson NFA, with cached ASCII transitions and a fallback to the NFA walk past 256 states. On typical anchored patterns it is within 1.2 to 3.5 times of V8's backtracking engine (`^[0-9]{5}$` 14 ns against 12 ns, an email pattern 70 ns against 21 ns) while keeping the linear bound: `^(a+)+$` against 100,000 characters takes 1 ms. This matcher backs `pattern`, `patternProperties` and `propertyNames` in every engine and in standalone output, so all of them gain.

## 1.6.2 - 2026-08-19

### Fixed

- The Standard Schema surface carried no output type. `~standard.validate()` returned `{ value: unknown }` and the `types` carrier the specification defines for inference was missing, so every consumer that reads the validated type off `~standard` (Fastify, tRPC, TanStack Form, Drizzle) saw `unknown` and needed a cast. `~standard` is now typed against the validator's own data type, and `types.output` carries it. Type-only: the runtime object is unchanged, and the specification defines `types` as never present at runtime.
- Boolean schemas were rejected by the `Validator` constructor's TypeScript signature. `true` and `false` are schemas anywhere JSON Schema allows one, and both have always worked at runtime; only the types disagreed, which made a schema of unknown shape (`object | boolean`) impossible to pass without a cast. Nested boolean subschemas are still typed as objects, so `{ properties: { a: true } }` needs `defineSchema` or a cast.
- The `t` builder's option bags rejected vendor keywords. `t.object({}, { instanceof: 'Date' })` is what a custom keyword package expects to be given, and the option types only allowed the keywords the builder itself emits, so callers wrote `as never`. Every option bag now accepts unknown keywords alongside the typed ones.
- `tests/test_interop_types.ts` covers all three under `tsc --noEmit`.

## 1.6.1 - 2026-08-09

### Fixed

- A `$ref` into another document whose own root carries a fragment-only `$ref` validated everything. The code generator has three entry points and only one of them, the boolean path, ran the bail that routes a reference it cannot follow to the interpreted engine. The other two emitted no lines for the reference and returned the empty program as always-valid, so every constraint behind it was dropped without an error. `{ "$ref": "other.json" }` against a document holding its constraints under `#/$defs/...` accepted any input at all. Both paths now run the same two bails the boolean path runs. This is the third silent-accept defect in `$ref` resolution after the two fixed in 1.3.0, and it affects Draft 2020-12 as well as the v1 dialect.
- `tests/test_cross_doc_root_ref.js` states the case directly, including a cross-document reference to a target that holds its constraints inline, which must stay on the compiled path so the bail is not widened into "any cross-document reference".

### Changed

- The official test suite moved on five months, from the March snapshot to 6 August. Every published figure is remeasured against it. Draft 2020-12 is 1294 of 1299, draft 7 is 916 of 927, and the v1 dialect is 1131 of 1133. With code generation blocked, Draft 2020-12 is 1295 of 1299 and v1 is 1132 of 1133. One case that the fix above corrects is no longer a known failure under v1.
- The buffer path disagrees with `validate()` on 245 of 2222 suite cases rather than 243 of 2208. The two additional disagreements are new suite cases, not a widening: measured against the March snapshot the number is still exactly 243.

## 1.6.0 - 2026-08-08

### Added

- The JSON Schema v1 dialect. A schema declaring `"$schema": "https://json-schema.org/v1"`, or the dated `https://json-schema.org/v1/2026` the specification repository's meta-schema carries, is now validated under v1 rather than under 2020-12. The difference ata implements is `$dynamicRef`: v1 removes the bookending requirement, so a reference resolves through the dynamic scope whether or not the schema it initially lands on carries a matching `$dynamicAnchor`, and also when it resolves to nothing on its own. The outermost matching anchor still in scope wins, as before. `propertyDependencies`, the other v1 addition, shipped in 1.5.0.
- Against the suite's `v1` directory with nothing excluded, ata scores 1123 of 1127. The four it misses are the same four that fail on 2020-12: one `$dynamicRef` scope corner each engine misses, a definition validated against the meta-schema, and two remote-reference cases. `npm run test:suite` now runs the dialect alongside 2020-12 and draft 7, `tests/test_no_eval.js` runs it with code generation blocked (1124 of 1127 there), and `tests/test_v1_dialect.js` checks the switch itself: the same document must not validate the same way under both dialects.
- Only `$dynamicRef` routing changes. Everything else ata implements is identical under v1 and 2020-12, so a v1 schema that does not use the keyword takes the same compiled path it always did. One that does use it validates on the interpreted engine, since the JS compiler and the native addon both resolve the 2020-12 way. The native engine does not implement bookending at all, which is invisible to the official 2020-12 suite but means it cannot be trusted to answer for either dialect here.

## 1.5.1 - 2026-08-07

### Fixed

- `isValid()` on a buffer disagreed with `validate()` on the parsed value for 294 of 2208 cases in the official suite, in both directions. Two causes: the path returned the code generator's `false` directly, which is ambiguous between "invalid" and "the plan stopped at a composition opcode and the walker should finish", so every schema using `allOf`, `anyOf`, `oneOf` or `$ref` was rejected outright; and it ended in a second, simpler walker that had drifted from the one `validate()` uses. It now calls the same walker with all errors off, so there is one set of semantics rather than two kept in step by hand. The disagreement drops to 243 cases, the rest being the on-demand plan answering before the walker runs, which is engine work rather than a setting.
- `tests/test_buffer_path_parity.js` records that number so it cannot widen, and the README and the edge runtimes guide now state the gap, since `isValid`, `countValid` and `batchIsValid` are shipped APIs and a caller has no way to know otherwise.

### Changed

- `ATA_NO_MIMALLOC` skips the bundled `mimalloc-new-delete.h` include. A toolchain that ships the mimalloc headers along with its own `operator new`/`delete` over the same allocator hits a duplicate symbol at link time; Emscripten with `-sMALLOC=mimalloc` is that case, so the source could not be compiled to WebAssembly at all. The native build does not define it and is unchanged.

## 1.5.0 - 2026-08-05

### Added

- `propertyDependencies`, a JSON Schema v1 [proposal](https://github.com/json-schema-org/json-schema-spec/blob/main/specs/proposals/propertyDependencies.md), selects a subschema by the value of a property rather than by its presence. It replaces the `oneOf` and `if`/`then` patterns normally used to branch on a discriminator field, and reads as `{ "propertyDependencies": { "type": { "customer": { ... }, "employee": { ... } } } }`. The proposal defines the keyword as equivalent to an `if`/`then` on `const`, and `tests/test_property_dependencies.js` checks that equivalence case by case rather than asserting a separate expectation, alongside the proposal's own test files from the official suite: 36 of 38, the two remaining being a `$dynamicRef` scope gap the `if`/`then` form of the same schema hits identically.
- The keyword is implemented in the interpreted engine. Both JS compiler paths decline a schema that uses it rather than emitting nothing for a keyword they do not know, which would make the constraint vacuous.

## 1.4.0 - 2026-08-04

### Fixed

- Where `new Function` is unavailable, validation now runs on the interpreted engine instead of degrading quietly. Cloudflare Workers, Deno Deploy and pages under a strict Content-Security-Policy refuse code generation; the closure-based path does not call `new Function` itself, so it survived the refusal and went on to handle schemas it gets wrong. Against the full suite with code generation blocked, ata scored 1188 of 1290 with 30 schemas failing to build. It now scores 1286 of 1290 with none, which is the same as the compiled path within one case. Draft 7 is 910 of 922. `tests/test_no_eval.js` runs the whole suite with `eval` and `new Function` blocked so this is checked rather than assumed.

## 1.3.0 - 2026-08-02

### Added

- `useDefaults` and `assertFormat` validator options, both defaulting to `true` so existing behavior is unchanged. `useDefaults: false` stops missing properties being filled in from their `default` before validation, which matters because a `default` that does not satisfy its own subschema currently makes an otherwise valid instance fail. `assertFormat: false` treats `format` as an annotation rather than an assertion, the Draft 2020-12 reading when the format-assertion vocabulary is not in use. With both off, ata passes every case in the suite's `format` and `default` files.

### Fixed

- A `$ref` that could not be resolved validated everything instead of failing. The JS compiler emitted no check at all for an unresolved reference, so a typo in a `$ref`, or a reference into a schema that was never registered, silently turned off every constraint behind it rather than reporting an error. Both compiler paths now decline to compile such a schema and it validates on the interpreted engine, which reports `ATA5001` naming the reference it could not resolve.
- References that resolve relative to an enclosing base URI are no longer compiled by the JS paths, which match registry entries by exact key or path suffix and have no notion of a base. Nested `$id` scopes, relative references, and documents registered under a URI different from the `$id` they declare now route to the interpreted engine, which tracks the base properly. Schemas that reference a flat registry of ids, the common `$ref: 'shared#'` shape, still take the compiled fast path.
- A schema supplied through the `schemas` option as a URI-keyed record was registered only under the `$id` it declared, so references to the URI it was registered under could not resolve. It is now addressable by both.
- Official draft 2020-12 remote-reference suite: 30 of 31 cases, up from 21. Pure-JS configuration on the full suite: 1189 of 1190, up from 1188. The native configuration stays at 1190 of 1190.

## 1.2.2 - 2026-07-26

### Fixed

- The `uri` format was too permissive: it only checked for a scheme prefix, so a string like `https: not a url` passed. It now also rejects any whitespace or control character, so values that carry a scheme but are not URIs are caught. Real URIs, including `mailto:` and `urn:` forms and hyphenated hosts, still pass. `uri-reference` now rejects the same characters and accepts the empty string (a valid same-document reference), which the codegen path had wrongly rejected.
- `date-time` now accepts lowercase `t` and `z` separators per RFC 3339, matching the interpreted engine. `duration` now rejects a trailing `T` with no time component (`PT`, `P1DT`), which are not valid ISO 8601 durations.
- These format checks are emitted in two places, the JS compiler and the interpreted engine, and had drifted apart on the cases above. A new differential test (`tests/test_format_engine_parity.js`) runs every built-in format through both engines over a shared corpus and fails on any disagreement, so the two stay in lockstep.

## 1.2.1 - 2026-07-18

### Fixed

- Schemas the JS compiler cannot represent now validate on the engine that gets them right, instead of always preferring the native addon when it is installed. The native resolver mishandles several `$id` base-URI corners (URN bases, absolute-path references, empty JSON-pointer tokens, nested `$id` scopes) and silently skips regex patterns its engine cannot parse; all of these now route to the interpreted engine. Pure dynamic-ref schemas stay on the native path, which tracks `$dynamicRef` scopes more completely. Buffer and parallel APIs are unchanged.
- The JS compiler no longer compiles two shapes it got wrong: `unevaluatedItems` with `contains` in scope (contains-matched items were never credited as evaluated, rejecting valid arrays) and plain-anchor schemas that open nested `$id` scopes (same-named anchors in different base-URI scopes resolved to the wrong target). Both now go to the interpreted engine.
- Official draft 2020-12 suite: 1190 of 1190 applicable cases with the native accelerator (up from 1175), 1188 of 1190 (99.8%) pure-JS (up from 1184). Draft 7 suite gains four `ref.json` cases.

## 1.2.0 - 2026-07-18

### Added

- An interpreted engine (`lib/interpreter.js`) now backs schemas the JS compiler cannot represent when the native addon is absent (browser, edge workers, `ATA_NO_NATIVE=1`). These schemas validated only with the native engine before, and 1.1.0 made them throw a clear error in native-less environments; they now just validate. Full draft 2020-12 semantics: `$id`/`$anchor` resolution, `$dynamicRef` dynamic scoping, annotation tracking for `unevaluatedProperties`/`unevaluatedItems`. The pure-JS configuration now passes 1184 of 1190 applicable cases (99.5%) in the official test suite, up from 974, and the six remaining failures are shared with the native engine. Error results on the native-less path also carry full per-keyword detail now instead of a single generic message.

### Changed

- Validation errors now follow the schema's keyword declaration order instead of a fixed required-first order: a schema declaring `properties` before `required` reports the property errors first, matching what schema authors read top to bottom and what the previous default validator emitted. Order within one keyword is unchanged (`required` errors still follow the array). Single-error and `abortEarly` results are untouched. With this change ata passes every applicable test in Fastify's validation suite (181 of 187; the remaining 6 test the incumbent validator's own extension API rather than validation behavior).

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
