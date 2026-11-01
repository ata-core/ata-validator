// A compile that throws must throw again on the next call. The validator was
// marked compiled before compiling, so after a custom keyword's compile
// returned no function, every later call of validate, isValidObject,
// validateJSON or isValidJSON recursed until the stack ran out instead of
// reporting the keyword's error.
const assert = require('assert');
const { Validator } = require('..');

const v = new Validator({ bad: 1 }, { keywords: { bad: { compile: () => 5 } } });
const want = /keyword "bad": compile must return a function/;
for (const [m, arg] of [['validate', 1], ['validate', 1], ['isValidObject', 1], ['validateJSON', '1'], ['isValidJSON', '1'], ['validate', 1]]) {
  assert.throws(() => v[m](arg), want, `${m} reports the keyword's error`);
}
console.log('ok: a compile that throws throws the same error on every later call');
