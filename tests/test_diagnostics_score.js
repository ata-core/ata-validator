'use strict';

// Scores rendered diagnostics against four yes/no questions. This is the only
// thing that licenses a claim that the failure path got better, so it runs on
// master before any change and its output goes into the spec.
const { Validator, renderPretty } = require('..');
const { CASES } = require('./fixtures/diagnostics-corpus');

// The floor is raised deliberately as tasks land. Task 1 records the baseline;
// later tasks raise this number and must justify it with a run.
const FLOOR = Number(process.env.ATA_SCORE_FLOOR || 0);

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
    // 2. States what was found, not only the rule.
    found: /found |got /.test(block),
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
    const out = renderPretty(r.errors, { color: 'never' });
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
