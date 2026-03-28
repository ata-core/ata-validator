// typebox 1.x is ESM only, so this benchmark uses .mjs
// tests with format validators (email) since typebox 1.x supports them

import { createRequire } from "module";
const require = createRequire(import.meta.url);

const { Validator } = require("../index.js");

const Type = (await import("typebox")).default;
const { Compile } = await import("typebox/compile");

const ataSchema = {
  type: "object",
  properties: {
    id: { type: "integer", minimum: 1 },
    name: { type: "string", minLength: 1, maxLength: 100 },
    email: { type: "string", format: "email" },
    age: { type: "integer", minimum: 0, maximum: 150 },
    active: { type: "boolean" },
  },
  required: ["id", "name", "email", "age", "active"],
  additionalProperties: false,
};

const tbSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    name: Type.String({ minLength: 1, maxLength: 100 }),
    email: Type.String({ format: "email" }),
    age: Type.Integer({ minimum: 0, maximum: 150 }),
    active: Type.Boolean(),
  },
  { additionalProperties: false },
);

const validDoc = {
  id: 42,
  name: "Mert",
  email: "mert@example.com",
  age: 26,
  active: true,
};
const invalidDoc = {
  id: -1,
  name: "",
  email: "not-an-email",
  age: 200,
  active: "yes",
};

// verify both produce correct results
const ataV = new Validator(ataSchema);
ataV.validate(validDoc);
const tbV = Compile(tbSchema);

console.log("correctness check:");
console.log(
  "  ata  valid:",
  ataV.validate(validDoc).valid,
  " invalid:",
  ataV.validate(invalidDoc).valid,
);
console.log(
  "  tb   valid:",
  tbV.Check(validDoc),
  " invalid:",
  tbV.Check(invalidDoc),
);
console.log();

const N = 500000;

function bench(label, fn) {
  for (let i = 0; i < 50000; i++) fn();
  const results = [];
  for (let r = 0; r < 3; r++) {
    const s = performance.now();
    for (let i = 0; i < N; i++) fn();
    results.push(N / ((performance.now() - s) / 1000));
  }
  results.sort((a, b) => b - a);
  const ops = Math.round(results[1]);
  console.log(`  ${label.padEnd(45)} ${ops.toLocaleString().padStart(15)} ops/sec`);
  return ops;
}

function benchCompile(label, fn) {
  for (let i = 0; i < 10; i++) fn();
  const CN = 1000;
  const s = performance.now();
  for (let i = 0; i < CN; i++) fn();
  const elapsed = performance.now() - s;
  const ops = Math.round(CN / (elapsed / 1000));
  console.log(`  ${label.padEnd(45)} ${ops.toLocaleString().padStart(15)} ops/sec`);
  return ops;
}

function ratio(a, b) {
  const r = a / b;
  if (r >= 1) return `ata ${r.toFixed(1)}x faster`;
  return `typebox ${(1 / r).toFixed(1)}x faster`;
}

console.log("==========================================================");
console.log("  ata vs typebox 1.x (with format validators)");
console.log("==========================================================\n");

console.log("1. Boolean check (valid):\n");
const ataB = bench("ata  isValidObject(obj)", () => ataV.isValidObject(validDoc));
const tbB = bench("typebox  Check(obj)", () => tbV.Check(validDoc));

console.log("\n2. Boolean check (invalid):\n");
const ataBi = bench("ata  isValidObject(obj)", () => ataV.isValidObject(invalidDoc));
const tbBi = bench("typebox  Check(obj)", () => tbV.Check(invalidDoc));

console.log("\n3. Compile:\n");
const ataC = benchCompile("ata  new Validator(schema)", () => new Validator(ataSchema));
const tbC = benchCompile("typebox  Compile(schema)", () => Compile(tbSchema));

console.log("\n4. First validation (compile + check):\n");
const ataF = benchCompile("ata  new Validator + isValidObject", () => {
  const v = new Validator(ataSchema);
  v.isValidObject(validDoc);
});
const tbF = benchCompile("typebox  Compile + Check", () => {
  const c = Compile(tbSchema);
  c.Check(validDoc);
});

console.log("\n==========================================================");
console.log("  Summary");
console.log("==========================================================\n");
console.log(`  Boolean (valid):     ${ratio(ataB, tbB)}`);
console.log(`  Boolean (invalid):   ${ratio(ataBi, tbBi)}`);
console.log(`  Compile:             ${ratio(ataC, tbC)}`);
console.log(`  First validation:    ${ratio(ataF, tbF)}`);
console.log("\n  Schema includes format: 'email' on both sides.\n");
