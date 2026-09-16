'use strict';

// `strictSchema`, the authoring-time check. The one schema mistake a
// validator cannot make safe at validation time is a mistyped keyword: it is
// an annotation to every dialect, so the intended constraint is simply
// absent, and previously invalid data validates. Reported as issue #44 by a
// migration that shipped `maxLenght` and found out from production data.
//
// The compat shim's `strict`/`strictSchema` map onto this. `strictTypes`,
// `strictTuples` and `strictRequired` remain accepted and ignored, which the
// shim documents rather than half-enforces.

const assert = require('node:assert');
const { Validator } = require('../index');
const Compat = require('../compat.js');

let passed = 0;
function ok(name) { console.log('  PASS  ' + name); passed++; }

const MISTYPED = { type: 'object', properties: { a: { type: 'string', maxLenght: 3 } } };

// --- off by default ----------------------------------------------------------
{
  const v = new Validator(MISTYPED);
  assert.strictEqual(v.isValidObject({ a: 'way too long' }), true, 'without the option the keyword stays an annotation');
  ok('default behavior is unchanged: unknown keywords are annotations');
}

// --- the fail-open case throws, with a suggestion ----------------------------
{
  assert.throws(
    () => new Validator(MISTYPED, { strictSchema: true }),
    (e) => e.message.includes('unknown keyword "maxLenght"')
      && e.message.includes('did you mean "maxLength"?')
      && e.message.includes('#/properties/a/maxLenght'),
  );
  ok('a mistyped keyword throws, names its path, and suggests the spelling');
}

// --- a dangling local $ref throws early --------------------------------------
{
  assert.throws(
    () => new Validator({ type: 'object', properties: { a: { $ref: '#/$defs/missing' } } }, { strictSchema: true }),
    /does not resolve in this document/,
  );
  ok('a dangling local $ref is reported at construction');
}

// --- log mode reports and continues ------------------------------------------
{
  const seen = [];
  const v = new Validator(MISTYPED, { strictSchema: 'log', logger: { warn: (m) => seen.push(m), log() {}, error() {} } });
  assert.strictEqual(seen.length, 1);
  assert.ok(seen[0].includes('maxLenght'));
  assert.strictEqual(v.isValidObject({ a: 'x' }), true, 'log mode still compiles');
  ok('log mode warns through the logger and keeps compiling');
}

// --- what must NOT be flagged ------------------------------------------------
{
  const fine = [
    { type: 'object', 'x-strict': false, properties: { a: { type: 'string' } } },
    { type: 'object', properties: { maxLenght: { type: 'string' } } },
    { enum: [{ maxLenght: 1 }], default: { typ: 2 } },
    { type: 'object', properties: { a: { type: 'string', maxLength: 3, format: 'email' } }, required: ['a'], additionalProperties: false },
    { allOf: [{ properties: { a: { minimum: 1 } } }], unevaluatedProperties: false },
    { type: 'object', properties: { n: { type: 'integer', nullable: true } }, errorMessage: { type: 'x' } },
  ];
  for (const schema of fine) new Validator(schema, { strictSchema: true });
  ok('extension names, property names, data values and ata keywords pass');
}

// --- custom keywords registered through the option are known ------------------
{
  new Validator(
    { type: 'string', myKeyword: 1 },
    { strictSchema: true, keywords: { myKeyword: { validate: () => true } } },
  );
  assert.throws(() => new Validator({ type: 'string', myKeyword: 1 }, { strictSchema: true }));
  ok('a registered keyword passes and the same name unregistered does not');
}

// --- the compat shim's strict options ----------------------------------------
{
  assert.throws(() => new Compat({ strict: true }).compile(MISTYPED), /strict mode: unknown keyword/);
  assert.throws(() => new Compat({ strictSchema: true }).compile(MISTYPED));
  // The specific option wins over the umbrella, in both directions.
  new Compat({ strict: true, strictSchema: false }).compile(MISTYPED);
  assert.throws(() => new Compat({ strict: false, strictSchema: true }).compile(MISTYPED));
  // Off stays off.
  new Compat({}).compile(MISTYPED);
  new Compat({ strict: false }).compile(MISTYPED);
  ok('compat strict/strictSchema enforce, and precedence follows the specific option');
}

