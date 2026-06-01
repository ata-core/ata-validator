'use strict';

// Async refinement: JSON Schema is synchronous by design, so async business
// checks (uniqueness, remote lookups) live on the `/t` builder via t.refine().
// A refinement is carried on a Symbol key — invisible to JSON Schema codegen,
// so `new Validator(schema)` still does plain structural validation and ignores
// it. validateAsync() runs structural validation first, then awaits the
// refinements only when the value is structurally valid.

const assert = require('assert');
const { t } = require('../t.js');
const { Validator, validateAsync, parseAsync, Infer } = require('../index.js');

let passed = 0;
function ok (name, cond) { assert.ok(cond, name); passed++; }

async function main () {
  // 0. A refined schema is still plain JSON Schema for structural validation.
  {
    const S = t.refine(t.object({ name: t.string({ minLength: 1 }) }), () => true);
    const v = new Validator(S);
    ok('refined schema validates structurally (sync, ignores refinement)', v.validate({ name: 'ok' }).valid);
    ok('refined schema rejects structural violation', !v.validate({ name: '' }).valid);
    // Symbol marker must not leak into JSON output / codegen.
    ok('refinement not visible to Object.keys', !Object.keys(S).includes('refinements'));
    ok('refinement not visible to JSON.stringify', JSON.stringify(S).indexOf('refine') === -1);
  }

  // 1. Async refinement that passes.
  {
    const taken = new Set(['admin', 'root']);
    const Signup = t.refine(
      t.object({ username: t.string({ minLength: 3 }), email: t.string({ format: 'email' }) }),
      async (value) => { await Promise.resolve(); return !taken.has(value.username); },
      { message: 'username is already taken', path: '/username' },
    );

    const okRes = await validateAsync(Signup, { username: 'mert', email: 'a@b.com' });
    ok('async refine passes -> valid', okRes.valid === true);
    ok('async refine passes -> no errors', okRes.errors.length === 0);

    const badRes = await validateAsync(Signup, { username: 'admin', email: 'a@b.com' });
    ok('async refine fails -> invalid', badRes.valid === false);
    ok('async refine fails -> message', badRes.errors.some((e) => e.message === 'username is already taken'));
    ok('async refine fails -> path', badRes.errors.some((e) => (e.instancePath || e.path) === '/username'));
    ok('async refine fails -> keyword refine', badRes.errors.some((e) => e.keyword === 'refine'));
  }

  // 2. Structural failure short-circuits: refinement is NOT called.
  {
    let called = false;
    const S = t.refine(
      t.object({ age: t.integer({ minimum: 0 }) }),
      () => { called = true; return true; },
      { message: 'refine ran' },
    );
    const r = await validateAsync(S, { age: 'not a number' });
    ok('structural fail -> invalid', !r.valid);
    ok('structural fail -> refinement skipped', called === false);
    ok('structural fail -> structural error present', r.errors.some((e) => e.keyword === 'type'));
  }

  // 3. Multiple refinements compose; all are evaluated, all failures collected.
  {
    const S = t.refine(
      t.refine(
        t.object({ a: t.integer(), b: t.integer() }),
        (v) => v.a < v.b,
        { message: 'a must be less than b', path: '/a' },
      ),
      async (v) => v.a + v.b === 10,
      { message: 'a + b must equal 10', path: '' },
    );

    const r = await validateAsync(S, { a: 8, b: 5 });
    ok('compose: invalid', !r.valid);
    ok('compose: first refine failure', r.errors.some((e) => e.message === 'a must be less than b'));
    ok('compose: second refine failure', r.errors.some((e) => e.message === 'a + b must equal 10'));

    const r2 = await validateAsync(S, { a: 4, b: 6 });
    ok('compose: all pass -> valid', r2.valid === true);
  }

  // 4. Sync boolean refinements also work through validateAsync.
  {
    const S = t.refine(t.string(), (v) => v.startsWith('x'), { message: 'must start with x' });
    ok('sync refine pass', (await validateAsync(S, 'xyz')).valid === true);
    ok('sync refine fail', (await validateAsync(S, 'abc')).valid === false);
  }

  // 5. validateAsync on a schema with no refinements == structural result.
  {
    const S = t.object({ id: t.integer({ minimum: 1 }) });
    ok('no refine: valid', (await validateAsync(S, { id: 3 })).valid === true);
    ok('no refine: invalid', (await validateAsync(S, { id: 0 })).valid === false);
  }

  // 6. validateAsync accepts an existing Validator instance + the schema.
  {
    const S = t.refine(t.object({ n: t.integer() }), async (v) => v.n !== 13, { message: 'unlucky' });
    const v = new Validator(S);
    const r = await validateAsync(v, { n: 13 });
    ok('validator instance: refine fail', !r.valid && r.errors.some((e) => e.message === 'unlucky'));
  }

  // 7. parseAsync resolves to data on success, rejects with .errors on failure.
  {
    const S = t.refine(t.object({ name: t.string() }), async (v) => v.name.length > 0, { message: 'empty name' });
    const data = await parseAsync(S, { name: 'mert' });
    ok('parseAsync: resolves to data', data && data.name === 'mert');

    let threw = null;
    try { await parseAsync(S, { name: '' }); } catch (e) { threw = e; }
    ok('parseAsync: rejects on failure', threw !== null);
    ok('parseAsync: error carries errors[]', threw && Array.isArray(threw.errors) && threw.errors.length > 0);
  }

  console.log(`test_async_refine: ${passed} assertions passed`);
}

main().catch((e) => { console.error(e); process.exit(1); });
