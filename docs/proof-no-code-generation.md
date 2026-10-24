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

What this does not show:

- Nothing here ran under Bun's ahead-of-time compiler, which has not shipped.
  Bun 1.4.0 also ignores Node's code-generation flag, so there is no "Bun,
  refused" row. What the table shows for Bun is that the built module needs
  neither `new Function` nor an import, which is what that compiler's authors
  say decides the speed of a validator under it.
- The Worker row has no cold figure. Its isolate is warm by the time a request
  is answered, and a per-request time there is a different measurement
  ([docs/edge-runtimes.md](edge-runtimes.md) has one).
- The runtime figures include loading ata itself; the module figures include
  loading the module. That is the point of the comparison, not a flaw in it,
  and it is why the two differ by twenty times rather than by the cost of
  one compile.
