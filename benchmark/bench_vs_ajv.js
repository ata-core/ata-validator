const { Validator } = require("../index");
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
  address: { street: "123 Main St", city: "Istanbul", zip: "34000" },
};

const invalidDoc = {
  id: -1,
  name: "",
  email: "not-an-email",
  age: 200,
  active: "yes",
  tags: ["a", "a"],
  address: { zip: "abc" },
};

const N = 100000;

function bench(label, fn) {
  for (let i = 0; i < 1000; i++) fn(); // warmup
  const start = performance.now();
  for (let i = 0; i < N; i++) fn();
  const elapsed = performance.now() - start;
  const opsPerSec = N / (elapsed / 1000);
  console.log(
    `  ${label.padEnd(45)} ${Math.round(opsPerSec).toString().padStart(10)} ops/sec  (${elapsed.toFixed(2)} ms)`
  );
  return opsPerSec;
}

console.log("\n========================================");
console.log("  ata vs ajv - Fair Comparison Benchmark");
console.log("  Both validating JS objects directly");
console.log("========================================\n");

// --- Schema Compilation ---
console.log("Schema Compilation:");

bench("ata  compile", () => {
  new Validator(schema);
});

bench("ajv  compile", () => {
  const a = new Ajv({ allErrors: true });
  addFormats(a);
  a.compile(schema);
});

// --- Pre-compiled Validation (JS objects) ---
const ataValidator = new Validator(schema);
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const ajvValidate = ajv.compile(schema);

console.log("\nValidation - Valid Document (JS object):");
const ataValidOps = bench("ata  validate(jsObject)", () => {
  ataValidator.validate(validDoc);
});
const ajvValidOps = bench("ajv  validate(jsObject)", () => {
  ajvValidate(validDoc);
});

console.log("\nValidation - Invalid Document (JS object):");
const ataInvalidOps = bench("ata  validate(jsObject)", () => {
  ataValidator.validate(invalidDoc);
});
const ajvInvalidOps = bench("ajv  validate(jsObject)", () => {
  ajvValidate(invalidDoc);
});

// --- Simple type check ---
console.log("\nSimple Type Check:");
const ataSimple = new Validator({ type: "string" });
const ajvSimple = ajv.compile({ type: "string" });

bench("ata  type:string", () => {
  ataSimple.validate("hello");
});
bench("ajv  type:string", () => {
  ajvSimple("hello");
});

// --- Summary ---
console.log("\n========================================");
console.log("  Summary");
console.log("========================================");
console.log(
  `  Valid doc:   ata ${Math.round(ataValidOps).toLocaleString()} vs ajv ${Math.round(ajvValidOps).toLocaleString()} ops/sec`
);
console.log(
  `  Invalid doc: ata ${Math.round(ataInvalidOps).toLocaleString()} vs ajv ${Math.round(ajvInvalidOps).toLocaleString()} ops/sec`
);

const validRatio = ataValidOps / ajvValidOps;
const invalidRatio = ataInvalidOps / ajvInvalidOps;
if (validRatio > 1) {
  console.log(`  ata is ${validRatio.toFixed(1)}x FASTER on valid docs`);
} else {
  console.log(
    `  ajv is ${(1 / validRatio).toFixed(1)}x faster on valid docs`
  );
}
if (invalidRatio > 1) {
  console.log(`  ata is ${invalidRatio.toFixed(1)}x FASTER on invalid docs`);
} else {
  console.log(
    `  ajv is ${(1 / invalidRatio).toFixed(1)}x faster on invalid docs`
  );
}
console.log();
