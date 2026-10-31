'use strict';

const assert = require('assert');
const { renderCompact } = require('../lib/render-compact');
const { renderPretty } = require('../lib/render-pretty');
const { renderJSON } = require('../lib/render-json');
const fix = require('./fixtures/error-dx/sample-errors');

// Disable color in tests for stable snapshots
const noColor = { color: 'never', cwd: '/nowhere' };

// renderCompact — three errors with frames
{
  const out = renderCompact(fix.threeErrors, noColor);
  const expected = [
    // Diagnostics are ordered by document position, so name (line 4) now
    // precedes email (line 5) regardless of the order the array arrived in.
    'schemas/user.json:4:7 - error ATA2001: body.name string shorter than minLength (got "M")',
    'schemas/user.json:5:7 - error ATA3001: body.email value does not match format "email" (got "not-an-email", missing \'@\' and domain part)',
    'schemas/user.json:6:7 - error ATA2003: body.age number below minimum (got -3)',
    '',
    'Found 3 errors in input.',
  ].join('\n');
  // Tail "(run with --pretty for source frames)" only when not TTY — in test
  // we run via node directly which may or may not have TTY. Slice off.
  const trimmed = out.split('\n').slice(0, 5).join('\n');
  assert.strictEqual(trimmed, expected);
}

// renderCompact — single error, no source
{
  const out = renderCompact(fix.noSource, noColor);
  assert.ok(out.startsWith('error ATA1001: body.x value has wrong type (got 42)'));
  assert.ok(out.includes('Found 1 error in input.'));
}

// renderJSON
{
  const out = renderJSON(fix.threeErrors);
  const parsed = JSON.parse(out);
  assert.strictEqual(parsed.errors.length, 3);
  assert.strictEqual(parsed.summary.count, 3);
  assert.strictEqual(parsed.summary.context, 'input');
  assert.strictEqual(parsed.errors[0].code, 'ATA3001');
}

// renderPretty — first error contains expected structure
{
  const out = renderPretty([fix.threeErrors[0]], noColor);
  assert.ok(out.includes('error[ATA3001]: value does not match format "email"'));
  assert.ok(out.includes('--> schemas/user.json:5:7'));
  assert.ok(out.includes('"email": { "type": "string", "format": "email" }'));
  assert.ok(out.includes('--> input:1:24  (body.email)'), 'data location is line:col plus the dotted path');
  assert.ok(out.includes('^^^^^^^^^^^^^^  found "not-an-email"'), 'caret spans the token and states what was found');
  assert.ok(out.includes('"not-an-email"'));
  assert.ok(out.includes("help: missing '@' and domain part"));
  assert.ok(out.includes('note: see https://ata-validator.com/e/ATA3001'));
  assert.ok(out.endsWith('error: 1 schema violation in input'));
}

// renderPretty — maxErrors truncation
{
  const out = renderPretty(fix.threeErrors, { ...noColor, maxErrors: 1 });
  assert.ok(out.includes('and 2 more errors'));
  assert.ok(out.endsWith('error: 3 schema violations in input'));
}

// NO_COLOR env respect
{
  const saved = process.env.NO_COLOR;
  process.env.NO_COLOR = '1';
  const out = renderCompact(fix.threeErrors, { color: 'auto' });
  if (saved == null) delete process.env.NO_COLOR; else process.env.NO_COLOR = saved;
  assert.ok(!out.includes('\x1b['), 'NO_COLOR=1 should suppress ANSI');
}

// renderPretty — branchErrors block for collapsed oneOf
{
  const out = renderPretty(fix.collapsedOneOf, noColor);
  assert.ok(out.includes('closest match was card with 1 error'), 'expected closest-variant note');
  assert.ok(out.includes('minLength: string shorter than minLength'), 'expected nested branch error');
}

// renderPretty: the caret lands on the first character of the value, and the
// source line, blank rows and caret row share one bar column. The source line
// once carried an extra leading space, so every caret sat one column left of
// the value it pointed at. Three-digit line numbers widen the bar.
{
  const { Validator } = require('..');
  const v = new Validator({ type: 'object', additionalProperties: false, properties: { email: { type: 'string', format: 'email' } } });
  for (const blank of [2, 11, 149]) {
    const body = '{' + '\n'.repeat(blank) + '  "email": "mert.example.com",\n  "role": "admin"\n}';
    const lines = renderPretty(v.validateJSON(body).errors, noColor).split('\n');
    let frames = 0;
    for (let i = 1; i + 1 < lines.length; i++) {
      if (!/^\s*\d+ \| /.test(lines[i])) continue;
      frames++;
      const src = lines[i], car = lines[i + 1], above = lines[i - 1];
      const at = src.includes('"mert') ? src.indexOf('"mert') : src.indexOf('"role');
      assert.strictEqual(car.indexOf('^'), at, `caret under the value at ${blank} blank lines:\n${src}\n${car}`);
      assert.strictEqual(above.indexOf('|'), src.indexOf('|'), 'bar above the source line lines up');
      assert.strictEqual(car.indexOf('|'), src.indexOf('|'), 'bar on the caret row lines up');
    }
    assert.strictEqual(frames, 2, 'both errors rendered a source frame');
  }
}

