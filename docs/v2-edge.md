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

`isValidObject` compiles the core on its first call and answers with it from
then on.

`validate` answers its first call with the small engine, whose one walk gives
the verdict and the errors together. What happens next depends on that first
value:

- If it failed, the validator uses the small engine for every later
  `validate` call, as the browser entry does.
- If it passed, later calls ask the core first and the small engine only for
  a value the core fails. Once more than a quarter of at least 8 calls have
  failed, the validator switches to the small engine for good, because each
  failing value would otherwise be checked twice.

When a validator switches, it lets go of the core's compiled tree; an
`isValidObject` call after that compiles it again. A validator that switches
on a stream that later turns valid stays with the small engine: it misses
the core's speed but is not slower than the browser entry.

Before either, the Validator asks five questions of the schema (does it use
`errorMessage`, `default`, `format`, a json-schema.org meta-schema reference,
`$id` or an anchor). Where the validator built before this one was first
asked for a verdict, the edge entry answers them with the core's own scan of
the schema, which the core's first compile then takes, so the schema is
walked once. Where it was first asked to `validate`, the edge entry reads
the schema's JSON text, as the browser entry does, and the core walks the
schema itself if it compiles later.

## Measurements

All figures below were measured on Node 25.2.1 on an Apple M4 Pro with no
other heavy jobs running (load average 3 to 4.5), in fresh processes with
the order of the entries rotated between runs, against the browser entry.
Medians, ranges in brackets.

### `validate` on streams of values

Warm validators, every validator of a corpus asked in turn, µs per call:

| stream | corpus | browser entry | edge entry | ratio |
|---|---|---:|---:|---:|
| each schema's valid then invalid documents in turn | suite | 0.388 (0.378..0.405) | 0.394 (0.378..0.419) | 1.016 |
| one valid, one invalid | suite | 0.386 (0.373..0.399) | 0.383 (0.366..0.417) | 0.994 |
| nine valid, one invalid | suite | 0.255 (0.244..0.277) | 0.165 (0.158..0.210) | 0.648 |
| valid only | suite | 0.197 (0.189..0.234) | 0.090 (0.083..0.096) | 0.456 |
| each schema's valid then invalid documents in turn | pi | 1.567 (1.544..1.616) | 1.561 (1.545..1.599) | 0.996 |
| one valid, one invalid | pi | 1.561 (1.518..1.580) | 1.564 (1.535..1.766) | 1.002 |
| nine valid, one invalid | pi | 1.238 (1.222..1.259) | 0.427 (0.419..0.439) | 0.345 |
| valid only | pi | 1.094 (1.074..1.248) | 0.184 (0.178..0.191) | 0.168 |

15 runs each. "suite" is the JSON Schema Test Suite in five dialects, "pi"
is pi-schema's benchmark cases.

### Values that keep failing

`validate` on the suite with every value failing (11 or 31 runs) is 1.013 to
1.039 times the browser entry, with overlapping ranges. Most of that is not
the validator's work: loading any additional module into the process, even
a 60 KB file holding only comments, made the browser entry 1.009 to 1.015
times slower on the same row (31 and 45 runs), and the core loaded and never
called made it 1.004 to 1.015 times slower.

### A fresh process

What a new process pays in all, as a Workers isolate does on its first
requests: the entry imported, then a validator built for every schema of a
corpus and asked once about each of its documents, valid and invalid (15
processes each, load average 3.4 to 4.1, ms):

| corpus | schemas | method | browser entry | edge entry | ratio |
|---|---:|---|---:|---:|---:|
| pi-schema's benchmark cases | 9 | `isValidObject` | 7.9 (7.4..8.5) | 8.8 (8.7..9.8) | 1.118 |
| pi-schema's benchmark cases | 9 | `validate` | 9.4 (8.7..10.7) | 12.1 (11.7..13.8) | 1.290 |
| JSON Schema Test Suite, five dialects | 1,327 | `isValidObject` | 34.3 (33.6..37.6) | 35.6 (34.7..37.0) | 1.035 |
| JSON Schema Test Suite, five dialects | 1,327 | `validate` | 40.5 (39.7..61.7) | 58.5 (57.4..61.8) | 1.444 |
| SchemaStore samples | 492 | `isValidObject` | 399.6 (386.6..440.2) | 320.1 (318.0..329.0) | 0.801 |
| SchemaStore samples | 492 | `validate` | 435.2 (425.9..451.6) | 473.0 (469.6..513.2) | 1.087 |

A process that checks each schema only a handful of times pays more with the
edge entry, except for `isValidObject` on large schemas: the import, and for
`validate` the core's compile at a validator's second call, are not won back
in so few calls. The edge entry is for processes that keep their validators.

### One-time cost per process

A process that imports the edge entry pays, once, for loading the core and
for the first compilation of its code by the JavaScript engine (15 fresh
processes each):

| | browser entry | edge entry |
|---|---:|---:|
| import, ms | 3.62 (3.41..3.79) | 4.87 (4.43..5.11) |
| first validator (a small object schema: construct, a valid and an invalid `isValidObject`, an invalid `validate`), ms | 2.53 (2.29..2.74) | 3.46 (3.24..3.81) |
| second, unrelated schema, ms | 0.58 (0.55..1.38) | 0.73 (0.67..1.25) |

### When the one-time cost is paid back

Cumulative time of the import, constructing a validator for every schema of
a corpus, and checking each one N times, cycling through the corpus's valid
and invalid documents, against the same with the browser entry (7 runs):

| corpus | schemas | `isValidObject` | `validate` |
|---|---:|---|---|
| pi-schema's benchmark cases | 9 | from N = 200 (0.664 at 1,000) | not within 1,000 calls (1.119 at 1,000) |
| JSON Schema Test Suite, five dialects | 1,327 | from N = 1 (0.469 at 1,000) | not within 1,000 calls (1.022 at 1,000) |
| SchemaStore samples | 492 | from N = 1 (0.506 at 1,000) | from N = 20 (0.598 at 1,000) |

On pi's cases and the suite, `validate` on a stream that alternates passing
and failing values does not pay back the one-time cost within 1,000 calls:
such a stream costs about what it costs the browser entry per call, so the
import and each validator's core compile (at its second call, after a first
value that passed) are not won back. On SchemaStore, whose schemas are
larger, it pays back from the 20th call.
