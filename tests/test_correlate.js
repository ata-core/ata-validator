'use strict';

const assert = require('node:assert');
const { correlateTypos } = require('../lib/correlate');

function req (path, missing) {
  return { keyword: 'required', path, instancePath: path, params: { missingProperty: missing } };
}
function extra (path, additional) {
  return { keyword: 'additionalProperties', path, instancePath: path, params: { additionalProperty: additional } };
}

// The motivating case: one typed key produces two errors that are one mistake.
{
  const errs = [req('', 'name'), extra('', 'nmae')];
  const m = correlateTypos(errs);
  assert.strictEqual(m.get(0), 1, 'required should point at the extra key');
  assert.strictEqual(m.get(1), 0, 'extra key should point back, symmetrically');
  console.log('ok: nmae correlates with name');
}

// Distance greater than 2 is not a typo, it is two separate problems.
{
  const errs = [req('', 'name'), extra('', 'telephone')];
  assert.strictEqual(correlateTypos(errs).size, 0, 'distant names must not correlate');
  console.log('ok: distant names stay separate');
}

// A tie on the missing side must not correlate. `nmae` is distance 2 from
// `name` and distance 2 from `mane`; picking one would be a guess.
{
  const errs = [req('', 'name'), req('', 'mane'), extra('', 'nmae')];
  assert.strictEqual(correlateTypos(errs).size, 0, 'ambiguous missing key must not correlate');
  console.log('ok: tie on the missing side blocks correlation');
}

// A tie on the extra side must not correlate either.
{
  const errs = [req('', 'name'), extra('', 'nmae'), extra('', 'naem')];
  assert.strictEqual(correlateTypos(errs).size, 0, 'ambiguous extra key must not correlate');
  console.log('ok: tie on the extra side blocks correlation');
}

// Different containers are different problems even with identical names.
{
  const errs = [req('/a', 'name'), extra('/b', 'nmae')];
  assert.strictEqual(correlateTypos(errs).size, 0, 'cross-container pairs must not correlate');
  console.log('ok: containers are not crossed');
}

// Same container, two independent typos, both unambiguous: both correlate.
{
  const errs = [req('', 'name'), req('', 'email'), extra('', 'nmae'), extra('', 'emial')];
  const m = correlateTypos(errs);
  assert.strictEqual(m.get(0), 2, 'name pairs with nmae');
  assert.strictEqual(m.get(1), 3, 'email pairs with emial');
  assert.strictEqual(m.size, 4, 'four indices participate');
  console.log('ok: two independent typos both correlate');
}

// Identical names are not a typo, and distance 0 must never pair.
{
  const errs = [req('', 'name'), extra('', 'name')];
  assert.strictEqual(correlateTypos(errs).size, 0, 'distance 0 must not correlate');
  console.log('ok: identical names do not correlate');
}

// Junk in, empty map out. Never throw from the error path.
{
  assert.strictEqual(correlateTypos([]).size, 0);
  assert.strictEqual(correlateTypos(null).size, 0);
  assert.strictEqual(correlateTypos([{}, { keyword: 'required' }]).size, 0);
  console.log('ok: malformed input yields an empty map');
}

console.log('ok: correlate');