// Property names, paths and values come from the document and go to a
// terminal. A key holding a line break and an escape sequence forged an
// "error:" line and a colour; they are written as escapes. A source line
// above a caret keeps one character for one so the caret stays aligned.
{
  const { Validator } = require('..');
  const v = new Validator({ type: 'object', properties: { a: { type: 'string' } }, additionalProperties: false });
  const doc = '{"a":"x","b\\nerror: forged line\\u001b[31mRED\\u009b2J":1}';
  const errors = v.validateJSON(doc).errors;
  for (const [name, out] of [['compact', renderCompact(errors, noColor)], ['pretty', renderPretty(errors, Object.assign({ context: 'in\u001b[2Jput\nx' }, noColor))]]) {
    assert.ok(!/[\x00-\x09\x0b-\x1f\x7f-\x9f\u2028\u2029]/.test(out), `${name}: no control character reaches the terminal:\n${JSON.stringify(out)}`);
    assert.ok(!out.split('\n').some((l) => l.startsWith('error: forged')), `${name}: no forged line`);
    assert.ok(out.includes('b\\nerror: forged line\\u001b[31mRED'), `${name}: the name is shown escaped:\n${out}`);
  }
  // A raw DEL or C1 character inside a string on the source line is drawn as
  // one replacement character, so the caret under the value does not move.
  const v2 = new Validator({ type: 'object', properties: { s: { type: 'string' }, n: { type: 'string' } } });
  const body = '{"s": "a\u009b\u007fb", "n": 5}';
  const lines = renderPretty(v2.validateJSON(body).errors, noColor).split('\n');
  const i = lines.findIndex((l) => /^\s*\d+ \| /.test(l));
  assert.ok(i > 0 && !/[\x7f-\x9f]/.test(lines[i]), lines.join('\n'));
  assert.strictEqual(lines[i + 1].indexOf('^'), lines[i].indexOf('5'), `caret under the value:\n${lines[i]}\n${lines[i + 1]}`);
}

// A minified document is one line, and every error's dataFrame carried all
// of it: 4000 errors on a 100 KB line serialized to hundreds of megabytes.
// The frame text is an excerpt of at most 200 characters around the value,
// `col` stays the column in the line, and `textCol` says where the value
// starts in the excerpt. The renderers draw the caret from it.
{
  const { Validator } = require('..');
  const { buildDataPositionMap, buildTargetedPositionMap } = require('../lib/data-positions');
  const pad = 'p'.repeat(100000);
  const text = '[' + JSON.stringify(pad) + ',' + Array.from({ length: 2000 }, (_, i) => i).join(',') + ']';
  const full = buildDataPositionMap(text);
  const targeted = buildTargetedPositionMap(text, new Set(['/1500', '/0']));
  for (const m of [full, targeted]) {
    const e = m['/1500'];
    assert.ok(e.text.length <= 200, `excerpt is ${e.text.length} chars`);
    assert.strictEqual(e.col, e.byteOffset + 1, 'col is the column in the line');
    assert.strictEqual(e.text.slice(e.textCol - 1, e.textCol - 1 + e.length), '1499', 'textCol points at the value in the excerpt');
    assert.ok(m['/0'].text.length <= 200 && m['/0'].text.startsWith('['), 'a value near the start keeps the line start');
  }
  const short = buildDataPositionMap('{"a": 1}');
  assert.strictEqual(short['/a'].text, '{"a": 1}', 'a short line is whole');
  assert.strictEqual(short['/a'].textCol, undefined, 'and has no textCol');

  const v = new Validator({ type: 'array', items: { type: 'string' } });
  const r = v.validateJSON(text);
  const errs = r.errors;
  assert.ok(errs.length >= 2000);
  const size = JSON.stringify(errs).length;
  assert.ok(size < 2000 * 1000, `errors serialize to ${size} bytes`);
  for (const e of errs.slice(0, 50)) assert.ok(!e.dataFrame || e.dataFrame.text.length <= 200);

  const lines = renderPretty(errs, Object.assign({ maxErrors: 3 }, noColor)).split('\n');
  let frames = 0;
  for (let k = 1; k + 1 < lines.length; k++) {
    if (!/^\s*\d+ \| /.test(lines[k])) continue;
    frames++;
    const caret = lines[k + 1].indexOf('^');
    assert.ok(caret > 0 && /[0-9]/.test(lines[k][caret]) && !/[0-9]/.test(lines[k][caret - 1]), `caret on the first digit:\n${lines[k]}\n${lines[k + 1]}`);
  }
  assert.ok(frames >= 1, 'frames drawn');

  // An error handed over with only its dataFrame.
  const { toDiagnostics } = require('../lib/diagnose');
  const d = toDiagnostics([{ code: 'ATA1001', keyword: 'type', instancePath: '/9', params: {}, message: 'must be string', dataFrame: { byteOffset: 5000, length: 1, line: 1, col: 5001, text: 'x'.repeat(60) + '9' + 'x'.repeat(100), textCol: 61 } }]);
  const pretty = renderPretty([{ code: 'ATA1001', keyword: 'type', instancePath: '/9', params: {}, message: 'must be string', dataFrame: { byteOffset: 5000, length: 1, line: 1, col: 5001, text: 'x'.repeat(60) + '9' + 'x'.repeat(100), textCol: 61 } }], noColor).split('\n');
  assert.strictEqual(d[0].frame.col, 5001, 'the location is the column in the line');
  const fi = pretty.findIndex((l) => /^\s*\d+ \| /.test(l));
  assert.strictEqual(pretty[fi][pretty[fi + 1].indexOf('^')], '9', pretty.slice(fi, fi + 2).join('\n'));
}

console.log('ok: renderer snapshot tests');
