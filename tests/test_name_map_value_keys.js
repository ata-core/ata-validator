'use strict';

// Inside `properties` (and the other maps from names to schemas) a key is a
// name. A property called `examples`, `default`, `enum` or `const` holds a
// schema there, not a value, and the walks that rewrite references must
// follow it. They skipped it as if it were the keyword: OpenAPI 3.1's own
// schema has a property named `examples` whose schema is a `$ref`, the
// dynamic-scope copy left that reference pointing at a definition the copy no
// longer had, and the whole schema fell back to the interpreted engine. These
// shapes must compile, and answer as the interpreter does.

const assert = require('assert');
const { Validator } = require('..');

const named = (name) => ({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://example.com/root',
  $dynamicAnchor: 'meta',
  type: 'object',
  properties: {
    [name]: { type: 'object', additionalProperties: { $ref: '#/$defs/item' } },
    nested: { $dynamicRef: '#meta' },
  },
  $defs: { item: { type: 'object', required: ['id'], properties: { id: { type: 'integer' } } } },
});

const cross = (name) => ({
  $id: 'https://example.com/main',
  type: 'object',
  properties: { [name]: { $ref: 'https://example.com/other#/$defs/item' } },
});
const other = { $id: 'https://example.com/other', $defs: { item: { type: 'integer', minimum: 1 } } };

// Where code generation is blocked every validator interprets; the answers
// are still compared.
let codegen = true;
try { new Function('return 1'); } catch { codegen = false; }

let checked = 0;
for (const name of ['examples', 'default', 'enum', 'const']) {
  const docs = [
    {},
    { [name]: { a: { id: 1 } } },
    { [name]: { a: { id: 'x' } } },
    { [name]: { a: {} } },
    { nested: { [name]: { a: { id: 2 } } } },
    { nested: { [name]: { a: { id: null } } } },
  ];
  const v = new Validator(named(name));
  const vi = new Validator(named(name), { engine: 'interpreter' });
  if (codegen) assert.strictEqual(v.engine(), 'codegen', `a $dynamicRef schema with a property named ${name} compiles`);
  for (const d of docs) {
    assert.strictEqual(v.validate(d).valid, vi.validate(d).valid, `${name}: ${JSON.stringify(d)}`);
    assert.deepStrictEqual(v.validate(d).errors.map((e) => e.instancePath), vi.validate(d).errors.map((e) => e.instancePath), `${name} errors: ${JSON.stringify(d)}`);
    checked++;
  }
  const opts = { schemas: [other] };
  const c = new Validator(cross(name), opts);
  const ci = new Validator(cross(name), { ...opts, engine: 'interpreter' });
  for (const d of [{}, { [name]: 1 }, { [name]: 0 }, { [name]: 'x' }]) {
    assert.strictEqual(c.validate(d).valid, ci.validate(d).valid, `cross ${name}: ${JSON.stringify(d)}`);
    checked++;
  }
}
console.log(`ok: properties named like value keywords keep their references (${checked} documents, both engines)`);
