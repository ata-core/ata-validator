'use strict';

// Ten shapes that actually break in production. Each case carries both a
// parsed object and the JSON text it came from, so the score can be measured
// on the text path and the object path separately.
const RAW = [
  {
    name: 'missing-required-key',
    schema: { type: 'object', required: ['name', 'email'], properties: { name: { type: 'string' }, email: { type: 'string' } } },
    json: '{\n  "email": "a@b.co"\n}',
  },
  {
    name: 'typoed-key',
    schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } }, additionalProperties: false },
    json: '{\n  "nmae": "Mert"\n}',
  },
  {
    name: 'wrong-type',
    schema: { type: 'object', properties: { age: { type: 'integer' } } },
    json: '{\n  "age": "twenty"\n}',
  },
  {
    name: 'failed-format',
    schema: { type: 'object', properties: { email: { type: 'string', format: 'email' } } },
    json: '{\n  "email": "not-an-email"\n}',
  },
  {
    name: 'bound-violation',
    schema: { type: 'object', properties: { port: { type: 'integer', minimum: 1, maximum: 65535 } } },
    json: '{\n  "port": 99999\n}',
  },
  {
    name: 'enum-near-miss',
    schema: { type: 'object', properties: { mode: { enum: ['fast', 'slow', 'auto'] } } },
    json: '{\n  "mode": "fastt"\n}',
  },
  {
    name: 'discriminated-union',
    schema: {
      anyOf: [
        { type: 'object', required: ['kind', 'radius'], properties: { kind: { const: 'circle' }, radius: { type: 'number', minimum: 0 } }, additionalProperties: false },
        { type: 'object', required: ['kind', 'side'], properties: { kind: { const: 'square' }, side: { type: 'number', minimum: 0 } }, additionalProperties: false },
      ],
    },
    json: '{\n  "kind": "circle",\n  "radius": -1\n}',
  },
  {
    name: 'nested-array-element',
    schema: { type: 'object', properties: { tags: { type: 'array', items: { type: 'string' } } } },
    json: '{\n  "tags": ["ok", 7, "fine"]\n}',
  },
  {
    name: 'deep-ref',
    schema: {
      $defs: { addr: { type: 'object', required: ['zip'], properties: { zip: { type: 'string', pattern: '^[0-9]{5}$' } } } },
      type: 'object',
      properties: { home: { $ref: '#/$defs/addr' } },
    },
    json: '{\n  "home": {\n    "zip": "ABC"\n  }\n}',
  },
  {
    name: 'twenty-errors',
    schema: {
      type: 'object',
      properties: Object.fromEntries(
        Array.from({ length: 20 }, (_, i) => ['f' + i, { type: 'string' }])
      ),
    },
    json: '{\n' + Array.from({ length: 20 }, (_, i) => `  "f${i}": ${i}`).join(',\n') + '\n}',
  },
];

const CASES = RAW.map((c) => Object.assign({}, c, { data: JSON.parse(c.json) }));

module.exports = { CASES };
