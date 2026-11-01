'use strict';

// esm.sh and similar CDNs turn each CommonJS file into an ES module whose
// require() calls become imports evaluated before the file's body. Inside a
// require cycle the module still loading then hands out exports that do not
// exist yet: lib/js-compiler-errors.js read js-compiler's helpers at load and
// threw, so ata did not load from esm.sh at all. This runs the package under
// a loader that evaluates every literal relative require first and hands a
// module of one function back as { default: fn }, as esm.sh does, in a child
// process, and checks the public API works and no partial exports are read.
const assert = require('assert');
const { spawnSync } = require('child_process');
const path = require('path');
const root = path.join(__dirname, '..');

const hook = `
const Module = require('module');
const orig = Module.prototype._compile;
Module.prototype._compile = function (content, filename) {
  if (filename.startsWith(${JSON.stringify(root)}) && !filename.includes('node_modules')) {
    const re = /require\\(\\s*['"](\\.{1,2}\\/[^'"]+)['"]\\s*\\)/g;
    let m; const seen = new Set();
    while ((m = re.exec(content))) {
      if (seen.has(m[1])) continue; seen.add(m[1]);
      try { this.require(m[1]); } catch (e) { if (!/Cannot find module/.test(e.message)) { process.stdout.write('EAGER-THROW ' + m[1] + ' ' + e.message + '\\n'); } }
    }
  }
  return orig.call(this, content, filename);
};
// esm.sh's require() also hands a module whose exports are one function back
// as { __esModule: true, default: fn }, not the function.
const origReq = Module.prototype.require;
Module.prototype.require = function (id) {
  const out = origReq.call(this, id);
  if (typeof out === 'function' && id.startsWith('.') && this.filename && this.filename.startsWith(${JSON.stringify(root)}) && !this.filename.includes('node_modules')) {
    return Object.assign({ __esModule: true, default: out }, out);
  }
  return out;
};
`;
const body = `
const ata = require(${JSON.stringify(root)});
const aot = require(${JSON.stringify(path.join(root, 'aot'))});
const schema = { type: 'object', properties: { email: { type: 'string', format: 'email' }, tags: { type: 'array', items: { type: 'string' }, uniqueItems: true } }, required: ['email'] };
const v = new ata.Validator(schema);
const r = v.validate({ email: 'x', tags: ['a', 'a'] });
const code = aot.bundleStandalone(ata.Validator, [schema], { format: 'esm' });
const withSource = new ata.Validator(schema, { source: { path: 's.json', content: JSON.stringify(schema, null, 2) } });
const j = withSource.validateJSON('{"email":"x"}');
const buf = withSource.isValid(Buffer.from('{"email":"a@b.co"}'));
const std = withSource['~standard'].validate({ email: 'x' });
console.log(JSON.stringify({ valid: r.valid, errors: r.errors.length, pretty: ata.renderPretty(r.errors, { color: 'never' }).length > 0, ts: ata.toTypeScript(schema).length > 0, bundle: !/validators=\\[null\\]/.test(code), json: j.errors[0].code, buf, std: std.issues.length > 0 }));
`;
const res = spawnSync(process.execPath, ['--trace-warnings', '-e', hook + body], { encoding: 'utf8', env: Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== 'ATA_NO_NATIVE')) });
assert.ok(!/EAGER-THROW/.test(res.stdout), 'a module threw while its requires were evaluated first:\n' + res.stdout);
assert.ok(!/inside circular dependency/.test(res.stderr), 'a module read exports that did not exist yet:\n' + res.stderr.split('\n').slice(0, 6).join('\n'));
assert.strictEqual(res.status, 0, res.stderr);
const out = JSON.parse(res.stdout.trim().split('\n').pop());
assert.deepStrictEqual(out, { valid: false, errors: 2, pretty: true, ts: true, bundle: true, json: 'ATA3001', buf: true, std: true });
console.log('ok: ata loads and validates when every require is evaluated before the module body, as esm.sh does');
