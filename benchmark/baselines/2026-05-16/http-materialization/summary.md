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

## Recommended next steps

In order of leverage:

1. **Document the winning Fastify integration pattern** in ata's README and benchmarks: `addContentTypeParser(buffer) → JSON.parse → isValidObject`. Make the +10-23% delta visible and reproducible. This directly addresses Matteo's binary-dep argument with data.

2. **Bring the numbers to the Fastify thread.** The runtime benefit Matteo doubted is measurable. Whether it changes his default-validator stance is his call, but the evidence is real and worth presenting.

3. **(Optional) Open a separate spike** on simdjson-based parse-and-materialize that replaces V8 `JSON.parse`. This is architecturally interesting because Micro #2 confirmed simdjson walk is faster than V8 parse. But this is a much bigger build than fused parse+validate; estimate NAPI overhead first before committing.

**Do not build:** fused parse + validate + materialize. The microbench rules it out.
