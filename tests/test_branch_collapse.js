'use strict';

const assert = require('assert');
const { collapseBranches, scoreBranch } = require('../lib/branch-collapse');

// scoreBranch ordering
assert.ok(scoreBranch([{ keyword: 'type' }]) > scoreBranch([{ keyword: 'minLength' }]));
assert.ok(scoreBranch([{ keyword: 'type' }, { keyword: 'minLength' }]) > scoreBranch([{ keyword: 'type' }]));

// oneOf with 1 match -> null
{
  const r = collapseBranches({
    keyword: 'oneOf',
    branchResults: [
      { valid: false, errors: [{ keyword: 'type' }] },
      { valid: true, errors: [] },
      { valid: false, errors: [{ keyword: 'type' }] },
    ],
    parentPath: '/payment', parentSchemaPath: '#/properties/payment/oneOf',
  });
  assert.strictEqual(r, null);
}

// oneOf with 2 matches -> ATA4002
{
  const r = collapseBranches({
    keyword: 'oneOf',
    branchResults: [{ valid: true, errors: [] }, { valid: true, errors: [] }],
    parentPath: '', parentSchemaPath: '#/oneOf',
  });
  assert.strictEqual(r.code, 'ATA4002');
}

// oneOf with 0 matches -> ATA4001 + best branch
{
  const r = collapseBranches({
    keyword: 'oneOf',
    branchResults: [
      { valid: false, errors: [{ keyword: 'type' }], title: 'wire' },         // score: 1*100+10=110
      { valid: false, errors: [{ keyword: 'minLength' }], title: 'card' },    // score: 1*100+3=103 (best)
      { valid: false, errors: [{ keyword: 'type' }, { keyword: 'enum' }] },   // score: 2*100+...=high
    ],
    parentPath: '', parentSchemaPath: '#/oneOf',
  });
  assert.strictEqual(r.code, 'ATA4001');
  assert.strictEqual(r.params.closest, 1);
  assert.strictEqual(r.params.closestName, 'card');
  assert.deepStrictEqual(r.branchErrors, [{ keyword: 'minLength' }]);
}

// anyOf with any match -> null
{
  const r = collapseBranches({
    keyword: 'anyOf',
    branchResults: [{ valid: false, errors: [{ keyword: 'type' }] }, { valid: true, errors: [] }],
    parentPath: '', parentSchemaPath: '#/anyOf',
  });
  assert.strictEqual(r, null);
}

// anyOf with 0 matches -> ATA4003
{
  const r = collapseBranches({
    keyword: 'anyOf',
    branchResults: [{ valid: false, errors: [{ keyword: 'type' }] }, { valid: false, errors: [{ keyword: 'minLength' }] }],
    parentPath: '', parentSchemaPath: '#/anyOf',
  });
  assert.strictEqual(r.code, 'ATA4003');
  assert.strictEqual(r.params.closest, 1);
}

console.log('ok: branch-collapse unit tests');
