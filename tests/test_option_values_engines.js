// coerceTypes and removeAdditional with their non-boolean values: both
// engines must leave the same document and give the same answer. With
// coerceTypes: 'array' the generated pass wrapped a lone value of a top-level
// array property ('3' became [3]) and the interpreted one did not.
const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');

const probe = `
const { Validator } = require(${JSON.stringify(path.join(__dirname, '..'))});
const schemas = [
  { type: 'object', properties: { n: { type: 'integer' }, list: { type: 'array', items: { type: 'number' } }, tags: { type: 'array' }, one: { type: 'string' }, o: { type: 'object', properties: { k: { type: 'string', minLength: 2 }, inner: { type: 'array', items: { type: 'integer' } } }, additionalProperties: false } }, additionalProperties: false },
  { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: { type: 'number' } },
];
const docs = [{ n: '5', list: '3', tags: 'x', one: [7], o: { k: 'x', extra: 1, inner: '4' }, zz: 1 }, { list: ['1', 2], tags: ['a'], o: { inner: ['5'] } }, { a: 'x', b: 1, c: 'nope' }, { list: null, tags: undefined }, []];
const out = [];
for (const opts of [{ coerceTypes: 'array' }, { coerceTypes: true }, { removeAdditional: 'all' }, { removeAdditional: 'failing' }, { removeAdditional: true }, { coerceTypes: 'array', removeAdditional: 'all' }]) {
  for (const s of schemas) for (const doc of docs) {
    const d = structuredClone(doc);
    const r = new Validator(s, opts).validate(d);
    out.push([JSON.stringify(opts), r.valid, (r.errors || []).map((e) => e.keyword + e.instancePath), JSON.stringify(d)]);
  }
}
console.log(JSON.stringify(out));
`;
const run = (flags) => { const r = spawnSync(process.execPath, [...flags, '-e', probe], { encoding: 'utf8' }); if (r.status !== 0) throw new Error(r.stderr); return JSON.parse(r.stdout); };
const generated = run([]);
const interpreted = run(['--disallow-code-generation-from-strings']);
for (let i = 0; i < generated.length; i++) assert.deepStrictEqual(interpreted[i], generated[i], 'engines differ: ' + JSON.stringify(generated[i]));
assert.ok(generated.some(([o, , , d]) => o.includes('array') && d.includes('"list":[3]')), 'array mode wraps a lone value');
console.log('ok: both engines agree on coerceTypes and removeAdditional values (' + generated.length + ' cases)');
