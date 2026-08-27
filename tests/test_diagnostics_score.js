'use strict';

// Scores rendered diagnostics against four yes/no questions. This is the only
// thing that licenses a claim that the failure path got better, so it runs on
// master before any change and its output goes into the spec.
const { Validator, renderPretty } = require('..');
const { CASES } = require('./fixtures/diagnostics-corpus');

// Measured: 3/60 (5%) on 80e54a7 before the diagnostic layer, 58/58 (100%)
// after it. The floor sits below the measured figure on purpose: a new corpus
// case that exposes a real gap should be addable without first fixing it,
// while any regression on the shapes already covered still fails the suite.
const FLOOR = Number(process.env.ATA_SCORE_FLOOR || 95);

// A diagnostic block is the text between blank lines, minus the trailing
// summary line renderPretty appends.
function blocksOf (out) {
  return out
    .split('\n\n')
    .filter((b) => b.startsWith('error[') || b.startsWith('error:'))
    .filter((b) => !/^error: \d+ schema violation/.test(b));
}

function scoreBlock (block, allBlocks) {
  return {
    // 1. Says where: a frame arrow, or a dotted path in parentheses.
    where: /-->/.test(block) || /\(body[.[)]/.test(block),
    // 2. States what was found, not only the rule. For a key-shape error the
    //    observation is the key itself: an unknown key names what was found,
    //    a missing key names what was looked for and not found.
    found: /found |got |unknown property "|missing required property "/.test(block),
    // 3. Distinguishable from every other block in the same output.
    unique: allBlocks.filter((b) => b === block).length === 1,
    // 4. Offers a way forward.
    forward: /= help:/.test(block) || /expected /.test(block),
  };
}

let total = 0;
let good = 0;
const rows = [];

for (const c of CASES) {
  for (const mode of ['json', 'object']) {
    const v = new Validator(c.schema, { allErrors: true });
    const r = mode === 'json' ? v.validateJSON(c.json) : v.validate(c.data);
    if (r.valid) throw new Error(`corpus case ${c.name} (${mode}) unexpectedly validated`);
    // Object input carries no payload; frames are requested by handing the
    // renderer the data, which is the documented way.
    const out = renderPretty(r.errors, mode === 'json' ? { color: 'never' } : { color: 'never', data: c.data });
    const blocks = blocksOf(out);
    if (blocks.length === 0) throw new Error(`corpus case ${c.name} (${mode}) rendered no diagnostic blocks`);
    for (const b of blocks) {
      const s = scoreBlock(b, blocks);
      total++;
      if (s.where && s.found && s.unique && s.forward) good++;
      else rows.push(`${c.name}/${mode}: ${Object.entries(s).filter(([, v2]) => !v2).map(([k]) => k).join(',')}`);
    }
  }
}

const pct = total === 0 ? 0 : Math.round((good / total) * 1000) / 10;
console.log(`SCORE: ${good}/${total} (${pct}%)`);
if (rows.length) {
  console.log('failing dimensions:');
  for (const row of rows.slice(0, 40)) console.log('  ' + row);
  if (rows.length > 40) console.log(`  ... and ${rows.length - 40} more`);
}
if (pct < FLOOR) {
  console.error(`FAIL: score ${pct}% is below floor ${FLOOR}%`);
  process.exit(1);
}
console.log('ok: diagnostics score computed');
