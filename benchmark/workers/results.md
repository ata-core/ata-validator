# Results 2026-10-09

## Through workerd (wrangler dev), per request, 7 interleaved rounds of 300

| route | valid body, median | p90 | invalid body, median | p90 | status |
|---|---|---|---|---|---|
| /none | 0.74 ms | 0.96 | 0.79 ms | 1.08 | 200 and 200 |
| /ata-compiled | 0.72 ms | 0.90 | 0.81 ms | 1.14 | 200 and 400 |
| /ata-runtime | 0.72 ms | 0.93 | 0.80 ms | 1.14 | 200 and 400 |
| /cfworker | 0.71 ms | 0.89 | 0.84 ms | 1.14 | 200 and 400 |
| /ajv-standalone | 0.70 ms | 0.92 | 0.79 ms | 1.11 | 200 and 400 |
| /ajv-runtime | 1.82 ms | 2.23 | 2.02 ms | 3.32 | 500 and 500 |

/ajv-runtime body: {"error":"EvalError: Code generation from strings disallowed for this context"}

## Bundle (esbuild, minified, worker conditions)

| approach | bundle, minified | gzipped | validation adds | `new Function` in the bundle |
|---|---|---|---|---|
| none | 18.6 KB | 7.8 KB |  | no |
| ata-compiled | 27.2 KB | 10.0 KB | 2.2 KB | no |
| ata-runtime | 186.2 KB | 57.5 KB | 49.6 KB | yes (one helper, not called on this path) |
| cfworker | 40.6 KB | 13.7 KB | 5.9 KB | no |
| ajv-standalone | 22.4 KB | 8.9 KB | 1.1 KB | no |
| ajv-runtime | 167.5 KB | 51.7 KB | 43.9 KB | yes |

## Per validation, Node with --disallow-code-generation-from-strings, 7 rounds of 200000

| approach | valid document | invalid document |
|---|---|---|
| ata-compiled | 32 ns | 109 ns |
| ata-runtime | 138 ns | 230 ns |
| cfworker | 1724 ns | 2062 ns |
| ajv-standalone | 54 ns | 15 ns |
| ajv-runtime | throws EvalError at compile | |

ata's invalid figure builds the full error list with codes and messages; the
standalone default validator stops at the first error (allErrors false).

## Fresh process to the first validation, same restriction, medians of 11 (two runs)

| approach | run 1 | run 2 |
|---|---|---|
| ata-compiled | 5.70 ms | 5.16 ms |
| ata-runtime | 12.85 ms | 12.89 ms |
| cfworker | 7.59 ms | 7.94 ms |
| ajv-standalone | 8.01 ms | 6.95 ms |
| ajv-runtime | throws EvalError | |
