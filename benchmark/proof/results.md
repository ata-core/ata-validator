| where | `new Function` | runtime Validator | module from `ata build` | runtime, import to first validation | module, same |
|---|---|---|---|---|---|
| node v25.2.1, --disallow-code-generation-from-strings | blocked (EvalError) | same answers (interpreter) | same answers | 7.94 ms | 0.35 ms |
| node v25.2.1 | allowed | same answers (codegen) | same answers | 7.79 ms | 0.34 ms |
| bun 1.4.0 | allowed | same answers (codegen) | same answers | 6.24 ms | 0.35 ms |
| Chrome, page under CSP script-src self | blocked (EvalError) | same answers (interpreter) | same answers | 2.60 ms | 0.10 ms |
| Cloudflare Workers (wrangler dev, workerd) | blocked (EvalError) | same answers (interpreter) | same answers | n/a | n/a |

Errors on the invalid document, every row, both validators: additionalProperties, format, minLength, minimum. All rows agree: true. Medians of 11 fresh processes (Chrome 5), 2026-10-25.
