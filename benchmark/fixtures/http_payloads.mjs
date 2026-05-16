// Deterministic HTTP payload generator for the materialization measurement.
// Three sizes: small (~500B), medium (~5KB), large (~50KB).
// Schema reused from bench_fastify_pipeline.js for parity with existing benches.

const userSchema = {
  type: 'object',
  properties: {
    id: { type: 'integer', minimum: 1 },
    name: { type: 'string', minLength: 1, maxLength: 100 },
    email: { type: 'string', format: 'email' },
    age: { type: 'integer', minimum: 0, maximum: 150 },
    active: { type: 'boolean' },
  },
  required: ['id', 'name', 'email', 'active'],
}

const arraySchema = {
  type: 'array',
  items: userSchema,
  minItems: 1,
}

// Mulberry32 — small seeded PRNG, deterministic across runs.
function mulberry32(seed) {
  return function () {
    let t = (seed += 0x6d2b79f5)
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeUser(rng, i) {
  return {
    id: i + 1,
    name: 'User ' + i.toString(36).padStart(4, '0'),
    email: 'user' + i + '@example.com',
    age: Math.floor(rng() * 80) + 18,
    active: rng() > 0.3,
  }
}

export function make(size) {
  const rng = mulberry32(42)
  if (size === 'small') {
    const obj = makeUser(rng, 0)
    return {
      schema: userSchema,
      validObj: obj,
      validJson: JSON.stringify(obj),
      validBuf: Buffer.from(JSON.stringify(obj)),
    }
  }
  const count = size === 'medium' ? 50 : 500
  const arr = []
  for (let i = 0; i < count; i++) arr.push(makeUser(rng, i))
  const json = JSON.stringify(arr)
  return {
    schema: arraySchema,
    validObj: arr,
    validJson: json,
    validBuf: Buffer.from(json),
  }
}

export const SIZES = ['small', 'medium', 'large']
