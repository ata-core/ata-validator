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
