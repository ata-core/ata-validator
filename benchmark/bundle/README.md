# Bundle, startup and memory, across validators

One Hono route, one request body, six ways of validating it. The point of the harness is
that every row does the same job and is checked to actually do it, because a size table
where one entry was tree-shaken away or silently broken measures nothing.

## Running it

```bash
bun install
bun run gen        # emits the precompiled module for the ata-aot row
bun run build      # bundles each app
bun run verify     # every row must accept a good body and reject a bad one
bun run startup    # time to a listening server, and RSS at that moment
```

`bun run verify` is not optional. It runs the built artefacts, not the sources.

## What was measured

Bun 1.4.0, Hono 4.13.7, Apple M4 Pro, `bun build --minify --target=bun`, gzip -9, best of
seven for the timings. ata 1.48.0, Zod 4.6.5, Valibot 1.5.0, TypeBox 0.34.52. Remeasured
2026-10-09 for the ata rows (the others on 2026-10-08), three rounds, the median of each row shown.

| Combo | bundle | gzip | startup | RSS |
|---|---|---|---|---|
| Hono, no validation | 18.9 KB | 7.8 KB | 3.5 ms | 23 MB |
| Hono + ata, precompiled | **22.3 KB** | 9.0 KB | 3.5 ms | 21 MB |
| Hono + Valibot | 24.4 KB | 9.4 KB | 4.8 ms | 22 MB |
| Hono + TypeBox, with its compiler | 113.4 KB | 30.6 KB | 13.4 ms | 35 MB |
| Hono + ata, runtime API | 504.6 KB | 145.3 KB | 7.6 ms | 23 MB |
| Hono + Zod | 480.3 KB | 100.4 KB | 10.9 ms | 34 MB |

Precompiled ata is the smallest row that validates, 3.4 KB over an app that validates
nothing, and starts as fast. The runtime row is the other end of the same
library: a schema that arrives at run time can use any keyword, so the whole engine ships
with it, and it has grown since 1.22.0 with the correctness work of the 1.31 releases,
`Validator#parse`, in 1.42 and 1.43 the one-pass error path, and in 1.47 the emitter that
writes that one-pass function into modules; gzipped it is larger than the Zod row, while it
starts sooner. Which one belongs in your build is an environment question, and the
README of the main package has the guidance.

## Two things this harness exists to prevent

**A row that does not validate.** The TypeBox app was wrong on the first run: TypeBox
ships no format checkers, and an unregistered `format` rejects every value, so that row
was a broken app returning 400 for valid input. `bun run verify` catches it. The app now
registers an `email` checker, which is part of what its bundle weighs.

**A row that was optimised away.** If a bundler decides the validation result is never
observed, it can remove it, and the table would then be comparing empty functions. Every
app returns a 400 on rejection, so the result is observed, and `verify` proves it.

## Not comparable to someone else's table

Bundle size moves with the bundler, the target and the minifier; startup moves with the
runtime; RSS moves with how it is sampled. These numbers are internally consistent and
say nothing about a table produced another way. Run the harness rather than lifting a row
out of it.
