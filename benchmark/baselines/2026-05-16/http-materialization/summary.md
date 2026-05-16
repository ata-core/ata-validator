# HTTP Materialization Measurement — 2026-05-16

**Environment:** Apple M4 Pro, Darwin 25.2.0 arm64, Node v25.2.1
**Spec:** `docs/superpowers/specs/2026-05-16-ata-http-materialization-measurement-design.md`

## Microbench (median ns or µs per iteration)

| Size | bytes | JSON.parse(str) | JSON.parse(buf) | sjson | isValid(buf) | isValidObject(obj) | parse+isValidObject | AJV(parse) |
|------|------:|---:|---:|---:|---:|---:|---:|---:|
| small  | 78    | 176.7 ns | 290.9 ns | 216.8 ns | 137.2 ns | 11.6 ns | 207.6 ns | 230.3 ns |
| medium | 4045  | 6.24 µs  | 6.61 µs  | 7.25 µs  | 4.42 µs  | 618 ns  | 6.86 µs  | 8.86 µs  |
| large  | 41419 | 66.09 µs | 68.53 µs | 76.09 µs | 42.28 µs | 6.35 µs | 71.90 µs | 96.34 µs |

### Micro verdict

| Size | Micro #1 (parse+validate / parse, target >= 1.4) | Micro #2 (validateJSON / parse, target <= 1.2) |
|------|---:|---:|
| small  | 1.18  FAIL | 0.47  PASS |
| medium | 1.10  FAIL | 0.67  PASS |
| large  | 1.09  FAIL | 0.62  PASS |

- Micro #1: **FAIL all sizes.** Validate adds only 9-18% on top of JSON.parse, because `isValidObject` is essentially free (12 ns small, 618 ns medium, 6.4 µs large). There is no meaningful room to win by fusing parse and validate.
- Micro #2: **PASS all sizes.** simdjson walk is 1.5-2x faster than V8 JSON.parse on buffer input. The native path is competitive.

## E2e (Fastify, 100% valid, 2 conn, 10s warm + 10s measure)

| Size | bytes | AJV rps | ata-v1 rps | ata-v2 rps | best-ata vs AJV |
|------|------:|--------:|-----------:|-----------:|----------------:|
| small  | 78    | 44717 | 44506 | 44272 | -0.5% behind |
| medium | 4045  | 27558 | 26144 | 30794 | **+11.7% ahead** |
| large  | 41419 | 7314  | 6316  | 8922  | **+22.0% ahead** |

- ata-v1 = `isValid(buf)` then `JSON.parse(buf)` if valid.
- ata-v2 = `JSON.parse(buf)` then `isValidObject(obj)` — the AJV-equivalent order.

### E2e verdict (medium payload, target ±5%)

best-ata (ata-v2) vs AJV: **+11.7% ahead — FAIL**

The condition was designed to detect the marginal case where a fused path would shift positioning. ata is past that point; it is already ahead.

## Final verdict

**Per the spec verdict table:** Micro #1 FAIL → STOP. Do not invest in a fused parse + validate + materialize C++ path. There is no headroom to recover.

**The richer story behind the number:**

1. ata in the parse-then-isValidObject configuration is **12-22% faster than AJV** at medium-to-large payloads in 100% valid Fastify traffic. The "not really worth a binary dep" assessment from Matteo Collina was made before this measurement existed. There is now concrete counter-evidence: the runtime benefit is real and grows with payload size.

2. The intuitive "fast path" (`isValid(buf)` + `JSON.parse`) is **slower than AJV** by 0.5-14% across sizes. Double-pass over bytes and the buffer content-type parser overhead consume the simdjson win. This is the configuration Matteo was reasoning about ("HTTP needs the JS object anyway") — and he was right that it has no win. The improvement is to use the other configuration.

3. simdjson walk being 1.5-2x faster than V8 parse opens a separate, larger opportunity: a simdjson-based JSON materializer that replaces V8 `JSON.parse` entirely, with validation as a free side effect. The current measurement doesn't quantify whether NAPI overhead allows this to actually beat V8 parse. That is a different spike.

## Follow-up: NAPI materialize feasibility (added 2026-05-16)

To gate the "can we fix v1 with a fused validate-and-materialize C++ path?"
question, we benched the npm `simdjson` package — which is essentially what
a fused implementation would be: simdjson parse + NAPI materialize, no
validation.

| Size | bytes | JSON.parse(str) | simdjson.parse(str) | ratio | simdjson.lazyParse(str) |
|------|------:|---:|---:|---:|---:|
| small  | 78    | 158 ns   | 739 ns    | 4.67x slower | 1132 ns |
| medium | 4045  | 6.57 µs  | 28.16 µs  | 4.29x slower | 6.67 µs |
| large  | 41419 | 62.33 µs | 279.46 µs | 4.48x slower | 46.78 µs |

**NAPI materialize is the wall.** Eager simdjson + NAPI is 4-5x slower than
V8's JSON.parse across all sizes. Adding validation on top cannot recover
that. **The "fused validate-and-materialize C++ path" is not feasible.**

`simdjson.lazyParse` is interesting on a different axis: at large payloads it
beats V8 by 25% — but only because it returns a Proxy that defers all
materialization. Handler-side access cost is not measured here and could
flip the picture. This is a separate product direction (lazy validated
parsing for handlers that read partial bodies), not a fix for v1.

## Final recommendation

The v1 configuration (`isValid(buf) + JSON.parse`) cannot be made faster
than AJV by changing ata's C++ side. The buffer-content-type-parser
overhead and the double byte walk are structural; the obvious fix (fuse
the walk with materialization) hits the NAPI wall.

**The real win is repositioning, not C++.**

1. **Make `parse + isValidObject` the documented Fastify pattern.** Update
   README and examples to lead with it. Currently ata is being measured in
   its losing configuration; the +12-22% configuration is buried.

2. **Take the numbers to the Fastify thread.** Concrete counter-evidence to
   "not really worth a binary dep": at medium and large payloads in 100%
   valid traffic, ata in the right configuration is +12% to +22% faster
   than AJV. That is a meaningful runtime benefit. Present it honestly,
   including the v1 finding (intuitive "fast path" doesn't win) — it
   strengthens the credibility of the v2 numbers.

3. **Backlog: lazy parsing as a separate product.** `simdjson.lazyParse`'s
   25% win on large payloads suggests a future `ata-lazy` package (or mode)
   for handlers that read partial bodies. Out of scope for now; spike it
   separately when there is a clear consumer.

**Do not build:** any C++ change to "fix" v1. The two underlying bench
results (no headroom from fusing parse+validate, NAPI wall on
parse+materialize) close that door together.
