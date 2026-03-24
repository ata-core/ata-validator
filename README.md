# ata-validator

Ultra-fast JSON Schema validator powered by [simdjson](https://github.com/simdjson/simdjson). Multi-core parallel validation, RE2 regex, codegen bytecode engine. Standard Schema V1 compatible.

**[ata-validator.com](https://ata-validator.com)**

## Performance

### Single-Document Validation (valid data)

| Scenario | ata | ajv | |
|---|---|---|---|
| **validate(obj)** | 9.6M ops/sec | 8.5M ops/sec | **ata 1.1x faster** |
| **isValidObject(obj)** | 10.4M ops/sec | 9.3M ops/sec | **ata 1.1x faster** |
| **validateJSON(str)** | 1.9M ops/sec | 1.87M ops/sec | **ata 1.02x faster** |
| **isValidJSON(str)** | 1.9M ops/sec | 1.89M ops/sec | **ata 1.01x faster** |
| **Schema compilation** | 125,690 ops/sec | 831 ops/sec | **ata 151x faster** |

### Large Data — JS Object Validation

| Size | ata | ajv | |
|---|---|---|---|
| 10 users (2KB) | 6.2M ops/sec | 2.5M ops/sec | **ata 2.5x faster** |
| 100 users (20KB) | 658K ops/sec | 243K ops/sec | **ata 2.7x faster** |
| 1,000 users (205KB) | 64K ops/sec | 23.5K ops/sec | **ata 2.7x faster** |

### Parallel Batch Validation (multi-core)

| Batch Size | ata | ajv | |
|---|---|---|---|
| 1,000 items | 8.4M items/sec | 2.2M items/sec | **ata 3.9x faster** |
| 10,000 items | 12.5M items/sec | 2.1M items/sec | **ata 5.9x faster** |

> ajv is single-threaded (JS). ata uses all CPU cores via a persistent C++ thread pool.

### Where ajv wins

| Scenario | ata | ajv | |
|---|---|---|---|
| **validate(obj)** (invalid data, error collection) | 133K ops/sec | 7.5M ops/sec | **ajv 56x faster** |
| **validateJSON(str)** (invalid data) | 169K ops/sec | 2.3M ops/sec | **ajv 14x faster** |

> Invalid-data error collection goes through the C++ NAPI path. This is the slow path by design — production traffic is overwhelmingly valid.

### How it works

**Speculative validation**: For valid data (the common case), ata runs a JS codegen fast path entirely in V8 JIT — no NAPI boundary crossing. Only when validation fails does it fall through to the C++ engine for detailed error collection.

**JS codegen**: Schemas are compiled to monolithic JS functions (like ajv). Supported keywords: `type`, `required`, `properties`, `items`, `enum`, `const`, `allOf`, `anyOf`, `oneOf`, `not`, `if/then/else`, `uniqueItems`, `contains`, `prefixItems`, `additionalProperties`, `dependentRequired`, `minimum/maximum`, `minLength/maxLength`, `pattern`, `format`.

**V8 TurboFan optimizations**: Destructuring batch reads, `undefined` checks instead of `in` operator, context-aware type guard elimination, property hoisting to local variables.

**Adaptive simdjson**: For large documents (>8KB) with selective schemas, simdjson On Demand seeks only the needed fields — skipping irrelevant data at GB/s speeds.

### JSON Schema Test Suite

**98.5%** pass rate (938/952) on official [JSON Schema Test Suite](https://github.com/json-schema-org/JSON-Schema-Test-Suite) (Draft 2020-12).

## When to use ata

- **Any `validate(obj)` workload** — 1.1x–2.7x faster than ajv on valid data
- **Batch/streaming validation** — NDJSON log processing, data pipelines (5.9x faster)
- **Schema-heavy startup** — many schemas compiled at boot (151x faster compile)
- **C/C++ embedding** — native library, no JS runtime needed

## When to use ajv

- **Error-heavy workloads** — where most data is invalid and error details matter
- **Schemas with `$ref`, `patternProperties`, `dependentSchemas`** — these bypass JS codegen and hit the slower NAPI path

## Features

- **Speculative validation**: JS codegen fast path — valid data never crosses the NAPI boundary
- **Multi-core**: Parallel validation across all CPU cores — 12.5M validations/sec
- **simdjson**: SIMD-accelerated JSON parsing at GB/s speeds, adaptive On Demand for large docs
- **RE2 regex**: Linear-time guarantees, immune to ReDoS attacks
- **V8-optimized codegen**: Destructuring batch reads, type guard elimination, property hoisting
- **Standard Schema V1**: Compatible with Fastify, tRPC, TanStack, Drizzle
- **Zero-copy paths**: Buffer and pre-padded input support — no unnecessary copies
- **C/C++ library**: Native API for non-Node.js environments
- **98.5% spec compliant**: Draft 2020-12

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
    age: { type: 'integer', minimum: 0 }
  },
  required: ['name', 'email']
});

// Fast boolean check — JS codegen, no NAPI (1.1x faster than ajv)
v.isValidObject({ name: 'Mert', email: 'mert@example.com', age: 26 }); // true

// Full validation with error details
const result = v.validate({ name: 'Mert', email: 'mert@example.com', age: 26 });
console.log(result.valid); // true
console.log(result.errors); // []

// JSON string validation (simdjson fast path)
v.validateJSON('{"name": "Mert", "email": "mert@example.com"}');
v.isValidJSON('{"name": "Mert", "email": "mert@example.com"}'); // true

// Buffer input (zero-copy, raw NAPI)
v.isValid(Buffer.from('{"name": "Mert", "email": "mert@example.com"}'));

// Parallel batch — multi-core, NDJSON (5.9x faster than ajv)
const ndjson = Buffer.from(lines.join('\n'));
v.isValidParallel(ndjson);  // bool[]
v.countValid(ndjson);        // number
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
fastify.register(require('fastify-ata'));

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
