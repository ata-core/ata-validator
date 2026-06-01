'use strict';

// Async refinement support for the `/t` builder.
//
// JSON Schema is synchronous by design and cannot express a check that needs to
// await (uniqueness, a remote lookup, cross-field business rules). Those live on
// the builder via `t.refine(schema, check, opts)`. A refinement is carried on a
// Symbol key (like the OPTIONAL marker), so it is invisible to Object.keys,
// JSON.stringify, and ata's codegen: `new Validator(schema)` still performs
// plain structural validation and ignores refinements entirely.
//
// `validateAsync()` (in index.js) runs structural validation first and only
// awaits the refinements when the value is structurally valid — a refinement
// body may assume the value already has the right shape.

const REFINE = Symbol.for('ata.t.refine');

// Pull the refinement list off a schema node, or null when there is none.
function getRefinements (schema) {
  if (!schema || typeof schema !== 'object') return null;
  const r = schema[REFINE];
  return Array.isArray(r) && r.length ? r : null;
}

// Attach a refinement to a schema, composing with any already present. Returns a
// new object; the input is not mutated. Enumerable Symbol keys (OPTIONAL, prior
// refinements) are copied by the spread, then the refinement list is replaced.
function attach (schema, check, opts) {
  if (typeof check !== 'function') {
    throw new TypeError('t.refine(schema, check, opts?) — check must be a function');
  }
  const prev = (schema && Array.isArray(schema[REFINE])) ? schema[REFINE] : [];
  const o = opts || {};
  const entry = { check, message: o.message, path: o.path || '' };
  return Object.assign({}, schema, { [REFINE]: prev.concat(entry) });
}

// Build a single refinement issue in the validator's error shape.
function issue (entry, message) {
  return {
    keyword: 'refine',
    instancePath: entry.path || '',
    path: entry.path || '',
    schemaPath: '',
    params: {},
    message: message != null ? message : (entry.message || 'value failed refinement'),
  };
}

// Evaluate every refinement against `data`, awaiting async checks concurrently.
// A check that returns falsy — or throws — yields an issue. Returns the issues
// array (empty when all pass).
async function runRefinements (refinements, data) {
  const issues = [];
  await Promise.all(refinements.map(async (entry) => {
    let passed;
    try {
      passed = await entry.check(data);
    } catch (e) {
      issues.push(issue(entry, entry.message || (e && e.message) || 'refinement threw'));
      return;
    }
    if (!passed) issues.push(issue(entry));
  }));
  return issues;
}

module.exports = { REFINE, getRefinements, attach, runRefinements };
