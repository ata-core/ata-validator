// verbose puts parentSchema, schema and data on every error. Under plain
// errors a collapsed anyOf/oneOf error lost them: the plain shape copied that
// error's fields by name and left the three out. Both engines must keep them.
const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');

const probe = `
const { Validator } = require(${JSON.stringify(path.join(__dirname, '..'))});
const s = { properties: { c: { anyOf: [{ type: 'string' }, { type: 'number', minimum: 5 }] }, o: { oneOf: [{ type: 'string' }, { type: 'string', minLength: 1 }] } } };
const out = [];
for (const opts of [{ richErrors: false, verbose: true }, { richErrors: false }]) {
  for (const e of new Validator(s, opts).validate({ c: 2, o: 'ab' }).errors) out.push([JSON.stringify(opts), Object.keys(e), e.parentSchema, e.schema, e.data]);
}
console.log(JSON.stringify(out));
`;
const run = (flags) => { const r = spawnSync(process.execPath, [...flags, '-e', probe], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); return JSON.parse(r.stdout); };
const generated = run([]);
assert.deepStrictEqual(generated, run(['--disallow-code-generation-from-strings']), 'the engines disagree');
for (const [opts, keys, parentSchema, schema, data] of generated) {
  if (opts.includes('verbose')) {
    assert.deepStrictEqual(keys.slice(-3), ['parentSchema', 'schema', 'data'], 'verbose fields kept on a collapsed error');
    assert.ok(parentSchema && (Array.isArray(schema)) && data !== undefined);
  } else assert.ok(!keys.includes('parentSchema'), 'the plain shape stays as it was without verbose');
}
console.log('ok: a collapsed error keeps verbose fields under plain errors, on both engines');
