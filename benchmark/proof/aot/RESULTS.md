# Bun ahead-of-time, pull request build, 2026-10-27

bun 1.4.4-canary.1+d0b27e983 (oven-sh/bun#45631, CI artifact of 2026-10-27
05:50, installed with `bunx bun-pr 45631`, 45 commits past the build of
2026-10-25 below), Apple M4 Pro, ata-validator 1.61.1, zod 4.6.7. The same
`bench.ts`, built with `--compile` and `--compile --aot`, three runs each,
the median shown. Nanoseconds per document:

| validator | JIT | AOT | AOT / JIT |
|---|---|---|---|
| ata module from `ata build`, isValid | 24.3 | 32.9 | 1.4x |
| ata module, validate() | 56.4 | 50.2 | 0.9x |
| ata runtime Validator (compiled at start with new Function), isValidObject | 25.1 | 480.9 | 19x |
| ata runtime, validate() | 31.9 | 490.8 | 15x |
| zod 4 safeParse | 210.4 | 483.8 | 2.3x |

With the `"aot"` export condition (unreleased after 1.61.1; 1.61.1 still
looked for `Bun.isAOT`, which this build no longer has), the runtime rows
take the interpreted engine under AOT, three runs, median: isValidObject
78.4 ns, validate() 93.8 ns, against 480.9 and 490.8 above; the JIT build
keeps generated code (26.2 ns).

The picture of 2026-10-25 holds on the newer build and on 1.61.1: the module
written at build time is compiled with the program, 33 ns against 484 for zod
under AOT; code generated at run time is interpreted there. The module's
`validate()` is faster under AOT than on the JIT, 50.2 against 56.4 ns.

# Bun ahead-of-time, pull request build, 2026-10-25

bun 1.4.4-canary.1+947fb6a47 (oven-sh/bun#45631, CI artifact of 2026-10-25
00:11, installed with `bunx bun-pr 45631`), Apple M4 Pro, ata-validator 1.60.0,
zod 4.6.7, hono 4. `bench.ts` built with `--compile` (JIT) and `--compile
--aot`, three runs each, the median of 7 rounds of 300,000 documents per run,
1024 parsed documents, three quarters valid. Nanoseconds per document:

Note, 2026-10-25 afternoon: every `validate<Order>`, `JSON.parse<Order>` and
`Schema` row below was measured on the pull request build named above (the
CI artifact of 00:11 UTC). The pull request's commit of 02:10 UTC the same
day took `validate<T>` from `bun:bundle`, `JSON` from `"bun"`, `Bun.Validator`
and the `Schema` types out, "to come back as a change of their own", and
added an `"aot"` condition for `exports` and `imports` that `bun compile`,
`bun run --aot` and `bun check --aot` read. `ata build --target bun` now
writes the type without the tags and a typed plain `JSON.parse`, with the
module answering every check; the tagged split stays as
`bunTarget.schemaToBunType(schema, { tags: true })`, and
`suite-differential.mjs` and `traffic.ts` still use it, against that build.
The module rows need no typed validator and stand.

| validator | JIT | AOT | AOT / JIT |
|---|---|---|---|
| ata module from `ata build`, isValid | 25.9 | 34.2 | 1.3x |
| ata module, validate() | 59.5 | 60.2 | 1.0x |
| ata runtime Validator (compiled at start with new Function), isValidObject | 25.5 | 538 | 21x |
| ata runtime, validate() | 30.7 | 552 | 18x |
| zod 4 safeParse | 210 | 530 | 2.5x |

Code generated at run time is interpreted under the compiler, so ata's own
run-time path and zod both land at about 530 ns. The module written at build
time is compiled like the program around it: 34 ns, 15 times faster than
either under AOT, and 30% slower than the same module on the JIT, which the
pull request's own numbers for untyped npm code lead one to expect.

HTTP (measure.mjs, Hono, one sequential connection): first response 21 ms
on the JIT build and 8 ms on the AOT build for every route; warm throughput
about 15.5k requests per second on every route including `/none`, so that
table measures the load generator, not the validators.

