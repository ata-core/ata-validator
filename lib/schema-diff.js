'use strict';

// What a change to a schema does to documents: which ones the old schema
// accepted and the new one rejects (a client sending what used to pass gets a
// 400), and which ones the new one accepts and the old one did not (a rule
// was loosened). Reading two schemas side by side tells you which keywords
// changed; it does not tell you which documents change verdict, and that is
// the question before a deploy. The documents come from `generate` in
// lib/verify.js, made from both schemas, half of them with one rule broken,
// plus the values on either side of every bound, plus the project's own
// samples. Generated documents are a sample, not a proof: a change this
// finds is real, one it does not find may still exist.

const { Validator } = require('../index.js');
const { generate, readSamples } = require('./verify');

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));
const errorKey = (e) => `${e.keyword || ''}@${e.instancePath || ''}`;
const first = (errors) => (errors && errors.length ? errors[0] : { keyword: 'validation', instancePath: '', message: 'validation failed' });

// `samples`: paths of JSON or JSON Lines files, or directories of them.
function diffSchemas (oldSchema, newSchema, { generate: count = 200, seed = 1, samples = [] } = {}) {
  const before = new Validator(oldSchema);
  const after = new Validator(newSchema);
  const docs = [];
  const seen = new Set();
  const add = (doc, source) => {
    if (doc === undefined) return;
    const key = JSON.stringify(doc);
    if (seen.has(key)) return;
    seen.add(key);
    docs.push({ doc, source });
  };
  for (const d of generate(oldSchema, count, seed, (x) => before.isValidObject(clone(x)))) add(d, 'generated from the old schema');
  for (const d of generate(newSchema, count, seed + 1, (x) => after.isValidObject(clone(x)))) add(d, 'generated from the new schema');
  for (const s of readSamples(samples)) if (!s.bad) add(s.doc, s.source);

  const nowRejected = [];
  const nowAccepted = [];
  let bothAccept = 0;
  let bothReject = 0;
  for (const { doc, source } of docs) {
    const a = before.validate(clone(doc));
    const b = after.validate(clone(doc));
    if (a.valid && b.valid) bothAccept++;
    else if (!a.valid && !b.valid) bothReject++;
    else if (a.valid) nowRejected.push({ doc, source, error: first(b.errors) });
    else nowAccepted.push({ doc, source, error: first(a.errors) });
  }
  return {
    documents: docs.length,
    bothAccept,
    bothReject,
    nowRejected: grouped(nowRejected),
    nowAccepted: grouped(nowAccepted),
  };
}

// The documents of one kind, grouped by the rule that decides them (the
// first error's keyword and place), each group with one example: one of the
// project's own documents when the group holds one, since that is a document
// somebody actually sends, else the first generated one.
const generated = (source) => source.startsWith('generated');
function grouped (list) {
  const groups = new Map();
  for (const item of list) {
    const key = errorKey(item.error);
    let g = groups.get(key);
    if (g === undefined) groups.set(key, (g = { rule: key, message: item.error.message, count: 0, samples: 0, example: item.doc, source: item.source }));
    g.count++;
    if (!generated(item.source)) { g.samples++; if (generated(g.source)) { g.example = item.doc; g.source = item.source; } }
  }
  return { count: list.length, rules: [...groups.values()].sort((x, y) => y.count - x.count) };
}

function breaking (report) { return report.nowRejected.count > 0; }

function renderDiff (report, { json = false, oldName = 'old', newName = 'new' } = {}) {
  if (json) return JSON.stringify(report, null, 2);
  const lines = [];
  const show = (doc) => { const s = JSON.stringify(doc); return s.length > 120 ? s.slice(0, 117) + '...' : s; };
  lines.push(`${report.documents} documents: ${report.bothAccept} accepted by both, ${report.bothReject} rejected by both, ${report.nowRejected.count} rejected only by ${newName}, ${report.nowAccepted.count} accepted only by ${newName}`);
  if (report.nowRejected.count) {
    lines.push('');
    lines.push(`Rejected by ${newName}, accepted by ${oldName} (a client sending these gets a rejection after the change):`);
    for (const g of report.nowRejected.rules) {
      lines.push(`  ${g.rule}: ${g.count} ${g.count === 1 ? 'document' : 'documents'}${g.samples ? `, ${g.samples} of them the project's own` : ''}, ${g.message}`);
      lines.push(`    ${show(g.example)}${generated(g.source) ? '' : `  (${g.source})`}`);
    }
  }
  if (report.nowAccepted.count) {
    lines.push('');
    lines.push(`Accepted by ${newName}, rejected by ${oldName} (what ${oldName} refused with):`);
    for (const g of report.nowAccepted.rules) {
      lines.push(`  ${g.rule}: ${g.count} ${g.count === 1 ? 'document' : 'documents'}${g.samples ? `, ${g.samples} of them the project's own` : ''}, ${g.message}`);
      lines.push(`    ${show(g.example)}${generated(g.source) ? '' : `  (${g.source})`}`);
    }
  }
  if (!report.nowRejected.count && !report.nowAccepted.count) lines.push('No document changed verdict.');
  return lines.join('\n');
}

module.exports = { diffSchemas, renderDiff, breaking };
