'use strict';

// A pattern that only names keys (`^name$`, `^(a|b)$`) or matches everything
// (`.*`) is answered by comparing strings instead of running a regex. The
// answers must be the regex's own, in patternProperties, propertyNames and
// with additionalProperties, on generated code and the interpreter.

const assert = require('assert');
const { Validator } = require('..');

const pats = ['^cdn$', '^(cdn|Cdn)$', '^(a|b-c|d_e|F9)$', '.*', '^(x)$', '^x-$', '^(a|b)c$', '^a|b$', '^(a|b)$x'];
const keys = ['cdn', 'Cdn', 'CDN', 'cdnx', 'xcdn', 'a', 'b-c', 'd_e', 'F9', 'f9', 'x', 'x-', 'ac', 'bc', 'b', 'ab', '', 'cdn\n', 'a\nb', 'b\n'];
let checked = 0;
for (const p of pats) {
  const re = new RegExp(p);
  const schemas = [
    { patternProperties: { [p]: { type: 'number' } } },
    { type: 'object', patternProperties: { [p]: { type: 'number' } }, additionalProperties: false },
    { type: 'object', propertyNames: { pattern: p } },
    { type: 'object', properties: { zz: {} }, patternProperties: { [p]: { minimum: 1 } }, additionalProperties: { type: 'string' } },
  ];
  for (const schema of schemas) {
    const v = new Validator(schema);
    const vi = new Validator(schema, { engine: 'interpreter' });
    for (const k of keys) {
      for (const val of [5, 'five', 0]) {
        const d = { [k]: val };
        const want = vi.validate(d).valid;
        assert.strictEqual(v.validate(d).valid, want, `${JSON.stringify(schema)} on ${JSON.stringify(d)}`);
        assert.strictEqual(v.isValidObject(d), want, `${JSON.stringify(schema)} on ${JSON.stringify(d)}`);
        assert.strictEqual(v.validate(d).errors.length === 0, want);
        checked++;
      }
    }
    // the interpreter itself follows the regex
    const s0 = schemas[2];
    if (schema === s0) for (const k of keys) assert.strictEqual(vi.validate({ [k]: 1 }).valid, re.test(k), `${p} on ${JSON.stringify(k)}`);
  }
}
console.log(`ok: literal key patterns answer as their regex does (${checked} documents)`);
