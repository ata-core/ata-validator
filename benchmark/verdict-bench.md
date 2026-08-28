# Verdict path, official suite, warm median

Reproduction of Jason Desrosiers' suite benchmark: one prebuilt validator per
suite group, one pass over every instance, `ROUNDS=7`, median. Call sites are
megamorphic by construction, which is the honest shape of a benchmark that runs
a whole test suite; one route in a server is monomorphic and measures 3x to 10x
lower. Machine: darwin arm64, Node 25.2.1. Harness: the session scratchpad
`jbench/bench.mjs` and `breakdown.mjs`.

## Baseline, master f8b19ba (1.9.0), 2026-08-28

| `validate().valid` | 2020-12 | draft7 |
| --- | --- | --- |
| ata | 60 ns | 43 ns |
| ata `_fastVerdict` | 49 ns | 37 ns |
| @exodus/schemasafe (boolean-only) | 78 ns | 55 ns |
| ajv | 136 ns | 74 ns |

Margin over schemasafe: 2020-12 23%, draft7 22%.

Per route, 2020-12, 1294 cases: codegen 1002 cases avg 50/59 ns (accept/reject), interpreter 283 cases avg 108/100 ns, closure 9 cases avg 52/48 ns. Interpreter share of total time 35%.

Per route, draft7, 927 cases: codegen 780 cases avg 39/50 ns, interpreter 145 cases avg 79/74 ns, closure 2 cases avg 57 ns. Interpreter share of total time 25%.

## After codegen coverage, d6ad012, 2026-08-28

Tasks 2 to 7: boolean subschemas in `items`, `properties`, `patternProperties`,
`dependentSchemas`, `propertyNames`, `allOf`, `anyOf`, `not`, `contains` and
`if`/`then`/`else`; recursive `#/$defs/` references as named functions;
`additionalProperties` as a schema under composition and `patternProperties`.

| `validate().valid` | 2020-12 | draft7 |
| --- | --- | --- |
| ata | 53 ns | 43 ns |
| ata `_fastVerdict` | 45 ns | 34 ns |
| @exodus/schemasafe (boolean-only) | 82 ns | 58 ns |
| ajv | 150 ns | 76 ns |

Margin over schemasafe in this run: 2020-12 35%, draft7 26%. The competitor
figures moved between runs (78 to 82, 55 to 58) within the run-to-run noise of
this harness; the ata figures are compared against the baseline run above.

Per route, 2020-12, 1294 cases: codegen 1091 cases avg 42/67 ns (accept/reject), interpreter 194 cases avg 141/116 ns, closure 9 cases. Interpreter cases 283 to 194, share of total time 35% to 30%. Overall avg 65 to 63 ns.

Per route, draft7, 927 cases: codegen 833 cases avg 42/49 ns, interpreter 92 cases avg 108/75 ns, closure 2 cases. Interpreter cases 145 to 92, share 25% to 17%. Overall avg 48 to 49 ns.

The cases that moved to codegen were the cheap ones; what stays on the
interpreter is the `$id`, URN and remote-reference groups and the cyclic
graphs, which is where the remaining interpreter average comes from.

## Cycle guard: measured as no change, not pursued

The design expected the `(schema, data)` guard on `$ref` steps of cyclic
schemas to cost 2.3x on the suite's metaschema case and 1.4x on its recursive
tree. That figure came from timing the guarded build before the unguarded one
in the same process, which timed a cold run against a warm one. Interleaved,
median of five, the two heavy groups with every guard removed against master:
metaschema 151 against 160 ns, recursive tree 302 against 301 ns. The guard is
not where the time goes. A per-edge guard implementation was written, measured
at 352 and 427 ns on the same two groups for reasons not established, and
dropped; `lib/plan-compiler.js` is unchanged from master.
