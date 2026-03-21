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

const validJsonStr = JSON.stringify(validDoc);

const N = 100000;

function bench(label, iterations, fn) {
  for (let i = 0; i < 1000; i++) fn();
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = performance.now() - start;
  const opsPerSec = iterations / (elapsed / 1000);
  console.log(
    `  ${label.padEnd(55)} ${Math.round(opsPerSec).toString().padStart(10)} ops/sec`
  );
  return opsPerSec;
}

console.log("\n=============================================");
console.log("  JSON String Input: ata (simdjson) vs ajv");
console.log("  Scenario: validate incoming JSON strings");
console.log("  (API gateway, webhook, file processing)");
console.log("=============================================\n");

// --- ajv: JSON.parse + validate ---
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const ajvValidate = ajv.compile(schema);

console.log("ajv: JSON.parse() + validate()");
const ajvOps = bench("ajv  JSON.parse + validate", N, () => {
  const data = JSON.parse(validJsonStr);
  ajvValidate(data);
});

// --- ata: validateJSON (simdjson parse + validate, all in C++) ---
const ataValidator = new Validator(schema);

console.log("\nata: validateJSON() (simdjson, zero JS overhead)");
const ataJsonOps = bench("ata  validateJSON (simdjson path)", N, () => {
  ataValidator.validateJSON(validJsonStr);
});

// --- ata: V8 direct (for comparison) ---
console.log("\nata: validate() with JS object (V8 direct)");
const ataDirectOps = bench("ata  validate(jsObject)", N, () => {
  ataValidator.validate(validDoc);
});

// --- ajv: pre-parsed object (for comparison) ---
console.log("\najv: validate() with JS object (best case)");
const ajvDirectOps = bench("ajv  validate(jsObject)", N, () => {
  ajvValidate(validDoc);
});

console.log("\n=============================================");
console.log("  Summary — JSON string validation");
console.log("=============================================");

const ratio = ataJsonOps / ajvOps;
if (ratio > 1) {
  console.log(`  ata is ${ratio.toFixed(1)}x FASTER than ajv on JSON strings`);
} else {
  console.log(`  ajv is ${(1/ratio).toFixed(1)}x faster than ata on JSON strings`);
}
console.log(`  ata simdjson:  ${Math.round(ataJsonOps).toLocaleString()} ops/sec`);
console.log(`  ajv parse+val: ${Math.round(ajvOps).toLocaleString()} ops/sec`);
console.log();