Build: `--aot` makes TypeScript errors fatal (`r.errors[0].message` is
`string | undefined` in ata's types). ata's runtime draws four "import path
isn't a constant" warnings (name-indirected requires, native-load.js) and one
"regular expression runs in the interpreter"; the module draws none.

## Second run: the interpreted engine and an Object.hasOwn module

Same build, two runs each, ns per document:

| validator | JIT | AOT |
|---|---|---|
| ata module, isValid | 25.2 to 26.5 | 30.9 to 34.9 |
| ata module with `Object.hasOwn` in place of `hasOwnProperty.call` | 25.3 to 27.7 | 29.7 to 30.9 |
| ata runtime, interpreted engine (`engine: 'interpreter'`), isValidObject | 50.8 to 53.2 | 80.0 to 80.6 |
| ata runtime, interpreted engine, validate() | 51.8 to 53.7 | 94.9 to 95.2 |
| ata runtime, generated code, isValidObject | 28.0 to 28.4 | 521 to 539 |

Under the compiler the interpreted engine, plain JavaScript walking a closure
tree, is compiled with the program and runs 6.5 times faster than the
generated code, which is interpreted. On the JIT the generated code is 1.9
times faster than the interpreter. So the right default flips under AOT.
The `Object.hasOwn` change is within the run-to-run spread.

## The error path (bench-errors.ts): a rejected document with its errors read

| validator | JIT | AOT |
|---|---|---|
| ata module, validate().errors | 99 | 118 |
| ata runtime, generated code | 158 | 1282 |
| ata runtime, interpreted engine | 439 | 606 |
| zod 4, safeParse().error.issues | 522 | 1409 |

The module's error path is compiled with the program: 118 ns. The interpreted
engine's error path is slow on the JIT already (439 against the generated
code's 158) and 606 under the compiler.

## A closed program (closed.ts, interpreted engine, isValidObject, ns per document)

| build | engine | ns |
|---|---|---|
| main entry, `--compile --aot` | generated code | 525 |
| main entry, `--compile --aot --disallow-code-generation-from-strings` | interpreter (ata's own switch under the flag) | 75 |
| `ata-validator/lite`, `--compile --aot` | interpreter | 79 |
| `ata-validator/lite`, `--compile --aot --disallow-code-generation-from-strings` | interpreter | 81 |
| main entry, `--compile` (JIT), ATA_ENGINE=interpreter | interpreter | 49 |

With the flag the program counts as closed and ata picks the interpreter by
itself: 75 ns, no option needed. Closedness buys the interpreter a few
percent; the engine choice buys seven times. The interpreter's floor under
the compiler is about 75 ns against 49 on the JIT.

## Shape spike (spike-vm.ts): what the interpreter's cost is made of

The user schema written three ways in one executable, ns per document, two runs:

| shape | JIT | AOT |
|---|---|---|
| closure tree, minimal (the interpreted engine's shape) | 55 to 59 | 39.5 to 43.5 |
| fixed-layout nodes and one switch (a bytecode VM shape) | 51 to 53 | 47 to 48 |
| module from `ata build` | 24 to 26 | 36 to 37 |

A closure tree compiles well ahead of time (faster there than on the JIT),
and a switch VM does not beat it. The interpreted engine's 75 ns is twice
the minimal tree's 41, so the gap is in what the engine does around the
tree, not in the tree.

## Decision on the interpreter under the compiler

Run-to-run spread of the interpreted engine under `--aot` is 76.7 to 78.6 ns.
`--explain` attributes the untyped time to one root cause at a time (93% on
whichever comes first: an `Object.assign` in error-messages.js, then a
closure handed to a caller, then a caught value in the `contains` branch);
rewriting each moved the label and not the number. The engine's shape is not
the problem (a minimal closure tree runs at 41 ns under the compiler); the
cost is spread over hundreds of sites that hand objects and functions to
code the compiler cannot follow. Closing that gap means rewriting the plan
compiler's hot closures in a closed style, for about 1.5x on a path whose
alternative, the module from `ata build`, is already 2.2x faster and needs no
option. Not done now; this file and bench.ts are the method when it is.

## A typed copy of the module (typed-bench.ts)

The same module with its helpers given TypeScript signatures (`_cpLen(s:
string)`, `_h(o: any, k: string)`, `isValid(data: any)`), built `--aot`:
33.0 against 32.1 to 32.2 ns for the JavaScript one, three runs. The data is
`unknown` by nature, so the types that would matter cannot be written; no
typed emission.

## Bun's own order (test/aot/servers), validation alone, --aot

The order body of Bun's server benchmarks (customer, ten items, coupon),
the zod 4 schema from its `shared.ts`, Bun's `validate<Order>` from
`bun:bundle` (the type carries the same rules), and the module from `ata
build` of the same rules as JSON Schema. One executable, ns per call,
medians of 7 rounds, two runs:

| validator | accepted order | refused order (last item wrong) |
|---|---|---|
| zod 4.6.7 safeParse | 4,593 to 4,716 | 5,228 to 5,278 |
| validate<Order> (bun:bundle) | 91 to 92 | 133 to 136 |
| ata module, isValid | 174 | 165 to 166 |

The ata module agrees with Bun's `answers.ts` on all 60 accepted, refused
and invalid orders. Alone in an executable the same module takes 110 ns; next
to zod, whose parsers go through `new Function` and so leave the program
open, 174. Before the engine-selected prototype read and key count (ata
1.60.0's emission) the module took 212 alone and 430 with pricing.

## The floor for untyped JavaScript, and what the compiler's own validator does

Hand-written validators of the Order rules, `any` input, one executable
built `--compile --aot`, accepted order, ns per call: Bun's own style
(`parseOrder` + `isValidOrder` from shared.ts, merged) 235; a keys-loop
version 151; hasOwn + for...in switch 180; the ata module 122;
`validate<Order>` 85. No hand-written untyped code reached the module.

Per item: with 1 item the module and `validate<Order>` are equal (40 vs 42);
at 10 items 116 vs 85; at 100 items 921 vs 638. `validate<Order>` slows when
items carry the same keys in three different orders (85 to 96, 638 to 790);
the module does not. So the typed validator dispatches on the objects' hidden
structure, which JavaScript cannot observe.

Pricing the module's checks by removing them one at a time (108 base): the
key count of each closed object 10 in total, the root's for...in walk over
its optional-key closed object 9, prototype check, Number.isInteger, _cpLen,
pattern and one-versus-two typeof chains each 0 to 1.

After the engine-selected key loop (ata master): 1.60.0 emission against the
working tree, side by side: AOT 227 to 108 accepted, 223 to 103 refused; JIT
65 to 53, 62 to 49. Beside zod in the same executable (open program) 174 to
157, `validate<Order>` 89.

A type written from the schema with Bun's `Schema` tags and checked by
`validate<T>`, the plain module as its error path: accepted 83 (the same
compiler, the same number as Bun's own type), refused 120, refused with the
error list 923 (module alone 808); 60 of 60 answers.ts orders agree.

## Mixed traffic (traffic.ts): 1024 distinct orders, 10% invalid

1 to 12 items an order (6.5 on average), names and e-mails of varying
length, 103 invalid in six different ways spread through the stream, 451,143
bytes of JSON, the same order of documents for every validator, 7 rounds of
100 passes, medians, two passes. ns per document (MB/s of JSON text):

| validator | Node 25 | Bun 1.4.0 | Bun PR, compiled JIT | Bun PR, --aot |
|---|---|---|---|---|
| zod 4.6.7 safeParse | 1728 to 1731 (255) | 1565 to 1615 (278) | 1462 to 1474 (300) | 3219 to 3248 (137) |
| validate<Order>, Bun's type | | | | 96 to 97 (4560) |
| validate<Order>, type written from the JSON Schema | | | | 94 to 97 (4600) |
| ata module isValid (master emission) | 76 to 79 (5670) | 57 to 61 (7500) | 50 to 52 (8690) | 130 to 135 (3330) |

All four agree on all 1024 verdicts. The single-object numbers above
(validate<Order> 85 to 90, module 108 to 122) flattered everyone by the same
amount; the ranking and the ratios (zod 24x behind the module under the
compiler, the module 1.37x behind the typed validator) hold on traffic.

## Two more doors, both measured shut (2026-10-25, --aot)

Typed emission. The Order rules written as the emitter would but in
TypeScript, each object cast to a type derived from the schema after its
typeof test, so the property reads are typed: fields `unknown` 135 to 136 ns,
fields typed 124 to 128, the plain module 118 to 119, `validate<Order>` 84 to
85. The casts change nothing for data the compiler did not see born; nine
wrong-shape probes (a string item, a numeric sku, a getter, an extra key, a
`__proto__` key from JSON) were refused by all three the same way.

End to end, text to object and verdict, the 1024 mixed-traffic texts:
`JSON.parse` alone 422 to 428; `JSON.parse` + `validate<Order>` 522 to 523;
`JSON.parse<Order>` fused 378 to 382, faster than the plain parse because it
builds the typed object directly; `JSON.parse` + the ata module 542 to 551.
On the parsed object the module is within 35 ns of the typed validator; on
the text path the fused parse is 1.44x ahead of parse plus module, and it is
the engine's own parser, which no library can be.

## `ata build --target bun` (2026-10-25, ata master)

The build writes `order.compiled.bun.ts` beside the plain module: the schema's
rules as a type with Bun's `Schema` tags, `validate<T>` for the verdict,
`JSON.parse<T>` from "bun" for text, and the plain module deciding and
supplying the errors wherever the type refuses. The type is never looser than
the schema; a keyword the type cannot carry exactly declines the whole schema
(the plain module stands alone, a warning says which keyword).

Official suite, the groups the mapping carries, checked by `validate<T>` in
one `--aot` executable against the suite's answers (benchmark/proof/aot/suite-differential.mjs):
draft 2020-12 108 of 384 groups (28%), 374 tests, 0 where the type accepts
what the suite refuses, 1 stricter (vocabulary.json, where ata itself differs
from the suite by design); draft 7 97 of 258 groups (38%), 343 tests, 0 and 0.
Declined most often: remote $ref, unevaluated*, contains, if, format, oneOf,
not, patternProperties. Patterns are carried only when the unicode flag cannot
change their answer (Bun runs them without it).

The 1024 mixed-traffic orders, one `--aot` executable, no zod in it, ns per document:

| | |
|---|---|
| validate<Order>, Bun's own type | 90 to 105 |
| generated isValid | 96 to 99 |
| generated validate (Result object) | 165 to 166 |
| plain module isValid | 108 to 109 |
| plain module validate | 173 to 176 |
| generated parse, text to object | 423 to 429 |
| JSON.parse + plain module, text to object | 546 to 549 |

0 disagreements between the generated file and the plain module on the 1024
documents, isValid, validate and parse alike.

## The split: type plus residual (2026-10-25, ata master)

The whole-schema rule was too coarse: `format` on one property declined the
whole target. Now each node's keywords are split, the ones a type carries
exactly into the type, the rest into a residual schema that keeps only the
structure needed to reach them, compiled by ata into `X.compiled.rest.mjs`.
Accept = Bun's check and the residual module; refuse = the plain module's
errors. Groups that see each other stay whole in the residual (`if/then/else`,
`unevaluated*` with its node, `additionalProperties` beside
`patternProperties`, the `contains` family, `anyOf` with any residual
branch). Definitions travel whole beside their residuals (`__rest__<name>`).

Suite, type and residual together against the suite's answers, in one `--aot`
executable: draft 2020-12 122 of 384 groups get a target (96 carried whole by
the type), 417 tests, 416 agree, 0 looser, 1 stricter (vocabulary.json, where
ata itself differs from the suite by design); draft 7 105 of 258 (90 whole),
383 of 383. The groups without a target are the ones whose root the type
cannot say anything about (`{"format": ...}`, `{"oneOf": ...}` alone: 201 and
122), remote `$ref` (53, 28), `$dynamicRef` (3).

The order with `format: email` on the customer's address (the residual holds
that one keyword), 1024 mixed-traffic documents, ns per document:

| | |
|---|---|
| validate<Order>, Bun's own type (no format) | 88 to 91 |
| generated isValid (type, then residual) | 111 to 112 |
| plain module isValid | 117 to 119 |
| generated parse, text to object | 446 to 448 |
| JSON.parse + plain module, text to object | 570 to 579 |

0 disagreements with the plain module on the 1024 documents. The residual
costs about 14 ns here against the type alone (97); the text path keeps its
1.28x.

## One form per target engine (2026-10-25, ata a16abb2)

The dual emission (`if(_KC)` per closed object) cost V8 5 to 7% on small
SchemaStore schemas (json-patch 256 -> 274 ns, npm-badges 44 -> 46, confirmed
over 15 runs against an A/A of 1.00). Now the generator writes one form for
the target engine: the runtime for the engine it runs on, `ata build --target
bun` for JavaScriptCore. V8 modules are byte for byte the 1.60.0 ones; the
three schemas are back to 1.005 / 0.996 / 0.995. Module built on Node without
the target and run under Bun keeps the V8 form, correct and at the old speed.

Kit bench.ts, one executable, module from `--target bun`, master runtime, ns
per document (1024 parsed documents):

| | JIT | --aot |
|---|---|---|
| module isValid | 25 | 24.3 |
| module validate() | 34.7 | 24.7 |
| runtime Validator, generated code | 28.1 | 492 |
| runtime Validator, interpreted engine | 52.4 | 80.1 |
| zod 4.6.7 safeParse | 209 | 512 |

Order module, paired in one executable, 1.60.0 emission against `--target
bun`: AOT 223 -> 105 accepted, 218 -> 101 refused; JIT 65 -> 53, 59 -> 46.

## Through the plugin (2026-10-25, unplugin feat/schema-of fad20e2, ata master)

`Bun.build({ compile: { aot: true }, plugins: [ata()] })` on a TypeScript
entry with `new Validator(schema)`, 1024 mixed-traffic documents, isValid
through the compiled-away wrapper, two executables, two runs each:

| schema | plain module (`bunTarget: false`) | typed check (default under aot) |
|---|---|---|
| ten-item order | 125.9, 120.8 ns | 114.1, 106.5 ns |
| three fields with `format: email` | 38.6, 34.3 ns | 36.6, 32.6 ns |

The wrapper (`fromCompiled` -> isValidObject) and the document generator in
the same program put these above the bare-module figures (108 / 96); the
ratio is the one the bare modules showed.

## The jsc-aot form: level with validate<T> on the parsed object (2026-10-25)

Lemire's rule applied: do not walk data twice. For a closed object whose
declared keys are all required, the module read the prototype (a flag), ran
hasOwn over the required list on non-plain objects, counted the keys with an
allocating Object.keys, then read each property. The `jsc-aot` form reads
Object.keys once and compares it with the declared list in order (the order
JSON.parse gives), falling back to a membership walk; that proves presence,
ownership and closedness together, so the flag and the hasOwn list go.

Order body, 1024 mixed documents, one `--aot` executable, three passes:

| | pass 0 | pass 1 | pass 2 |
|---|---|---|---|
| validate<Order> (bun:bundle) | 105.4 | 95.9 | 97.8 |
| module, jsc form (plain count) | 108.0 | 111.5 | 110.2 |
| module, jsc-aot form (`--target bun`) | 104.8 | 107.0 | 107.1 |

0 disagreements on the 60 answers and the 1024 documents. On Bun's JIT the
same form measured 69 to 70 ns against 54 to 66 for the plain count, so it is
written only for the compiler (`--target bun`, the plugin under
`compile.aot`). A first attempt that kept the prototype flag and the hasOwn
list beside the key list measured 129 to 137: the proof has to replace them,
not sit next to them. The three forms agree on 4730 suite answers including
objects with other prototypes, inherited keys and reordered keys
(tests/test_target_engines.js).

## Accepted and refused apart, objects and text (2026-10-25, one --aot executable, ten candidates)

1024 accepted and 1024 refused orders made separately, ns per document:

| | accepted | refused |
|---|---|---|
| validate<Order> (bun:bundle), on the object | 120 | 121 (throws) |
| ata module isValid, on the object | 149 | 78 |
| ata module validate with the error list, on the object | | 724 |
| BunJSON.parse<Order>, on text | 371 | 480 |
| ata generated parse (`--target bun`), on text | 367 | 476 (was 999 before the second parse was dropped) |
| JSON.parse + ata module, on text | 569 | |

On refusal the module returns false where the typed check throws: 78 against
121. The generated parse is Bun's own parse with the residual behind it, and
level with it on both sides. The accepted-object column is 25% behind in this
executable where the three-candidate one showed parity; the ten candidates
and two document sets change the program, and the module's share of the
compiler's budget with it. Both are reported.

## The error path (2026-10-25): the older collector against the one-pass function

A rejected ten-item order (last item's quantity 0), error list built, ns:

| | Node 25 | Bun --aot |
|---|---|---|
| module, default build (older collector, with frames) | 378 to 390 | 724 |
| module, `--no-source` (older collector, no frames) | 362 to 367 | |
| module, `--one-pass` | 105 to 108 | 189 |
| runtime Validator, richErrors: false | 99 to 103 | |
| runtime Validator, rich | 192 to 196 | |

The cost was never the frames; it is the older collector, which re-evaluates
its guards per keyword (profile: 62% in that function, 15% the verdict, 7%
the e-mail regex). The one-pass function is level with the runtime. It stays
opt-in for browser builds because it is larger: over 60 SchemaStore schemas
gzipped 1,341,514 against 1,617,278 bytes (1.21x; 53 larger by more than 5%,
worst act3.json 2,010 to 3,164). `--target bun` and the plugin under
`compile.aot` take it by default, with no frames.

## Inside a Hono request (2026-10-25, plugin feat/schema-of, app.fetch in process, no socket)

Four POST routes over the same 1024 bodies (10% invalid): parse only; parse +
ata `isValidObject`; parse + ata `validate()` with the error list in the 400
body; parse + zod `safeParse`. Built three ways with the plugin (harness
hono-aot/). ns per request, two passes:

| route | `--aot`, plain module | `--aot`, typed target | JIT (`--compile`) |
|---|---|---|---|
| /none | 1229, 1221 | 1209, 1241 | 1583, 1579 |
| /ata | 1337, 1391 | 1347, 1354 | 1679, 1736 |
| /ata-errors | 1508, 1494 | 1513, 1447 | 1811, 1773 |
| /zod | 4522, 4554 | 4788, 4817 | 3440, 3339 |

The check costs a Hono request about 120 to 170 ns of 1,350 under the
compiler; zod costs it 3,300. Typed against plain is inside the run's noise
here. Two bugs found on the way, both in the plugin's aot path and both fixed:
a strict project (`@types/bun`) failed the type check on the inlined module
(TS7006), then on the virtual module's missing declaration (TS2307).

## The plain Bun target (2026-10-25, PR build of 16:54 local, "aot" condition in)

`order.plain.bun.ts` as `ata build --target bun` writes it since this
afternoon (plain type, `isValid` and `validate` through the module, `parse`
with `const d: Order = JSON.parse(text)`), one `--aot` executable
(`plain-target.ts` in the kit), the 1024 mixed-traffic orders, ns per
document, two passes:

| | pass 0 | pass 1 |
|---|---|---|
| generated isValid | 139 | 118 |
| plain module isValid | 118 | 121 |
| generated parse (text) | 564 | 574 |
| JSON.parse + plain module (text) | 578 | 570 |
| typed parse, then read the object | 595 | 593 |
| untyped parse, then read the object | 587 | 591 |

0 disagreements with the plain module on the 1024 documents. The build's
report: "49.6% of property accesses are one load: 80 free, 58 tested, 23 by
name (161)". Declaring the type at the parse changed nothing measurable, in
the parse or in the reads after it. The file is a type for the program; the
speed is the module's, and the module's form (`jsc-aot`) and the one-pass
error function are the whole of what `--target bun` buys today.

## Inside an Elysia request (2026-10-25, PR build e52f869, app.handle in process, no socket)

Elysia 1.4.30, the same 1024 Order bodies (10% invalid), five routes: no
schema; Elysia's own `t` (TypeBox, its default); zod 4, the ata runtime
`Validator` and the module from `ata build --target bun` (the last three as
Standard Schema, the module behind a ten-line `~standard` wrapper). Harness:
`bun-aot-kit/elysia-aot/`. ns per request, the median of 5 rounds of 10,240
requests, two passes; "over none" is the validation's share.

| route | JIT (bun run) | over none | --aot | over none |
|---|---|---|---|---|
| none | 1,705 to 1,726 | | 1,906 to 1,969 | |
| Elysia t (TypeBox) | 4,453 to 4,581 | +2,750 | 9,663 to 9,759 | +7,750 |
| zod 4 | 3,970 to 4,018 | +2,280 | 5,900 to 6,073 | +4,050 |
| ata, runtime Validator | 2,170 to 2,214 | +480 | 3,468 to 3,517 | +1,550 |
| ata, built module | 2,008 to 2,049 | +310 | 2,494 to 2,553 | +580 |

Statuses: zod, the ata runtime and the ata module each answer 422 to the
same 103 bodies; Elysia's `t` route to 78, since Elysia normalizes a body
against its own schema before checking it (its `normalize` default strips
the unknown key the "extra" case adds). Under the compiler, Elysia's own
validator costs 13x what the ata module costs and zod 7x; the ata runtime
takes its interpreted engine there (3x the module). On the JIT the gap is
9x and 7x against the module. Elysia composes its handlers with `new
Function` as well (its own `aot` option), which is in every row.

Decomposition of the ata share (same harness, 2026-10-25). A Standard Schema
that accepts everything without looking costs Elysia's own path +34 ns on the
JIT and +87 compiled, over no schema. ata's `~standard.validate` alone on a
ten-item order: runtime 58 accepted / 93 refused on the JIT, module wrapper 62
/ 107; compiled, module wrapper 74 / 217, runtime 1,249 / 1,950 (this build
has no `Bun.isAOT`, so the runtime keeps generated code there; with `engine:
'interpreter'` 669 / 1,424). With 0% invalid bodies the shares over no schema
were: JIT, ata runtime +13, module +98, zod +1,762, Elysia t +1,797; compiled,
module +240, runtime +1,137, zod +3,481, Elysia t +6,799. The rest of the 10%
run's shares is Elysia building its 422 response for the refused tenth, paid
by every row alike. Nothing on ata's side is left to take out of the request.

### zod 4.6 `z.compile()` in the same Elysia route (2026-10-25, evening)

Asked on X after the chart went out. zod 4.6.7 has `compile(schema)`: a clone
whose `_zod.run` tries a generated fast path first (built with `new Function`,
ten sites in `v4/core/compile.js`) and falls back to the runtime parser where
the fast path returns INVALID. Same harness, a `/zod-compiled` route with
`body: z.compile(ZodOrder)`, two JIT runs and one `--aot` run; ns added over
the no-schema route of the same run:

| route | JIT run 1 | JIT run 2 | --aot |
|---|---|---|---|
| zod 4 | +2,122 | +2,145 | +3,888 |
| zod 4, `z.compile()` | +660 | +598 | +2,406 |
| ata, runtime Validator | +340 | +485 | +1,588 |
| ata, built module | +179 | +325 | +517 |

Statuses identical (103 refused). `compile()` takes zod's share to about a
third on the JIT, about twice the ata module; under the compiler its fast path
is code from a string and is interpreted, so the gap there stays 4.7x. A
refused body runs the fast path and then the runtime parser, by design.
