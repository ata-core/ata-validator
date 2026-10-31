'use strict';

// ata turns schemas into JavaScript: at run time through new Function, ahead
// of time into modules. A schema can come from outside the program (a form
// builder, an API that stores user schemas), so text in it must never become
// code. Every place a schema carries a string gets strings built to break out
// of a literal, a comment or a template; each one, if it ran, sets a global.
// Every schema goes through every path that emits code, is used on documents
// that carry the same strings, and has its errors read and rendered. The
// global must stay unset, and the engines must agree. The test counts how many
// schemas each path compiled, so it cannot pass by declining them all.

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Validator, renderPretty, renderCompact } = require('..');
const { compiledModuleFor, compiledSchemaFor, toStandaloneModule, bundleStandalone, bundleCompact } = require('../build');
const { fromCompiled } = require('../lib/compiled');
const { compileToJSCodegen, compileToJSCodegenWithErrors, compileToJSCombined } = require('../lib/js-compiler');
const Ata = require('../compat');

const MARK = '__ataInjected';
const hit = () => globalThis[MARK] !== undefined;
const set = `globalThis.${MARK}=1`;

// Every keyword whose value is written into generated source as a number.
const NUMERIC_KEYWORDS = ['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'multipleOf', 'minLength', 'maxLength', 'minItems', 'maxItems', 'minProperties', 'maxProperties', 'minContains', 'maxContains'];
// Strings shaped to read as an expression wherever the number is placed:
// after `<`, inside a division, inside a parenthesis, and plain digits in a
// string, which is not a number either.
const NUMERIC_PAYLOADS = [`0||(${set})`, `1);${set};(1`, `-1||(${set})`, `1e9||(${set})`, '5'];
function numericLeaf(kw, payload) {
  const t = /Length/.test(kw) ? 'string' : /Items|Contains/.test(kw) ? 'array' : /Properties/.test(kw) ? 'object' : 'number';
  const leaf = { type: t, [kw]: payload };
  if (/Contains/.test(kw)) leaf.contains = { type: 'number' };
  return leaf;
}

const PAYLOADS = [
  `'+(${set})+'`,
  `"+(${set})+"`,
  `\`+(${set})+\``,
  `\${${set}}`,
  `*/${set};/*`,
  `\n${set}//`,
  ` ${set}//`,
  ` ${set}//`,
  `\\'+(${set})+'`,
  `\\"+(${set})+"`,
  `')};${set};({'`,
  `"]);${set};(["`,
  `</script><script>${set}</script>`,
  `__proto__`,
  `constructor`,
  `a~1b~0c/d`,
  `#/$defs/x`,
];

// Regular expressions are code too, so patterns get payloads that are valid
// regexes: quotes, backslashes and template markers inside a character class
// or escaped.
const PATTERNS = [
  `^['"\`]+$`,
  `^\\$\\{x\\}$`,
  `^[^\\\\]*$`,
  `^a\\/b$`,
  `^\\*/x$`,
  `^[\\u2028]?ok$`,
];

function schemasFor(p) {
  const s = [];
  s.push({ type: 'object', properties: { [p]: { type: 'string', maxLength: 3 } }, required: [p], additionalProperties: false });
  s.push({ type: 'object', properties: { k: { enum: [p, 1, null] } } });
  s.push({ type: 'object', properties: { k: { const: p } } });
  s.push({ type: 'object', properties: { k: { const: { [p]: p } } } });
  s.push({ type: 'object', properties: { k: { type: 'string', default: p } } });
  s.push({ title: p, description: p, $comment: p, type: 'object', properties: { k: { title: p, type: 'integer' } } });
  s.push({ type: 'object', dependentRequired: { [p]: ['k'] } });
  s.push({ type: 'object', propertyNames: { const: p } });
  s.push({ $defs: { [p]: { type: 'integer', minimum: 2 } }, type: 'object', properties: { k: { $ref: '#/$defs/' + encodeURIComponent(p.replace(/~/g, '~0').replace(/\//g, '~1')) } } });
  s.push({ type: 'object', properties: { k: { type: 'string', errorMessage: p } } });
  s.push({ type: 'object', properties: { k: { type: 'string', errorMessage: { type: p } } } });
  s.push({ type: 'array', items: { type: 'object', properties: { [p]: { oneOf: [{ const: p }, { type: 'number' }] } } } });
  s.push({ type: 'object', properties: { k: { type: 'string', format: p } } });
  // Where the path is not known when the code is generated, the error is built
  // from literals at run time: nested under items, patternProperties,
  // additionalProperties and a $ref.
  s.push({ type: 'array', items: { type: 'object', required: [p] } });
  s.push({ type: 'object', patternProperties: { '^x': { type: 'object', required: [p] } } });
  s.push({ type: 'array', items: { type: 'object', dependentRequired: { a: [p] } } });
  s.push({ type: 'object', additionalProperties: { type: 'object', required: [p], properties: { [p]: { const: p } } } });
  s.push({ $defs: { d: { type: 'object', required: [p], properties: { [p]: { enum: [p] } } } }, type: 'array', items: { $ref: '#/$defs/d' } });
  return s;
}

function documentsFor(p) {
  return [
    { [p]: p },
    { [p]: 'ok' },
    { k: p },
    { k: 1 },
    { k: 'x', [p]: 5 },
    [{ [p]: p }, { [p]: 1 }, { [p]: 'z' }],
    {},
    p,
    [{}, { a: 1 }, { [p]: 1 }],
    { xa: {}, xb: { [p]: p }, q: {} },
  ];
}

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ata-inject-'));
let n = 0;
function load(src) {
  const f = path.join(dir, `m${n++}.cjs`);
  fs.writeFileSync(f, src);
  return require(f);
}

const count = { schemas: 0, codegen: 0, aot: 0, wrapper: 0, compared: 0, rendered: 0, refused: 0, numeric: 0 };
const diffs = [];
const shape = (r) => JSON.stringify(r.valid ? { valid: true } : { valid: false, n: r.errors.length, kw: r.errors.map((e) => e.keyword).sort() });

function check(schema, docs, label) {
  count.schemas++;
  let runtime, interp;
  try {
    runtime = new Validator(schema);
    interp = new Validator(schema, { engine: 'interpreter' });
    runtime.validate({});
  } catch (e) {
    // A schema ata refuses (an unresolvable $ref, a bad pattern) is fine, as
    // long as nothing ran while it was read.
    assert.ok(!hit(), `${label}: code ran while the schema was refused`);
    count.refused++;
    return;
  }
  if (runtime.engine() === 'codegen') count.codegen++;
  let compiled = null;
  let aotSrc = null;
  try { aotSrc = compiledModuleFor(schema, { format: 'cjs' }); } catch { aotSrc = null; }
  if (aotSrc) {
    count.aot++;
    compiled = fromCompiled(load(aotSrc), compiledSchemaFor(schema));
    count.wrapper++;
  }
  try { load(toStandaloneModule(schema, { format: 'cjs' })); } catch { /* declined */ }
  // The bundles hold one function per schema. They run on the documents below.
  const bundled = [];
  for (const make of [bundleStandalone, bundleCompact]) {
    let src = null;
    try { src = make([schema], { format: 'cjs' }); } catch { src = null; }
    if (!src) continue;
    const mod = load(src);
    const fns = Array.isArray(mod) ? mod : (mod && Array.isArray(mod.default) ? mod.default : Object.values(mod || {}));
    for (const f of fns) if (typeof f === 'function') bundled.push(f);
    count.bundled = (count.bundled || 0) + 1;
  }
  assert.ok(!hit(), `${label}: code ran while compiling`);
  for (const d of docs) {
    const text = JSON.stringify(d);
    const a = runtime.validate(JSON.parse(text));
    const b = interp.validate(JSON.parse(text));
    count.compared++;
    if (shape(a) !== shape(b)) diffs.push(`${label} on ${text}: ${shape(a)} vs ${shape(b)}`);
    if (compiled) {
      const c = compiled.validate(JSON.parse(text));
      if (shape(a) !== shape(c)) diffs.push(`${label} on ${text}: runtime ${shape(a)} vs compiled ${shape(c)}`);
    }
    const j = runtime.validateJSON(text);
    if (!j.valid) {
      renderPretty(j.errors, { color: 'never' });
      renderCompact(j.errors, { color: 'never' });
      count.rendered++;
    }
    runtime.isValidObject(JSON.parse(text));
    for (const f of bundled) {
      try { const r = f(JSON.parse(text)); if (r && r.errors) JSON.stringify(r.errors); } catch { /* a bundle entry may expect other arguments */ }
    }
    try { runtime.parse(JSON.parse(text)); count.parsed = (count.parsed || 0) + 1; } catch { /* parse declines some shapes, or rejects */ }
    assert.ok(!hit(), `${label}: code ran while validating ${text}`);
  }
}

try {
  for (const p of PAYLOADS) {
    schemasFor(p).forEach((s, i) => check(s, documentsFor(p), `payload ${JSON.stringify(p)} schema ${i}`));
  }
  for (const re of PATTERNS) {
    const docs = [{ k: `'"\`` }, { k: '${x}' }, { k: 'a/b' }, { k: '*/x' }, { k: 'ok' }, { k: '\\' }, { k: 1 }];
    check({ type: 'object', properties: { k: { type: 'string', pattern: re } } }, docs, `pattern ${re}`);
    check({ type: 'object', patternProperties: { [re]: { type: 'integer' } }, additionalProperties: false }, [{ [`'"\``]: 1 }, { ok: 'x' }, {}], `patternProperties ${re}`);
  }
  // Numeric keywords are written into generated source as literals, so a
  // value that is not a finite number must never get there: the gate hands
  // such a schema to the interpreted engine, at the root, under a property,
  // behind a $ref, in another document, and in every ahead-of-time output.
  for (const kw of NUMERIC_KEYWORDS) {
    for (const payload of NUMERIC_PAYLOADS) {
      const leaf = numericLeaf(kw, payload);
      const docs = [5, 1.5, 'abc', [1, 2], { a: 1, b: 2 }, { a: 5 }, { a: 'abc' }, { a: [1] }, { a: { x: 1 } }, [5, 'abc']];
      for (const [i, s] of [
        leaf,
        { type: 'object', properties: { a: leaf } },
        { type: 'array', items: leaf },
        { $defs: { n: leaf }, type: 'object', properties: { a: { $ref: '#/$defs/n' } } },
        { type: 'object', properties: { a: { allOf: [leaf] } } },
      ].entries()) {
        const label = `numeric ${kw} ${JSON.stringify(payload)} schema ${i}`;
        check(s, docs, label);
        count.numeric++;
        const v = new Validator(s);
        v.validate(docs[0]);
        assert.notStrictEqual(v.engine(), 'codegen', `${label}: the generators must decline a non-numeric bound`);
        assert.strictEqual(compileToJSCodegen(s, null, undefined), null, `${label}: compileToJSCodegen must decline`);
        assert.strictEqual(compileToJSCodegenWithErrors(s, null, undefined), null, `${label}: compileToJSCodegenWithErrors must decline`);
        assert.strictEqual(compileToJSCombined(s, { valid: true, errors: [] }, null, undefined), null, `${label}: compileToJSCombined must decline`);
        for (const make of [() => toStandaloneModule(s, { format: 'cjs' }), () => compiledModuleFor(s, { format: 'cjs' }), () => bundleStandalone([s], { format: 'cjs' }), () => bundleCompact([s], { format: 'cjs' })]) {
          let src = null;
          try { src = make(); } catch { src = null; }
          if (typeof src === 'string') assert.ok(!src.includes(MARK), `${label}: the payload reached an ahead-of-time module`);
        }
      }
      // A document in the schema map, reached through a reference from the
      // schema being compiled, and the same through the compat shim.
      const external = { $id: 'http://example.com/num', ...leaf };
      check({ type: 'object', properties: { a: { $ref: 'http://example.com/num' } }, $defs: {} }, docs, `numeric ${kw} external`);
      {
        const v = new Validator({ type: 'object', properties: { a: { $ref: 'http://example.com/num' } } }, { schemas: [external] });
        v.validate({ a: 5 });
        assert.notStrictEqual(v.engine(), 'codegen', `numeric ${kw} ${JSON.stringify(payload)}: a referenced document with a non-numeric bound must decline`);
        assert.ok(!hit(), `numeric ${kw}: code ran through a referenced document`);
        const a = new Ata();
        a.addSchema(external);
        const f = a.compile({ $ref: 'http://example.com/num' });
        f(5); f('abc'); f([1]); f({ a: 1 });
        assert.ok(!hit(), `numeric ${kw}: code ran through the compat shim`);
      }
    }
  }
  // The interpreted engine, with code generation blocked, must read the same
  // schemas without running anything either.
  {
    const script = `
      process.env.ATA_NO_NATIVE = '1';
      globalThis.eval = () => { throw new EvalError('blocked') };
      const RealFunction = Function;
      Object.defineProperty(globalThis, 'Function', { value: new Proxy(RealFunction, { construct() { throw new EvalError('blocked') }, apply(t, th, a) { if (a.length) throw new EvalError('blocked'); return Reflect.apply(t, th, a) } }), writable: true, configurable: true });
      const { Validator } = require(${JSON.stringify(path.join(__dirname, '..'))});
      const schemas = JSON.parse(${JSON.stringify(JSON.stringify(NUMERIC_KEYWORDS.flatMap((kw) => NUMERIC_PAYLOADS.map((p) => ({ type: 'object', properties: { a: numericLeaf(kw, p) } })))))});
      for (const s of schemas) { const v = new Validator(s); for (const d of [{ a: 5 }, { a: 'abc' }, { a: [1] }, { a: { x: 1 } }]) { v.validate(d); v.isValidObject(d); v.validateJSON(JSON.stringify(d)) } }
      console.log(globalThis[${JSON.stringify(MARK)}] === undefined ? 'clean' : 'RAN');
    `;
    const r = require('child_process').spawnSync(process.execPath, ['-e', script], { encoding: 'utf8' });
    assert.strictEqual(r.stdout.trim(), 'clean', `interpreter with codegen blocked: ${r.stdout} ${r.stderr}`);
  }
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}

assert.ok(!hit(), 'a schema string ran as code');
if (diffs.length) {
  console.log(diffs.slice(0, 10).join('\n'));
  assert.fail(`${diffs.length} answers differ between engines`);
}
// The test only proves something if the paths that emit code ran.
assert.ok(count.codegen >= 150, `too few schemas on generated code: ${count.codegen}`);
assert.ok(count.aot >= 150, `too few ahead-of-time modules: ${count.aot}`);
assert.ok(count.rendered >= 500, `too few error lists rendered: ${count.rendered}`);
assert.ok((count.bundled || 0) >= 300, `too few bundles: ${count.bundled}`);
console.log(`ok: no schema string ran as code (${JSON.stringify(count)})`);
