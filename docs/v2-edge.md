# The 2.0 edge entry

Work in progress on the 2.0 branch. This page is new; there is no other 2.0
document yet.

`index.v2.edge.mjs` is the entry for servers and edge runtimes: Cloudflare
Workers, a process run with `--disallow-code-generation-from-strings`, an MCP
server holding many tool schemas. It is the 2.0 Validator with two engines:

- the verdict core (`lib/core/verdict.js`), which answers `isValidObject` and
  a `validate` call whose value passes;
- the small engine (`lib/engine-small.js`), which gives the error list of a
  value that fails.

The browser entry (`index.v2.browser.mjs`) carries the small engine alone,
because on a page the bytes of a second engine cost more than the core gives
back.

## What a validator does on its first calls

`isValidObject` compiles the core on its first call. `validate` answers with
the small engine on its first call and for as long as values keep failing,
since that one walk gives the verdict and the errors together; once a value
passes, the core answers and the small engine is asked only for a value that
fails.

Before either, the Validator asks five questions of the schema (does it use
`errorMessage`, `default`, `format`, a json-schema.org meta-schema reference,
`$id` or an anchor). The edge entry answers them by walking the schema rather
than writing its JSON text. Where the validators built before were first
asked for a verdict, that walk is the core's own scan, which the first compile
then takes, so the schema is walked once. Where they were first asked to
`validate`, the walk gathers only the answers, which costs less, and the core
walks the schema itself if it compiles later.

## One-time cost per process

A process that imports the edge entry pays, once, for loading the core and
for the first compilation of its code by the JavaScript engine (the first
format check, the first closed object, the first Unicode pattern, the first
meta-schema reference). Measured on Node 25.2.1 on an Apple M4 Pro, 15 fresh
processes each, medians, against the browser entry: importing the entry takes
5.26 ms instead of 4.01 (1.25 ms more), and the first validator of the
process (a small object schema: construct, a valid and an invalid
`isValidObject`, an invalid `validate`) takes 3.81 ms instead of 2.68 (1.13
ms more). A second, unrelated schema then costs 0.17 ms more (0.80 against
0.63), the last of the first-use compilation. These were measured while other
jobs were running on the machine and should be measured again on an idle one
before they are quoted elsewhere.

After that, each validator costs less than with the browser entry. The calls
it takes to win the one-time cost back, measured in fresh processes as the
cumulative time of the import, constructing a validator for every schema of
a corpus, and checking each one N times (cycling through the corpus's valid
and invalid documents), against the same with the browser entry:

| corpus | schemas | `isValidObject` | `validate`, valid and invalid documents in turn |
|---|---:|---|---|
| pi-schema's benchmark cases | 9 | from the 2nd call | not within 1,000 calls (1.09 times the browser entry's total at 1,000) |
| JSON Schema Test Suite, five dialects | 1,327 | from the 2nd call | not within 1,000 calls (1.16 at 1,000) |
| SchemaStore samples | 492 | from the 1st call | from the 20th call |

Medians of 11 fresh processes per entry (same machine and conditions as
above). At 1,000 calls the edge entry's total is 0.64 (pi), 0.47 (suite) and
0.52 (SchemaStore) of the browser entry's for `isValidObject`.

The `validate` column shows a limit of the edge entry, not of its one-time
cost: where a validator's values alternate between passing and failing, a
value that fails right after one that passed is checked by the core and then
by the small engine, so it costs more than the browser entry's single walk.
It is open work on the 2.0 branch.

With one `isValidObject` call per validator, the totals were within 2% of
each other on the pi cases (1.002) and the suite (1.020), and lower with the
edge entry on SchemaStore (0.837). A process that keeps its validators pays
the one-time cost once.
