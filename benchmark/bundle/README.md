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

Bun 1.4.0, Hono 4.13.7, Apple M4, `bun build --minify --target=bun`, best of seven for
the timings. ata 1.22.0, Zod 4.6.5, Valibot 1.5.0, TypeBox 0.34.52.

| Combo | bundle | gzip | startup | RSS |
|---|---|---|---|---|
| Hono, no validation | 18.3 KB | 7.5 KB | 3.6 ms | 20 MB |
| Hono + ata, precompiled | **21.2 KB** | 8.6 KB | 3.5 ms | 21 MB |
| Hono + Valibot | 23.6 KB | 9.1 KB | 5.0 ms | 21 MB |
| Hono + TypeBox, with its compiler | 110.5 KB | 29.9 KB | 13.7 ms | 34 MB |
| Hono + ata, runtime API | 335.5 KB | 91.8 KB | 10.7 ms | 32 MB |
| Hono + Zod | 468.8 KB | 98.1 KB | 10.9 ms | 34 MB |

Precompiled ata is the smallest row that validates, 2.9 KB over an app that validates
nothing, and starts in the same time. The runtime row is the other end of the same
library: a schema that arrives at run time can use any keyword, so the whole engine ships
with it. Which one belongs in your build is an environment question, and the README of
the main package has the guidance.

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
