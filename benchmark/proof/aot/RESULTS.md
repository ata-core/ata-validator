# Bun ahead-of-time, pull request build, 2026-10-25

bun 1.4.4-canary.1+947fb6a47 (oven-sh/bun#45631, CI artifact of 2026-10-25
00:11, installed with `bunx bun-pr 45631`), Apple M4 Pro, ata-validator 1.60.0,
zod 4.6.7, hono 4. `bench.ts` built with `--compile` (JIT) and `--compile
--aot`, three runs each, the median of 7 rounds of 300,000 documents per run,
1024 parsed documents, three quarters valid. Nanoseconds per document:

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
