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
