// Pure validation benchmark for profiling with xctrace — nothing else.
// Usage: node profile_validate.js [valid|invalid|bool-valid|bool-invalid]
const { Validator } = require('../index');

const schema = {
  type: 'object',
  properties: {
    id: { type: 'integer', minimum: 1 },
    name: { type: 'string', minLength: 1, maxLength: 100 },
    email: { type: 'string', format: 'email' },
    age: { type: 'integer', minimum: 0, maximum: 150 },
    active: { type: 'boolean' },
    tags: { type: 'array', items: { type: 'string' }, uniqueItems: true, maxItems: 10 },
    address: {
      type: 'object',
      properties: { street: { type: 'string' }, city: { type: 'string' }, zip: { type: 'string', pattern: '^[0-9]{5}$' } },
      required: ['street', 'city'],
    },
  },
  required: ['id', 'name', 'email', 'active'],
};

const validDoc = {
  id: 42, name: 'Mert', email: 'mert@example.com', age: 26, active: true,
  tags: ['nodejs', 'cpp', 'perf'], address: { street: 'Main St', city: 'Istanbul', zip: '34000' },
};

const invalidDoc = {
  id: -1, name: '', email: 'not-an-email', age: 200, active: 'yes',
  tags: ['a', 'a'], address: { zip: 'abc' },
};

const v = new Validator(schema);

// Warmup — trigger JIT
for (let i = 0; i < 1000; i++) {
  v.validate(validDoc);
  v.validate(invalidDoc);
  v.isValidObject(validDoc);
  v.isValidObject(invalidDoc);
}

const N = 5_000_000;
const mode = process.argv[2] || 'valid';

console.log(`Profiling: ${mode}, ${N} iterations`);
const start = performance.now();

if (mode === 'valid') {
  for (let i = 0; i < N; i++) v.validate(validDoc);
} else if (mode === 'invalid') {
  for (let i = 0; i < N; i++) v.validate(invalidDoc);
} else if (mode === 'bool-valid') {
  for (let i = 0; i < N; i++) v.isValidObject(validDoc);
} else if (mode === 'bool-invalid') {
  for (let i = 0; i < N; i++) v.isValidObject(invalidDoc);
}

const ms = performance.now() - start;
const nsPerOp = (ms * 1e6) / N;
console.log(`${nsPerOp.toFixed(2)} ns/op | ${Math.round(N / (ms / 1000)).toLocaleString()} ops/sec | ${ms.toFixed(0)}ms total`);
