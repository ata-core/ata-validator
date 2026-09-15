// `validateJSON('[')` used to hang. One byte, any schema, the default
// configuration: the position map built to put a caret on the syntax error
// walked an array whose input had already ended, `walk` returned without
// moving, and the loop had no other way out.
//
// A regression here is an infinite loop, which a normal test cannot report
// because it never gets to fail. So the corpus runs in a child process with a
// watchdog: a hang becomes a timeout and a red test rather than a stuck run.
//
// The corpus is every prefix of a set of documents, which is the systematic
// way to reach "the input ends in the middle of a container", plus a set of
// characters inserted where they cannot start a value.

const assert = require('assert');
const path = require('path');
const { spawnSync } = require('child_process');

const DOCUMENTS = [
  '[]',
  '[1,2,3]',
  '[[1],[2]]',
  '{"a":1}',
  '{"a":[1,2],"b":{"c":"d"}}',
  '[{"a":1},{"b":[true,null]}]',
  '{"a":"x","b":[[[1]]]}',
  '[" ",",","]","}"]',
  '{"\\u0061":[1]}',
  '[1e5,-0.5,true,null,"s"]',
];
const INSERTS = ['}', ']', ',', ':', '"', '\\', '{', '[', ' ', ''];

function corpus() {
  const out = [];
  for (const doc of DOCUMENTS) {
    for (let k = 0; k <= doc.length; k++) out.push(doc.slice(0, k));
    for (let k = 0; k <= doc.length; k++) {
      for (const ins of INSERTS) out.push(doc.slice(0, k) + ins + doc.slice(k));
    }
  }
  return out;
}

if (process.argv[2] === 'child') {
  const { Validator } = require('../index');
  const { buildDataPositionMap } = require('../lib/data-positions');
  const SCHEMAS = [
    true,
    { type: 'object', properties: { a: { type: 'string' } } },
    { type: 'array', items: { type: 'integer' } },
    { type: 'object', properties: { a: { type: 'array', items: { type: 'object' } } }, required: ['a'] },
  ];
  const texts = corpus();
  const validators = SCHEMAS.map((s) => new Validator(s));
  let n = 0;
  for (const text of texts) {
    // The map is built directly as well as through the validator, so a hang
    // is attributed to the walker rather than to whatever called it.
    try { buildDataPositionMap(text); } catch { /* malformed input may throw; it may not hang */ }
    for (const v of validators) {
      const r = v.validateJSON(text);
      assert.strictEqual(typeof r.valid, 'boolean');
      if (!r.valid) void r.errors; // errors are lazy, and the walk runs on access
      assert.strictEqual(typeof v.isValidJSON(text), 'boolean');
      n++;
    }
  }
  console.log(`${texts.length} malformed and truncated inputs, ${n} verdicts, all returned`);
  process.exit(0);
}

// Generous by default; the check this is making is "does it finish at all".
const TIMEOUT_MS = Number(process.env.ATA_TERMINATION_TIMEOUT_MS || 120000);
const child = spawnSync(process.execPath, [path.join(__dirname, path.basename(__filename)), 'child'], {
  encoding: 'utf8',
  timeout: TIMEOUT_MS,
});
if (child.error && child.error.code === 'ETIMEDOUT') {
  console.error(`FAIL: a malformed document did not terminate within ${TIMEOUT_MS}ms`);
  process.exit(1);
}
if (child.status !== 0) {
  console.error('FAIL: malformed-input run exited ' + child.status);
  if (child.stdout) console.error(child.stdout.trim());
  if (child.stderr) console.error(child.stderr.trim());
  process.exit(1);
}
process.stdout.write(child.stdout);
console.log('ok: malformed and truncated JSON always terminates');
