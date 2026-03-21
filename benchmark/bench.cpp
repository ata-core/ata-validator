#include "ata.h"

#include <chrono>
#include <cstdio>
#include <string>

static const char* SCHEMA = R"({
  "type": "object",
  "properties": {
    "id": {"type": "integer", "minimum": 1},
    "name": {"type": "string", "minLength": 1, "maxLength": 100},
    "email": {"type": "string", "format": "email"},
    "age": {"type": "integer", "minimum": 0, "maximum": 150},
    "active": {"type": "boolean"},
    "tags": {
      "type": "array",
      "items": {"type": "string"},
      "uniqueItems": true,
      "maxItems": 10
    },
    "address": {
      "type": "object",
      "properties": {
        "street": {"type": "string"},
        "city": {"type": "string"},
        "zip": {"type": "string", "pattern": "^[0-9]{5}$"}
      },
      "required": ["street", "city"]
    }
  },
  "required": ["id", "name", "email", "active"]
})";

static const char* VALID_DOC = R"({
  "id": 42,
  "name": "Mert Can Altin",
  "email": "mert@example.com",
  "age": 28,
  "active": true,
  "tags": ["nodejs", "cpp", "performance"],
  "address": {
    "street": "123 Main St",
    "city": "Istanbul",
    "zip": "34000"
  }
})";

static const char* INVALID_DOC = R"({
  "id": -1,
  "name": "",
  "email": "not-an-email",
  "age": 200,
  "active": "yes",
  "tags": ["a", "a"],
  "address": {
    "zip": "abc"
  }
})";

template <typename Fn>
double bench(const char* label, int iterations, Fn fn) {
  // Warmup
  for (int i = 0; i < 100; ++i) fn();

  auto start = std::chrono::high_resolution_clock::now();
  for (int i = 0; i < iterations; ++i) {
    fn();
  }
  auto end = std::chrono::high_resolution_clock::now();
  double elapsed_ms =
      std::chrono::duration<double, std::milli>(end - start).count();
  double ops_per_sec = iterations / (elapsed_ms / 1000.0);

  printf("  %-40s %10.0f ops/sec  (%.2f ms total)\n", label, ops_per_sec,
         elapsed_ms);
  return ops_per_sec;
}

int main() {
  constexpr int N = 100000;

  printf("\n=== ata v%.*s Benchmark ===\n\n",
         static_cast<int>(ata::version().size()), ata::version().data());

  // Benchmark: schema compilation
  printf("Schema Compilation:\n");
  bench("compile schema", N, []() {
    auto s = ata::compile(SCHEMA);
    (void)s;
  });

  // Benchmark: validation with pre-compiled schema
  auto compiled = ata::compile(SCHEMA);

  printf("\nValidation (pre-compiled schema):\n");
  double valid_ops = bench("validate valid document", N, [&]() {
    auto r = ata::validate(compiled, VALID_DOC);
    (void)r;
  });

  double invalid_ops = bench("validate invalid document", N, [&]() {
    auto r = ata::validate(compiled, INVALID_DOC);
    (void)r;
  });

  // Benchmark: one-shot (compile + validate)
  printf("\nOne-shot (compile + validate):\n");
  bench("one-shot valid", N, []() {
    auto r = ata::validate(SCHEMA, VALID_DOC);
    (void)r;
  });

  // Benchmark: simple type check
  printf("\nSimple type check:\n");
  auto simple = ata::compile(R"({"type":"string"})");
  bench("type:string validate", N * 10, [&]() {
    auto r = ata::validate(simple, R"("hello")");
    (void)r;
  });

  printf("\n---\n");
  printf("Valid doc throughput:   %.0f validations/sec\n", valid_ops);
  printf("Invalid doc throughput: %.0f validations/sec\n", invalid_ops);
  printf("\n");

  return 0;
}