// --- compat log mode through its logger --------------------------------------
{
  const seen = [];
  new Compat({ strict: 'log', logger: { warn: (m) => seen.push(m), log() {}, error() {} } }).compile(MISTYPED);
  assert.strictEqual(seen.length, 1);
  const silent = new Compat({ strict: 'log', logger: false });
  silent.compile(MISTYPED); // nothing to assert beyond not throwing and not printing
  ok('compat log mode uses the logger and logger:false is silent');
}

// --- the two checks that complete issue #44 ----------------------------------
{
  assert.throws(
    () => new Validator({ type: 'string', minimum: 3 }, { strictSchema: true }),
    /"minimum" has no effect here/,
  );
  assert.throws(
    () => new Validator({ type: 'object', properties: { a: { type: 'string' } }, required: ['b'], additionalProperties: false }, { strictSchema: true }),
    /nothing can satisfy this schema/,
  );
  // and the shapes these must NOT flag
  new Validator({ type: ['string', 'number'], minLength: 1, minimum: 0 }, { strictSchema: true });
  new Validator({ minimum: 3 }, { strictSchema: true });
  new Validator({ type: 'object', properties: { a: {} }, required: ['b'] }, { strictSchema: true });
  new Validator({ type: 'object', properties: { a: {} }, required: ['b'], additionalProperties: false, patternProperties: { '^b$': {} } }, { strictSchema: true });
  ok('an inert keyword and an unsatisfiable required are reported, their lookalikes are not');
}

// --- the build refuses what strict mode refuses -------------------------------
{
  const fs = require('node:fs');
  const os = require('node:os');
  const path = require('node:path');
  const { execFileSync } = require('node:child_process');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-strict-'));
  const bad = path.join(dir, 'bad.schema.json');
  fs.writeFileSync(bad, JSON.stringify({ type: 'object', properties: { a: { type: 'string', maxLenght: 3 } } }));
  const cli = path.join(__dirname, '..', 'bin', 'ata.js');
  const out = path.join(dir, 'out.mjs');
  // without the flag the typo compiles, which is the disease
  execFileSync(process.execPath, [cli, 'compile', bad, '-o', out], { stdio: 'ignore' });
  assert.ok(fs.existsSync(out));
  fs.rmSync(out);
  // with it the compile fails, no module is written, and the message names the fix
  let failed = false, message = '';
  try {
    execFileSync(process.execPath, [cli, 'compile', bad, '--strict-schema', '-o', out], { encoding: 'utf8' });
  } catch (e) {
    failed = true;
    message = String(e.stdout || '') + String(e.stderr || '');
  }
  assert.ok(failed, 'the compile exits non-zero');
  assert.ok(!fs.existsSync(out), 'and writes no module');
  assert.ok(message.includes('did you mean "maxLength"?'));
  fs.rmSync(dir, { recursive: true, force: true });
  ok('ata compile --strict-schema fails the build a typo would have poisoned');
}

// --- an AOT module that cannot carry error detail says so ---------------------
{
  const { toStandaloneModule } = require('../build.js');
  // unevaluated* next to a $ref is genuinely undecidable for the generator:
  // the referenced schema's annotations cannot be proven local, so this shape
  // stays degraded even now that provably-local unevaluated* compiles.
  const degraded = { $defs: { base: { properties: { on: { type: 'boolean' } } } }, type: 'object', allOf: [{ $ref: '#/$defs/base' }], unevaluatedProperties: false };
  const seen = [];
  const src = toStandaloneModule(degraded, { abortEarly: false, onWarning: (w) => seen.push(w) });
  assert.ok(typeof src === 'string' && src.length > 0, 'the module still ships');
  assert.strictEqual(seen.length, 1, 'and the degradation is reported once');
  assert.ok(seen[0].includes('error detail could not be generated'));
  assert.ok(src.includes('NOTE: error detail was requested'), 'the emitted header says it too');
  // a schema whose error path generates fine must not warn
  const quiet = [];
  toStandaloneModule({ type: 'object', properties: { a: { type: 'string' } }, required: ['a'] }, { abortEarly: false, onWarning: (w) => quiet.push(w) });
  assert.strictEqual(quiet.length, 0);
  // and asking for abortEarly on purpose is not a degradation
  const chosen = [];
  toStandaloneModule(degraded, { abortEarly: true, onWarning: (w) => chosen.push(w) });
  assert.strictEqual(chosen.length, 0);
  ok('AOT error-detail degradation is loud, and only when it is a degradation');
}

console.log(`\n${passed} passed, 0 failed`);
