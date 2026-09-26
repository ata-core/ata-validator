'use strict';

// The error generator and the combined generator both report errors, and
// validate() takes its errors from one or the other depending on the schema
// and on whether a rejection has happened yet. test_codegen_entrypoint_agreement
// holds their verdicts together; nothing held what they report. This compares
// the reported errors, keyword, instancePath and schemaPath, of both generators
// against the interpreted engine, over the official suite and over schemas
// whose keys need escaping in generated source.
//
// The first run of this comparison found the combined generator putting the
// source escapes of a key into its errors: `#/properties/it\'s/type` for a
// property named it's, in instancePath as well as schemaPath.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const jc = require('../lib/js-compiler');
const { Validator } = require('..');

const VALID = Object.freeze({ valid: true, errors: Object.freeze([]) });
const key = (errors) => errors.map((e) => `${e.keyword}|${e.instancePath}|${e.schemaPath}`).sort().join('\n');

// The root false schema is here because its generators' shortcut named the
// keyword `false schema` where every nested false schema, and the interpreter,
// say `not`.
// Awkward keys: quotes, backslashes, pointer escapes, a newline.
const KEYS = ["it's", 'a\\b', 'a/b', 'a~b', 'x"y', "q'\\r", 'line\nbreak'];
const crafted = [[false, [1, 'x', null, {}]], [{ not: false }, [1]]];
for (const k of KEYS) {
  crafted.push([{ type: 'object', properties: { [k]: { type: 'string', minLength: 3 } }, required: [k] }, [{}, { [k]: 1 }, { [k]: 'x' }]]);
  crafted.push([{ type: 'object', properties: { o: { type: 'object', properties: { [k]: { type: 'integer', minimum: 5 } } } } }, [{ o: { [k]: 1 } }, { o: { [k]: 'x' } }]]);
  crafted.push([{ dependentSchemas: { [k]: { required: ['z'] } }, dependentRequired: { [k]: [k + '2'] } }, [{ [k]: 1 }]]);
  crafted.push([{ type: 'array', items: { type: 'object', properties: { [k]: { enum: [1, 2] } } } }, [[{ [k]: 3 }, { [k]: 1 }, { [k]: 'x' }]]]);
}

const groups = [];
for (const dialect of ['draft2020-12', 'draft7']) {
  const dir = path.join(__dirname, 'suite/tests', dialect);
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.json'))) {
    for (const g of JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))) {
      // The suite states the dialect by directory; say it in the schema, as the
      // suite runner does, or a draft-07 schema is read as 2020-12.
      const schema = dialect === 'draft7' && g.schema && typeof g.schema === 'object' && !('$schema' in g.schema)
        ? { ...g.schema, $schema: 'http://json-schema.org/draft-07/schema#' }
        : g.schema;
      groups.push([`${dialect}/${f}: ${g.description}`, schema, g.tests.map((t) => t.data)]);
    }
  }
}
crafted.forEach(([s, data], i) => groups.push([`crafted ${i}`, s, data]));

let compared = 0, bad = 0;
const report = (msg) => { bad++; if (process.env.ALLDIFF || bad <= 10) console.error(msg); };
for (const [label, schema, datas] of groups) {
  let B = null, C = null, interp = null;
  // The generators receive the schema the way the Validator hands it to them:
  // normalized, draft-07 rewritten into 2020-12 form.
  let normalized;
  try { normalized = new Validator(JSON.parse(JSON.stringify(schema)))._schemaObj; } catch { continue; }
  try { B = jc.compileToJSCodegenWithErrors(normalized, null, undefined); } catch {}
  try { C = jc.compileToJSCombined(normalized, VALID, null, undefined); } catch {}
  try { interp = new Validator(JSON.parse(JSON.stringify(schema)), { engine: 'interpreter' }); } catch { continue; }
  if (!B && !C) continue;
  for (const data of datas) {
    let ref;
    try { ref = interp.validate(data); } catch { continue; }
    const want = ref.valid ? '' : key(ref.errors);
    for (const [name, fn] of [['errors', B], ['combined', C]]) {
      if (!fn) continue;
      let r;
      try { r = name === 'errors' ? fn(data, true) : fn(data); } catch (e) { report(`${label}: the ${name} generator threw ${e.message}`); continue; }
      compared++;
      if (r.valid !== ref.valid) { report(`${label}: ${name} says ${r.valid}, interpreter ${ref.valid} on ${JSON.stringify(data)}`); continue; }
      if (!r.valid && key(r.errors) !== want) {
        report(`${label}: ${name} errors differ on ${JSON.stringify(data)}\n  got  ${key(r.errors).replace(/\n/g, ' ; ')}\n  want ${want.replace(/\n/g, ' ; ')}`);
      }
    }
  }
}

assert.strictEqual(bad, 0, `${bad} disagreements between a generator and the interpreted engine`);
assert.ok(compared > 2000, `only ${compared} generator results compared`);
console.log(`ok: generator error content matches the interpreter on ${compared} results`);
