# ata-validator

Ultra-fast JSON Schema validator powered by [simdjson](https://github.com/simdjson/simdjson). Multi-core parallel validation, RE2 regex, codegen bytecode engine. Standard Schema V1 compatible.

**[ata-validator.com](https://ata-validator.com)**

## Performance

### Single-Document Validation (valid data)

| Scenario | ata | ajv | |
|---|---|---|---|
| **validate(obj)** | 15M ops/sec | 8.5M ops/sec | **ata 1.8x faster** |
| **isValidObject(obj)** | 17.4M ops/sec | 9.4M ops/sec | **ata 1.8x faster** |
| **validateJSON(str)** | 2.1M ops/sec | 1.9M ops/sec | **ata 1.1x faster** |
| **isValidJSON(str)** | 2.0M ops/sec | 1.9M ops/sec | **ata 1.1x faster** |
| **Schema compilation** | 125,690 ops/sec | 831 ops/sec | **ata 151x faster** |

### Large Data — JS Object Validation

| Size | ata | ajv | |
|---|---|---|---|
| 10 users (2KB) | 6.2M ops/sec | 2.5M ops/sec | **ata 2.5x faster** |
| 100 users (20KB) | 658K ops/sec | 243K ops/sec | **ata 2.7x faster** |
| 1,000 users (205KB) | 64K ops/sec | 23.5K ops/sec | **ata 2.7x faster** |

### Real-World Scenarios

| Scenario | ata | ajv | |
|---|---|---|---|
| **Serverless cold start** (50 schemas) | 7.7ms | 96ms | **ata 12.5x faster** |
| **ReDoS protection** (`^(a+)+$`) | 0.3ms | 765ms | **ata immune (RE2)** |
| **Batch NDJSON** (10K items, multi-core) | 13.4M/sec | 5.1M/sec | **ata 2.6x faster** |
| **Fastify HTTP** (100 users POST) | 24.6K req/sec | 22.6K req/sec | **ata 9% faster** |

### Where ajv wins

| Scenario | ata | ajv | |
|---|---|---|---|
| **validate(obj)** (invalid data) | 6M ops/sec | 7.9M ops/sec | **ajv 1.3x faster** |
| **validateJSON(str)** (invalid data) | 2.2M ops/sec | 2.3M ops/sec | **ajv 1.1x faster** |

> Invalid-data error path — ajv is slightly faster. Production traffic is overwhelmingly valid.

### How it works

**Speculative validation**: For valid data (the common case), ata runs a JS codegen fast path entirely in V8 JIT — no NAPI boundary crossing. Only when validation fails does it fall through to the JS error-collecting codegen or C++ engine.

**JS codegen**: Schemas are compiled to monolithic JS functions (like ajv). Supported keywords: `type`, `required`, `properties`, `items`, `enum`, `const`, `allOf`, `anyOf`, `oneOf`, `not`, `if/then/else`, `uniqueItems`, `contains`, `prefixItems`, `additionalProperties`, `dependentRequired`, `$ref` (local), `minimum/maximum`, `minLength/maxLength`, `pattern`, `format`.

**V8 TurboFan optimizations**: Destructuring batch reads, `undefined` checks instead of `in` operator, context-aware type guard elimination, property hoisting to local variables, tiered uniqueItems (nested loop for small arrays).

**Adaptive simdjson**: For large documents (>8KB) with selective schemas, simdjson On Demand seeks only the needed fields — skipping irrelevant data at GB/s speeds.

### JSON Schema Test Suite

**98.4%** pass rate (937/952) on official [JSON Schema Test Suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite) (Draft 2020-12).

## When to use ata

- **Any `validate(obj)` workload** — 1.8x–2.7x faster than ajv on valid data
- **Serverless / cold starts** — 12.5x faster schema compilation
- **Security-sensitive apps** — RE2 regex, immune to ReDoS attacks
- **Batch/streaming validation** — NDJSON log processing, data pipelines (2.6x faster)
- **Standard Schema V1** — native support for Fastify v5, tRPC, TanStack
- **C/C++ embedding** — native library, no JS runtime needed

## When to use ajv

- **Error-heavy workloads** — where most data is invalid (ajv 1.3x faster on error path)
- **Schemas with `patternProperties`, `dependentSchemas`** — these bypass JS codegen

## Features

- **Speculative validation**: JS codegen fast path — valid data never crosses the NAPI boundary
- **Multi-core**: Parallel validation across all CPU cores — 13.4M validations/sec
- **simdjson**: SIMD-accelerated JSON parsing at GB/s speeds, adaptive On Demand for large docs
- **RE2 regex**: Linear-time guarantees, immune to ReDoS attacks (2391x faster on pathological input)
- **V8-optimized codegen**: Destructuring batch reads, type guard elimination, property hoisting
- **Standard Schema V1**: Compatible with Fastify, tRPC, TanStack, Drizzle
- **Zero-copy paths**: Buffer and pre-padded input support — no unnecessary copies
- **Defaults + coercion**: `default` values, `coerceTypes`, `removeAdditional` support
- **C/C++ library**: Native API for non-Node.js environments
- **98.4% spec compliant**: Draft 2020-12

## Installation

```bash
npm install ata-validator
```

## Usage

### Node.js

```javascript
const { Validator } = require('ata-validator');

const v = new Validator({
  type: 'object',
  properties: {
    name: { type: 'string', minLength: 1 },
    email: { type: 'string', format: 'email' },
    age: { type: 'integer', minimum: 0 },
    role: { type: 'string', default: 'user' }
  },
  required: ['name', 'email']
});

// Fast boolean check — JS codegen, no NAPI (1.8x faster than ajv)
v.isValidObject({ name: 'Mert', email: 'mert@example.com', age: 26 }); // true

// Full validation with error details + defaults applied
const result = v.validate({ name: 'Mert', email: 'mert@example.com' });
// result.valid === true, data.role === 'user' (default applied)

// JSON string validation (simdjson fast path)
v.validateJSON('{"name": "Mert", "email": "mert@example.com"}');
v.isValidJSON('{"name": "Mert", "email": "mert@example.com"}'); // true

// Buffer input (zero-copy, raw NAPI)
v.isValid(Buffer.from('{"name": "Mert", "email": "mert@example.com"}'));

// Parallel batch — multi-core, NDJSON (2.6x faster than ajv)
const ndjson = Buffer.from(lines.join('\n'));
v.isValidParallel(ndjson);  // bool[]
v.countValid(ndjson);        // number
```

### Options

```javascript
const v = new Validator(schema, {
  coerceTypes: true,       // "42" → 42 for integer fields
  removeAdditional: true,  // strip properties not in schema
});
```

### Standard Schema V1

```javascript
const v = new Validator(schema);

// Works with Fastify, tRPC, TanStack, etc.
const result = v['~standard'].validate(data);
// { value: data } on success
// { issues: [{ message, path }] } on failure
```

### Fastify Plugin

```bash
npm install fastify-ata
```

```javascript
const fastify = require('fastify')();
fastify.register(require('fastify-ata'), {
  coerceTypes: true,
  removeAdditional: true,
});

// All existing JSON Schema route definitions work as-is
```

### C++

```cpp
#include "ata.h"

auto schema = ata::compile(R"({
  "type": "object",
  "properties": { "name": {"type": "string"} },
  "required": ["name"]
})");

auto result = ata::validate(schema, R"({"name": "Mert"})");
// result.valid == true
```

## Supported Keywords

| Category | Keywords |
|----------|----------|
| Type | `type` |
| Numeric | `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf` |
| String | `minLength`, `maxLength`, `pattern`, `format` |
| Array | `items`, `prefixItems`, `minItems`, `maxItems`, `uniqueItems`, `contains`, `minContains`, `maxContains` |
| Object | `properties`, `required`, `additionalProperties`, `patternProperties`, `minProperties`, `maxProperties`, `propertyNames`, `dependentRequired`, `dependentSchemas` |
| Enum/Const | `enum`, `const` |
| Composition | `allOf`, `anyOf`, `oneOf`, `not` |
| Conditional | `if`, `then`, `else` |
| References | `$ref`, `$defs`, `definitions`, `$id` |
| Boolean | `true`, `false` |

### Format Validators (hand-written, no regex)

`email`, `date`, `date-time`, `time`, `uri`, `uri-reference`, `ipv4`, `ipv6`, `uuid`, `hostname`

## Building from Source

```bash
# C++ library + tests
cmake -B build
cmake --build build
./build/ata_tests

# Node.js addon
npm install
npm run build
npm test

# JSON Schema Test Suite
npm run test:suite
```

## License

MIT

## Author

[Mert Can Altin](https://github.com/mertcanaltin)
