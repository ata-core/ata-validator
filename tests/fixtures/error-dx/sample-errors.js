'use strict';

// Hand-curated fixtures. Snapshot tests assert exact output against these.
module.exports = {
  threeErrors: [
    {
      code: 'ATA3001', message: 'value does not match format "email"',
      keyword: 'format', path: '/email',
      expected: "format 'email'", received: '"not-an-email"',
      schemaPath: '/properties/email/format',
      schemaSource: { file: 'schemas/user.json', line: 5, col: 7, text: '      "email": { "type": "string", "format": "email" }' },
      dataFrame: { byteOffset: 23, length: 14, line: 1, col: 24, text: '{ "name": "M", "email": "not-an-email", "age": -3 }' },
      suggestion: { text: "missing '@' and domain part", kind: 'format' },
      docUrl: 'https://ata-validator.com/e/ATA3001',
    },
    {
      code: 'ATA2001', message: 'string shorter than minLength',
      keyword: 'minLength', path: '/name',
      expected: 'string with ≥2 chars', received: '"M"',
      schemaPath: '/properties/name/minLength',
      schemaSource: { file: 'schemas/user.json', line: 4, col: 7, text: '      "name": { "type": "string", "minLength": 2 }' },
      dataFrame: { byteOffset: 10, length: 3, line: 1, col: 11, text: '{ "name": "M", "email": "not-an-email", "age": -3 }' },
      docUrl: 'https://ata-validator.com/e/ATA2001',
    },
    {
      code: 'ATA2003', message: 'number below minimum',
      keyword: 'minimum', path: '/age',
      expected: '≥0', received: '-3',
      schemaPath: '/properties/age/minimum',
      schemaSource: { file: 'schemas/user.json', line: 6, col: 7, text: '      "age": { "type": "integer", "minimum": 0 }' },
      dataFrame: { byteOffset: 46, length: 2, line: 1, col: 47, text: '{ "name": "M", "email": "not-an-email", "age": -3 }' },
      docUrl: 'https://ata-validator.com/e/ATA2003',
    },
  ],
  noSource: [
    {
      code: 'ATA1001', message: 'value has wrong type',
      keyword: 'type', path: '/x',
      expected: 'string', received: '42',
      schemaPath: '/properties/x/type',
      docUrl: 'https://ata-validator.com/e/ATA1001',
    },
  ],
  collapsedOneOf: [{
    code: 'ATA4001', message: 'value matched 0 of 3 oneOf variants',
    keyword: 'oneOf', path: '/payment',
    schemaPath: '/properties/payment/oneOf',
    params: { variants: 3, closest: 1, closestName: 'card' },
    branchErrors: [
      { keyword: 'minLength', message: 'string shorter than minLength', path: '/payment/number' },
    ],
    docUrl: 'https://ata-validator.com/e/ATA4001',
  }],
};
