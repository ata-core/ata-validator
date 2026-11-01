// Errors behind a reference to a document registered under a relative $id
// (schemas: [{ $id: 'shared', ... }], as Fastify registers them) come in
// schema order, on both engines. The rank could not follow `shared#` from a
// root without $id, and the generated code's errors kept their own order:
// additionalProperties ahead of the properties declared before it.
const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');

const probe = `
const { Validator } = require(${JSON.stringify(path.join(__dirname, '..'))});
const shared = { $id: 'shared', type: 'object', properties: { id: { type: 'integer' }, tags: { type: 'array' } }, additionalProperties: false };
const out = [];
for (const s of [{ $ref: 'shared#' }, { $ref: 'shared' }, { type: 'object', properties: { body: { $ref: 'shared#' } } }]) {
  const r = new Validator(s, { schemas: [shared] }).validate(s.properties ? { body: { id: 'x', tags: 'y', zz: 1 } } : { id: 'x', tags: 'y', zz: 1 });
  out.push(r.errors.map((e) => e.keyword + ' ' + e.instancePath + ' ' + e.schemaPath));
}
console.log(JSON.stringify(out));
`;
const run = (flags) => { const r = spawnSync(process.execPath, [...flags, '-e', probe], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); return JSON.parse(r.stdout); };
const generated = run([]);
assert.deepStrictEqual(generated, run(['--disallow-code-generation-from-strings']), 'the engines order these errors differently');
for (const list of generated) assert.ok(list[list.length - 1].startsWith('additionalProperties'), 'additionalProperties comes after the properties declared before it: ' + list.join(', '));
console.log('ok: errors behind a relative $id reference come in schema order, on both engines');
