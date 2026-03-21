const Ata = require("../compat");

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

console.log("\nata compat (ajv drop-in) Tests\n");

test("compile + validate (valid)", () => {
  const ata = new Ata();
  const validate = ata.compile({
    type: "object",
    properties: {
      foo: { type: "integer" },
      bar: { type: "string" },
    },
    required: ["foo"],
    additionalProperties: false,
  });

  const valid = validate({ foo: 1, bar: "abc" });
  assert(valid === true);
  assert(validate.errors === null);
});

test("compile + validate (invalid)", () => {
  const ata = new Ata();
  const validate = ata.compile({
    type: "object",
    properties: {
      foo: { type: "integer" },
    },
    required: ["foo"],
  });

  const valid = validate({});
  assert(valid === false);
  assert(Array.isArray(validate.errors));
  assert(validate.errors.length > 0);
  assert(typeof validate.errors[0].message === "string");
});

test("validate shorthand", () => {
  const ata = new Ata();
  assert(ata.validate({ type: "string" }, "hello") === true);
  assert(ata.validate({ type: "string" }, 42) === false);
});

test("addSchema + getSchema", () => {
  const ata = new Ata();
  ata.addSchema({ type: "string", minLength: 1 }, "name");
  const validate = ata.getSchema("name");
  assert(validate !== undefined);
  assert(validate("hello") === true);
  assert(validate("") === false);
});

test("schema reuse (ajv pattern)", () => {
  const ata = new Ata();
  const validate = ata.compile({ type: "number", minimum: 0 });
  assert(validate(42) === true);
  assert(validate(-1) === false);
  assert(validate(0) === true);
  // errors persist from last call
  validate(42);
  assert(validate.errors === null);
});

test("error format matches ajv", () => {
  const ata = new Ata();
  const validate = ata.compile({ type: "string" });
  validate(42);
  const err = validate.errors[0];
  assert("instancePath" in err);
  assert("message" in err);
  assert("params" in err);
});

console.log(`\n${passed}/${passed + failed} tests passed.\n`);
process.exit(failed > 0 ? 1 : 0);
