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

test("a custom keyword named __proto__ reaches the validator", () => {
  // The keyword map handed to the Validator was a plain object, so a keyword
  // with that name set its prototype instead of being forwarded, and the
  // keyword silently did nothing.
  const ata = new Ata();
  ata.addKeyword({ keyword: "__proto__", validate: () => false });
  const forwarded = ata._validatorOptions().keywords || {};
  assert(Object.prototype.hasOwnProperty.call(forwarded, "__proto__"), "forwarded as an own key");
  const validate = ata.compile(JSON.parse('{"type":"number","__proto__":true}'));
  assert(validate(1) === false, "the keyword rejects");
});

test("useDefaults applies a schema once per object, not once per path to it", () => {
  // n_i = allOf [n_(i-1), n_(i-1)]: the referenced-defaults walk followed
  // every edge and visited the bottom definition 2^n times on one object.
  // The verdict on generated code follows every edge too (a separate cost,
  // not this pass's), so the pass is held to the verdict: with defaults on, a
  // call costs about what it costs with them off.
  const defs = { n0: { type: "object", properties: { x: { type: "number", default: 1 } } } };
  for (let i = 1; i <= 18; i++) defs["n" + i] = { allOf: [{ $ref: "#/$defs/n" + (i - 1) }, { $ref: "#/$defs/n" + (i - 1) }] };
  const schema = { $ref: "#/$defs/n18", $defs: defs };
  const time = (useDefaults) => {
    const f = new Ata({ useDefaults }).compile(schema);
    f({ x: 1 });
    let best = Infinity;
    let d;
    for (let r = 0; r < 3; r++) {
      d = {};
      const t0 = process.hrtime.bigint();
      assert(f(d) === true, "valid");
      best = Math.min(best, Number(process.hrtime.bigint() - t0) / 1e6);
    }
    return { ms: best, d };
  };
  const on = time(true);
  const off = time(false);
  assert(on.d.x === 1, "the default is filled");
  assert(off.d.x === undefined, "and not without useDefaults");
  assert(on.ms < 2 * off.ms + 20, `with defaults ${on.ms.toFixed(0)} ms, without ${off.ms.toFixed(0)} ms`);
});

console.log(`\n${passed}/${passed + failed} tests passed.\n`);
process.exit(failed > 0 ? 1 : 0);
