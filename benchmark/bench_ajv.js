const Ajv = require("ajv");
const addFormats = require("ajv-formats");

const schema = {
  type: "object",
  properties: {
    id: { type: "integer", minimum: 1 },
    name: { type: "string", minLength: 1, maxLength: 100 },
    email: { type: "string", format: "email" },
    age: { type: "integer", minimum: 0, maximum: 150 },
    active: { type: "boolean" },
    tags: {
      type: "array",
      items: { type: "string" },
      uniqueItems: true,
      maxItems: 10,
    },
    address: {
      type: "object",
      properties: {
        street: { type: "string" },
        city: { type: "string" },
        zip: { type: "string", pattern: "^[0-9]{5}$" },
      },
      required: ["street", "city"],
    },
  },
  required: ["id", "name", "email", "active"],
};

const validDoc = {
  id: 42,
  name: "Mert Can Altin",
  email: "mert@example.com",
  age: 28,
  active: true,
  tags: ["nodejs", "cpp", "performance"],
  address: {
    street: "123 Main St",
    city: "Istanbul",
    zip: "34000",
  },
};

const invalidDoc = {
  id: -1,
  name: "",
  email: "not-an-email",
  age: 200,
  active: "yes",
  tags: ["a", "a"],
  address: {
    zip: "abc",
  },
};

const N = 100000;

function bench(label, fn) {
  // Warmup
  for (let i = 0; i < 100; i++) fn();

  const start = performance.now();
  for (let i = 0; i < N; i++) fn();
  const elapsed = performance.now() - start;
  const opsPerSec = N / (elapsed / 1000);
  console.log(
    `  ${label.padEnd(40)} ${Math.round(opsPerSec).toString().padStart(10)} ops/sec  (${elapsed.toFixed(2)} ms total)`
  );
  return opsPerSec;
}

console.log("\n=== ajv Benchmark ===\n");

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);

// Schema compilation (reduced iterations - ajv compile is heavy)
console.log("Schema Compilation:");
{
  const compileN = 1000;
  for (let i = 0; i < 10; i++) { const a = new Ajv({allErrors:true}); addFormats(a); a.compile(schema); }
  const start = performance.now();
  for (let i = 0; i < compileN; i++) { const a = new Ajv({allErrors:true}); addFormats(a); a.compile(schema); }
  const elapsed = performance.now() - start;
  const opsPerSec = compileN / (elapsed / 1000);
  console.log(`  ${"compile schema".padEnd(40)} ${Math.round(opsPerSec).toString().padStart(10)} ops/sec  (${elapsed.toFixed(2)} ms total)`);
}

// Pre-compiled validation
const validate = ajv.compile(schema);

console.log("\nValidation (pre-compiled schema):");
const validOps = bench("validate valid document", () => {
  validate(validDoc);
});

const invalidOps = bench("validate invalid document", () => {
  validate(invalidDoc);
});

// Simple type check
console.log("\nSimple type check:");
const simpleValidate = ajv.compile({ type: "string" });
const simpleN = N * 10;
{
  for (let i = 0; i < 100; i++) simpleValidate("hello");
  const start = performance.now();
  for (let i = 0; i < simpleN; i++) simpleValidate("hello");
  const elapsed = performance.now() - start;
  const opsPerSec = simpleN / (elapsed / 1000);
  console.log(
    `  ${"type:string validate".padEnd(40)} ${Math.round(opsPerSec).toString().padStart(10)} ops/sec  (${elapsed.toFixed(2)} ms total)`
  );
}

console.log("\n---");
console.log(`Valid doc throughput:   ${Math.round(validOps)} validations/sec`);
console.log(
  `Invalid doc throughput: ${Math.round(invalidOps)} validations/sec`
);
console.log();
