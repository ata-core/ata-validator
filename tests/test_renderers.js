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
    'schemas/user.json:5:7 - error ATA3001: body.email value does not match format "email" (got "not-an-email", missing \'@\' and domain part)',
    'schemas/user.json:4:7 - error ATA2001: body.name string shorter than minLength (got "M")',
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
  assert.ok(out.includes('--> input, byte 23'));
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

console.log('ok: renderer snapshot tests');
