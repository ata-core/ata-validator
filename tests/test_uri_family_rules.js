'use strict';

// The URI family (uri, uri-reference, iri, iri-reference) is one walk over
// RFC 3986 (lib/uri-core.js), run by the interpreted engine and emitted into
// generated code and standalone modules. These are the rules a character
// scan does not hold, each on both engines and in a standalone module, plus
// the official suite's cases for the four formats.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { Validator } = require('..');
const aot = require('../lib/aot.js');

const cases = [
  // [format, value, valid]
  ['uri', 'http://[::ffff:01.2.3.4]', false], ['uri', 'http:/[::1]', false], ['uri', 'http://a#b#c', false],
  ['uri', 'http://[::1]:8080/p?q#f', true], ['uri', 'http://[fe80::1%25eth0]/', true], ['uri', 'http://[v1.fe:80]/', true],
  ['uri', 'http://[fe80::1%eth0]/', false], ['uri', 'http://[::1', false], ['uri', 'http://[::1]x', false],
  ['uri', 'http://u:p@h:80/p', true], ['uri', 'http://u@p@h/', false], ['uri', 'http://h:x/', false], ['uri', 'http://h:/', true],
  ['uri', 'urn:isbn:0451450523', true], ['uri', 'mailto:a@b.com', true], ['uri', 'file:///etc/hosts', true], ['uri', 'a:%zz', false],
  ['uri', 'http://例え.jp/', false], ['iri', 'http://例え.jp/パス?q=値#断片', true], ['iri', 'http://[::ffff:192.168.0.01]', false],
  ['uri-reference', '/[::1]', false], ['uri-reference', '//example.com:abc/p', false], ['uri-reference', '//a@b@example.com/', false],
  ['uri-reference', '//[::ffff:192.168.0.01]/p', false], ['uri-reference', '1:b', false], ['uri-reference', './1:b', true], ['uri-reference', 'a:b', true],
  ['uri-reference', '', true], ['uri-reference', '#f', true], ['uri-reference', '?q', true], ['uri-reference', '//', true], ['uri-reference', 'p/a:b', true],
  ['uri-reference', 'a b', false], ['uri-reference', '%4', false], ['uri-reference', '%41', true], ['uri-reference', 'x#y#z', false],
  ['iri-reference', '//[::ffff:192.168.0.01]/p', false], ['iri-reference', 'パス/a:b', true], ['iri-reference', '1:b', false], ['iri-reference', '\u007f', false],
  ['uri-template', 'a%', false], ['uri-template', 'a%4', false], ['uri-template', 'a%GG', false], ['uri-template', 'a%41{x}', true],
  ['uri-template', '{%}', false], ['uri-template', '{%4}', false], ['uri-template', '{%GG}', false], ['uri-template', '{%41}', true],
  ['email', '"test\\\u00a9"@iana.org', false], ['email', '"test\\"q"@iana.org', true], ['email', '"te st"@iana.org', true], ['email', '"a"b"@iana.org', false],
  ['email', 'a@[ipv6:::1]', true], ['email', 'a@[IPv6:::1]', true], ['email', 'a@[ipv6:::zz]', false], ['email', 'a@[127.0.0.1]', true],
];
// The official suite's four URI formats and the two others touched, both answers.
const dir = path.join(__dirname, 'suite/tests/draft2020-12/optional/format');
for (const f of ['uri', 'uri-reference', 'iri', 'iri-reference', 'uri-template', 'email']) {
  for (const g of JSON.parse(fs.readFileSync(path.join(dir, f + '.json')))) for (const t of g.tests) if (typeof t.data === 'string') cases.push([f, t.data, t.valid]);
}
let n = 0;
const byFormat = new Map();
for (const [format, value, valid] of cases) {
  if (!byFormat.has(format)) {
    const schema = { type: 'string', format };
    byFormat.set(format, {
      gen: new Validator(schema, { assertFormat: true }),
      interp: new Validator(schema, { assertFormat: true, engine: 'interpreter' }),
      standalone: (() => { try { const src = aot.toStandaloneModule(new Validator(schema, { assertFormat: true }), { format: 'cjs' }); const m = { exports: {} }; new Function('module', 'exports', 'require', src)(m, m.exports, require); return m.exports } catch (e) { if (/code generation|Function/i.test(String(e))) return null; throw e } })(),
    });
  }
  const v = byFormat.get(format);
  assert.strictEqual(v.gen.isValidObject(value), valid, `generated: ${format} ${JSON.stringify(value)}`);
  assert.strictEqual(v.interp.isValidObject(value), valid, `interpreter: ${format} ${JSON.stringify(value)}`);
  if (v.standalone) assert.strictEqual(v.standalone.isValid(value), valid, `standalone: ${format} ${JSON.stringify(value)}`);
  n++;
}
console.log(`ok: the URI family, uri-template and email answer RFC 3986/6570/5321 alike on both engines and standalone (${n} values)`);
