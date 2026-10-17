'use strict';

// A bundled minLength or maxLength calls `_cpLen`, the code-point counter, for
// a string its fast bounds leave open (a one-character string under
// minLength: 1, an emoji under maxLength). toStandaloneModule embedded the
// counter; bundleStandalone and bundleCompact did not, so the first such
// string threw a ReferenceError (`_cpLen is not defined`), from 1.10.0 at
// least to 1.54.0. rjsf's precompiled validator is built on bundleStandalone.

const assert = require('assert');
const { Validator } = require('..');

const schemas = [
  { type: 'object', properties: { name: { type: 'string', minLength: 1, maxLength: 80 } }, required: ['name'] },
  { type: 'string', maxLength: 2 },
  { type: 'array', items: { type: 'string', minLength: 2 } },
];
const docs = [
  [0, { name: 'A' }], [0, { name: '' }], [0, { name: '😀' }], [0, { name: 'x'.repeat(81) }], [0, { name: '😀'.repeat(80) }],
  [1, '😀😀'], [1, '😀😀😀'], [1, 'ab'], [1, 'abc'],
  [2, ['ab', '😀😀']], [2, ['a']], [2, ['😀']],
];
let n = 0;
for (const kind of ['bundleStandalone', 'bundleCompact']) {
  for (const format of ['cjs', 'esm']) {
    const src = Validator[kind](schemas, { format });
    let fns;
    if (format === 'cjs') { const m = { exports: {} }; new Function('module', 'exports', src)(m, m.exports); fns = m.exports; }
    else fns = new Function(src.replace(/^export default validators;$/m, '').replace(/^export \{[^}]*\};?$/m, '') + '\nreturn validators;')();
    for (const [i, d] of docs) {
      const want = new Validator(schemas[i]).validate(d).valid;
      assert.strictEqual(fns[i](d).valid, want, `${kind} ${format}: schema ${i} on ${JSON.stringify(d)}`);
      n++;
    }
  }
}
console.log(`ok: bundled length checks carry the code-point counter (${n} answers, two bundles, two formats)`);
