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
seven for the timings. ata 1.33.1, Zod 4.6.5, Valibot 1.5.0, TypeBox 0.34.52. Remeasured
2026-09-28, three rounds, the median round shown.

| Combo | bundle | gzip | startup | RSS |
|---|---|---|---|---|
| Hono, no validation | 18.4 KB | 7.6 KB | 3.5 ms | 20 MB |
| Hono + ata, precompiled | **21.6 KB** | 8.8 KB | 3.5 ms | 20 MB |
| Hono + Valibot | 23.7 KB | 9.2 KB | 4.8 ms | 22 MB |
| Hono + TypeBox, with its compiler | 110.6 KB | 29.8 KB | 12.6 ms | 34 MB |
| Hono + ata, runtime API | 403.3 KB | 110.8 KB | 11.2 ms | 33 MB |
| Hono + Zod | 468.9 KB | 97.6 KB | 10.9 ms | 34 MB |

Precompiled ata is the smallest row that validates, 3.2 KB over an app that validates
nothing, and starts in the same time. The runtime row is the other end of the same
library: a schema that arrives at run time can use any keyword, so the whole engine ships
with it, and it has grown since 1.22.0 with the correctness work of the 1.31 releases and
`Validator#parse`. Which one belongs in your build is an environment question, and the
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
