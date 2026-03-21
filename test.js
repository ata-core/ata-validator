const { Validator, validate, version } = require("./index");

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  PASS  ${name}`);
    passed++;
  } catch (e) {
    console.log(`  FAIL  ${name}: ${e.message}`);
    failed++;
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(msg || "assertion failed");
}

console.log(`\nata v${version()} - Node.js Binding Tests\n`);

// --- Validator class ---

test("Validator: valid document", () => {
  const v = new Validator({ type: "string" });
  const r = v.validate("hello");
  assert(r.valid, "should be valid");
});

test("Validator: invalid document", () => {
  const v = new Validator({ type: "string" });
  const r = v.validate(42);
  assert(!r.valid, "should be invalid");
  assert(r.errors.length > 0, "should have errors");
});

test("Validator: complex schema", () => {
  const v = new Validator({
    type: "object",
    properties: {
      name: { type: "string", minLength: 1 },
      age: { type: "integer", minimum: 0 },
    },
    required: ["name"],
  });

  const r1 = v.validate({ name: "Mert", age: 25 });
  assert(r1.valid, "valid doc should pass");

  const r2 = v.validate({ age: -1 });
  assert(!r2.valid, "missing required should fail");
});

test("Validator: accepts JS objects", () => {
  const v = new Validator({ type: "object" });
  const r = v.validate({ key: "value" });
  assert(r.valid, "should accept JS object");
});

// --- One-shot validate ---

test("validate(): one-shot valid", () => {
  const r = validate({ type: "number" }, 42);
  assert(r.valid);
});

test("validate(): one-shot invalid", () => {
  const r = validate({ type: "number" }, "hello");
  assert(!r.valid);
});

// --- Format validation ---

test("format: email", () => {
  const v = new Validator({ type: "string", format: "email" });
  assert(v.validate("user@example.com").valid);
  assert(!v.validate("not-email").valid);
});

test("format: date", () => {
  const v = new Validator({ type: "string", format: "date" });
  assert(v.validate("2026-03-21").valid);
  assert(!v.validate("nope").valid);
});

// --- Error details ---

test("error details include path and message", () => {
  const v = new Validator({
    type: "object",
    properties: {
      name: { type: "string" },
      age: { type: "integer" },
    },
  });
  const r = v.validate({ name: 123, age: "old" });
  assert(!r.valid);
  assert(r.errors.length >= 2, "should have at least 2 errors");
  assert(r.errors.some((e) => e.path.includes("name")));
  assert(r.errors.some((e) => e.path.includes("age")));
});

// --- Schema reuse ---

test("schema reuse across validations", () => {
  const v = new Validator({ type: "string", maxLength: 5 });
  assert(v.validate("hi").valid);
  assert(v.validate("hello").valid);
  assert(!v.validate("toolong").valid);
  assert(!v.validate(42).valid);
});

console.log(`\n${passed}/${passed + failed} tests passed.\n`);
process.exit(failed > 0 ? 1 : 0);
