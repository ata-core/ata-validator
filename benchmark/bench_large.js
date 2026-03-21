const { Validator } = require("../index");
const Ajv = require("ajv");
const addFormats = require("ajv-formats");

// Generate a larger, more realistic schema and data
const schema = {
  type: "object",
  properties: {
    users: {
      type: "array",
      items: {
        type: "object",
        properties: {
          id: { type: "integer", minimum: 1 },
          name: { type: "string", minLength: 1 },
          email: { type: "string", format: "email" },
          age: { type: "integer", minimum: 0, maximum: 150 },
          active: { type: "boolean" },
          role: { enum: ["admin", "user", "moderator"] },
          scores: {
            type: "array",
            items: { type: "number", minimum: 0, maximum: 100 },
            minItems: 1,
          },
          address: {
            type: "object",
            properties: {
              street: { type: "string" },
              city: { type: "string" },
              country: { type: "string" },
              zip: { type: "string" },
            },
            required: ["street", "city", "country"],
          },
        },
        required: ["id", "name", "email", "active", "role"],
      },
    },
    metadata: {
      type: "object",
      properties: {
        total: { type: "integer" },
        page: { type: "integer", minimum: 1 },
        perPage: { type: "integer", minimum: 1, maximum: 100 },
      },
      required: ["total", "page", "perPage"],
    },
  },
  required: ["users", "metadata"],
};

function makeData(userCount) {
  const users = [];
  for (let i = 0; i < userCount; i++) {
    users.push({
      id: i + 1,
      name: `User ${i}`,
      email: `user${i}@example.com`,
      age: 20 + (i % 50),
      active: i % 3 !== 0,
      role: ["admin", "user", "moderator"][i % 3],
      scores: [85, 92, 78, 95, 88],
      address: {
        street: `${100 + i} Main St`,
        city: "Istanbul",
        country: "Turkey",
        zip: "34000",
      },
    });
  }
  return { users, metadata: { total: userCount, page: 1, perPage: userCount } };
}

function bench(label, iterations, fn) {
  for (let i = 0; i < 100; i++) fn();
  const start = performance.now();
  for (let i = 0; i < iterations; i++) fn();
  const elapsed = performance.now() - start;
  const opsPerSec = iterations / (elapsed / 1000);
  console.log(
    `  ${label.padEnd(50)} ${Math.round(opsPerSec).toString().padStart(10)} ops/sec`
  );
  return opsPerSec;
}

const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const ajvValidate = ajv.compile(schema);

for (const count of [10, 50, 100, 500, 1000]) {
  const data = makeData(count);
  const jsonStr = JSON.stringify(data);
  const ataValidator = new Validator(schema);

  console.log(`\n--- ${count} users (${(jsonStr.length / 1024).toFixed(1)} KB JSON) ---`);

  const N = count >= 500 ? 1000 : count >= 100 ? 5000 : count >= 50 ? 10000 : 20000;

  const ajvOps = bench(`ajv  JSON.parse + validate`, N, () => {
    ajvValidate(JSON.parse(jsonStr));
  });

  const ataOps = bench(`ata  validateJSON (simdjson)`, N, () => {
    ataValidator.validateJSON(jsonStr);
  });

  const ratio = ataOps / ajvOps;
  if (ratio > 1) {
    console.log(`  >>> ata is ${ratio.toFixed(2)}x FASTER`);
  } else {
    console.log(`  >>> ajv is ${(1/ratio).toFixed(2)}x faster`);
  }
}
console.log();
