// removeAdditional with a root schema that describes an object, and an array
// for a document: the generated pass deleted the array's items as if its
// indices were additional properties ([ '1', 2 ] became [ <2 empty items> ]),
// while the interpreted engine's pass left the array alone. Both engines
// must leave it alone; the document is rejected by `type` either way.
const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');

const probe = `
const { Validator } = require(${JSON.stringify(path.join(__dirname, '..'))});
const out = [];
for (const schema of [
  { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false },
  { type: 'object', properties: {}, additionalProperties: false },
]) {
  for (const opts of [{ removeAdditional: true }, { removeAdditional: true, coerceTypes: true }]) {
    for (const doc of [['1.5', 2], [['x']], []]) {
      const d = structuredClone(doc);
      const r = new Validator(schema, opts).validate(d);
      out.push([r.valid, JSON.stringify(d), Array.isArray(d) ? d.length : -1, Array.isArray(d) ? [...d.keys()].every((i) => i in d) : true]);
    }
  }
}
// An object root still loses its extra keys.
const o = { a: 'x', z: 1 };
new Validator({ type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false }, { removeAdditional: true }).validate(o);
out.push(JSON.stringify(o));
console.log(JSON.stringify(out));
`;
const run = (flags) => {
  const r = spawnSync(process.execPath, [...flags, '-e', probe], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(r.stderr);
  return JSON.parse(r.stdout);
};
const generated = run([]);
const interpreted = run(['--disallow-code-generation-from-strings']);
assert.deepStrictEqual(generated, interpreted, 'the two engines leave the document in different states');
for (const row of generated.slice(0, -1)) {
  assert.strictEqual(row[0], false, 'an array is rejected by type: object');
  assert.strictEqual(row[3], true, 'no item of the array was deleted: ' + row[1]);
}
assert.strictEqual(generated[generated.length - 1], '{"a":"x"}');
console.log('ok: removeAdditional leaves an array root alone, on both engines');
