// NOTE: this is not an apples-to-apples comparison.
// typebox is a TypeScript type builder, ata is a JSON Schema validator.
// they solve different problems. this benchmark exists because people
// asked "how fast is it compared to typebox?" and we want to answer
// that honestly with real numbers.
//
// format validators (email, date, uuid) are excluded because typebox
// doesn't support them. error reporting is excluded because typebox
// returns boolean only. this keeps it fair.

const { Validator } = require("../index");
const { Type } = require("@sinclair/typebox");
const { TypeCompiler } = require("@sinclair/typebox/compiler");

const ataSchema = {
  type: "object",
  properties: {
    id: { type: "integer", minimum: 1 },
    name: { type: "string", minLength: 1, maxLength: 100 },
    age: { type: "integer", minimum: 0, maximum: 150 },
    active: { type: "boolean" },
  },
  required: ["id", "name", "age", "active"],
  additionalProperties: false,
};

const tbSchema = Type.Object(
  {
    id: Type.Integer({ minimum: 1 }),
    name: Type.String({ minLength: 1, maxLength: 100 }),
    age: Type.Integer({ minimum: 0, maximum: 150 }),
    active: Type.Boolean(),
  },
  { additionalProperties: false },
);

const validDoc = { id: 42, name: "Mert", age: 26, active: true };
const invalidDoc = { id: -1, name: "", age: 200, active: "yes" };

// note: format validators (email, date, uuid) excluded because typebox
// doesn't support them. this keeps the comparison fair.

const N = 500000;

function bench(label, fn) {
  for (let i = 0; i < 50000; i++) fn();
  const start = performance.now();
  for (let i = 0; i < N; i++) fn();
  const elapsed = performance.now() - start;
  const ops = Math.round(N / (elapsed / 1000));
  console.log(
    `  ${label.padEnd(45)} ${ops.toString().padStart(15)} ops/sec`,
  );
  return ops;
}

function benchCompile(label, fn) {
  for (let i = 0; i < 10; i++) fn();
  const CN = 1000;
  const start = performance.now();
  for (let i = 0; i < CN; i++) fn();
  const elapsed = performance.now() - start;
  const ops = Math.round(CN / (elapsed / 1000));
  console.log(
    `  ${label.padEnd(45)} ${ops.toString().padStart(15)} ops/sec`,
  );
  return ops;
}

const ataValidator = new Validator(ataSchema);
ataValidator.isValidObject(validDoc); // trigger compile
const tbValidator = TypeCompiler.Compile(tbSchema);

console.log("==========================================================");
console.log("  ata vs typebox (no format validators, fair comparison)");
console.log("==========================================================\n");

console.log("1. Boolean check (valid data):\n");
const ataB = bench("ata  isValidObject(obj)", () =>
  ataValidator.isValidObject(validDoc),
);
const tbB = bench("typebox  Check(obj)", () => tbValidator.Check(validDoc));

console.log("\n2. Boolean check (invalid data):\n");
const ataBi = bench("ata  isValidObject(obj)", () =>
  ataValidator.isValidObject(invalidDoc),
);
const tbBi = bench("typebox  Check(obj)", () =>
  tbValidator.Check(invalidDoc),
);

console.log("\n3. Compile speed:\n");
const ataC = benchCompile("ata  new Validator(schema)", () =>
  new Validator(ataSchema),
);
const tbC = benchCompile("typebox  TypeCompiler.Compile(schema)", () =>
  TypeCompiler.Compile(tbSchema),
);

console.log("\n4. First validation (compile + check):\n");
const ataF = benchCompile("ata  new Validator + isValidObject", () => {
  const v = new Validator(ataSchema);
  v.isValidObject(validDoc);
});
const tbF = benchCompile("typebox  Compile + Check", () => {
  const c = TypeCompiler.Compile(tbSchema);
  c.Check(validDoc);
});

console.log("\n==========================================================");
console.log("  Summary");
console.log("==========================================================\n");

function ratio(a, b) {
  const r = a / b;
  if (r >= 1) return `ata ${r.toFixed(1)}x faster`;
  return `typebox ${(1 / r).toFixed(1)}x faster`;
}

console.log(`  Boolean (valid):     ${ratio(ataB, tbB)}`);
console.log(`  Boolean (invalid):   ${ratio(ataBi, tbBi)}`);
console.log(`  Compile:             ${ratio(ataC, tbC)}`);
console.log(`  First validation:    ${ratio(ataF, tbF)}`);

console.log(
  "\n  Note: format validators (email, date, uuid) not included.",
);
console.log("  typebox doesn't support them, so they were excluded");
console.log("  to keep the comparison fair.\n");
