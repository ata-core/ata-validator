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
