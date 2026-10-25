# The same validation where `new Function` is allowed, slow or refused

JavaScript validators that reach their speed by generating source and handing
it to `new Function` depend on the runtime allowing that. Cloudflare Workers,
a page under a strict Content-Security-Policy and Node under
`--disallow-code-generation-from-strings` refuse it; Bun's ahead-of-time
compiler (an open pull request as of October 2026) runs it, but through an
interpreter. ata validates the same way in all of them: with generated code
where it is allowed, with its interpreted engine where it is not, and with a
module from `ata build`, which is plain JavaScript that imports nothing and
calls no `new Function`, wherever that module is used.

`benchmark/proof` holds one schema (`user.schema.json`), one valid and one
invalid document, and one script that runs them in five places and writes
the table below. Each place reports whether `new Function` works there, what
the runtime `Validator` and the built module answer, and the time from the
start of the import to the first validated document.

```bash
cd benchmark/proof
npm install          # resolves ata-validator to this checkout
npm run build        # ata build user.schema.json
npm run proof        # writes results.md
```

Measured on 2026-10-24 with ata-validator 1.60.0 on an Apple M4 Pro, medians
of 11 fresh processes (Chrome 5):

| where | `new Function` | runtime Validator | module from `ata build` | runtime, import to first validation | module, same |
|---|---|---|---|---|---|
| Node 25.2.1, `--disallow-code-generation-from-strings` | blocked (EvalError) | same answers (interpreter) | same answers | 9.77 ms | 0.41 ms |
| Node 25.2.1 | allowed | same answers (generated code) | same answers | 9.05 ms | 0.41 ms |
| Bun 1.4.0 | allowed | same answers (generated code) | same answers | 7.10 ms | 0.45 ms |
| Chrome, page under `Content-Security-Policy: script-src 'self'` | blocked (EvalError) | same answers (interpreter) | same answers | 2.70 ms | 0.20 ms |
| Cloudflare Workers (workerd through `wrangler dev`) | blocked (EvalError) | same answers (interpreter) | same answers | not measured | not measured |

"Same answers" means: the valid document accepted, the invalid one rejected
with the same four errors in the same order (`additionalProperties`,
`format`, `minLength`, `minimum`) by every row and both validators. The
script checks that and prints `All rows agree: true`.

## Under Bun's ahead-of-time compiler

The compiler is an open pull request (oven-sh/bun#45631). Its CI build of
2026-10-25 (bun 1.4.4-canary.1+947fb6a47, installed with `bunx bun-pr 45631`)
ran `benchmark/proof/aot/bench.ts`: the same validators
on 1024 parsed documents inside an executable built with `bun build
--compile` and with `bun build --compile --aot`, three runs each, nanoseconds
per document (medians):

| validator | JIT | AOT |
|---|---|---|
| module from `ata build`, isValid | 25.9 | 34.2 |
| module from `ata build`, validate() | 59.5 | 60.2 |
| runtime Validator, compiled at start with `new Function`, isValidObject | 25.5 | 538 |
| runtime Validator, validate() | 30.7 | 552 |
| zod 4, safeParse | 210 | 530 |

Code generated at run time is interpreted under the compiler: ata's own
run-time path and zod both land near 530 ns. The module written at build time
is compiled with the program and stays at 34 ns. That is the whole case for
`ata build` in one row. The module is 30% slower under the compiler than on
the JIT, which the pull request's numbers for untyped npm code predict; a
typed emission is a later experiment.

What this does not show:

- These are numbers from a pull request build on one machine, not from a
  released Bun; they will be run again when the compiler ships. Bun 1.4
  ignores Node's code-generation flag, so there is no "Bun, refused" row in
  the table above.
- The Worker row has no cold figure. Its isolate is warm by the time a request
  is answered, and a per-request time there is a different measurement
  ([docs/edge-runtimes.md](edge-runtimes.md) has one).
- The runtime figures include loading ata itself; the module figures include
  loading the module. That is the point of the comparison, not a flaw in it,
  and it is why the two differ by twenty times rather than by the cost of
  one compile.
