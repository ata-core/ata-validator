'use strict';

// Branch collapse: when no branch of an anyOf or oneOf matches, listing every
// branch's errors tells a reader that nothing fit without telling them which
// branch they meant. This scores the branches, reports the one that came
// closest, and keeps its errors under `branchErrors` for the pretty renderer.
//
// There is one implementation, and it is `__ataCollapse` below. A standalone
// module imports nothing, so the generated code cannot require this file; it
// carries a copy emitted by `embedSource()` from these very functions instead
// of a second hand-written one. That is why the internals are written in the
// positional form the generated code calls, and why `__ataCollapse` may close
// over nothing but `__ataScore` and the severity table: whatever it reaches
// has to be in the embed too.

// How much a failing keyword says about intent. A branch that fails on `type`
// was probably not the branch the author meant; one that fails on `minLength`
// probably was, and is the better thing to show. The error count dominates, so
// a branch with one complaint always beats a branch with three.
const __ATA_SEVERITY = {
  type: 10,
  const: 8,
  enum: 8,
  required: 5,
  format: 3,
  minLength: 3,
  maxLength: 3,
  minimum: 3,
  maximum: 3,
  pattern: 3,
  additionalProperties: 2,
  unevaluatedProperties: 2,
  unevaluatedItems: 2,
};

function __ataScore (errs) {
  if (!errs || !errs.length) return 0;
  let s = 0;
  for (const e of errs) s += __ATA_SEVERITY[e.keyword] || 4;
  return errs.length * 100 + s; // primary: count, secondary: severity
}

// `br` is one entry per branch in declaration order: {valid, errors, title}.
// Returns the single error to report, or null when the keyword is satisfied.
function __ataCollapse (kw, br, pp, sp, o) {
  const pass = br.filter((b) => b.valid);
  if (kw === 'oneOf') {
    if (pass.length === 1) return null;
    if (pass.length > 1) {
      const passIdx = [];
      for (let i = 0; i < br.length; i++) if (br[i].valid) passIdx.push(i);
      return {
        code: 'ATA4002',
        keyword: 'oneOf',
        instancePath: pp || '',
        path: pp || '',
        schemaPath: sp,
        _o: o,
        message: 'value matched ' + pass.length + ' of ' + br.length + ' oneOf variants, expected exactly one',
        params: { passingSchemas: passIdx },
      };
    }
  } else if (pass.length >= 1) {
    return null;
  }
  let bi = 0;
  let bs = Infinity;
  for (let i = 0; i < br.length; i++) {
    const s = __ataScore(br[i].errors);
    if (s < bs) { bs = s; bi = i; }
  }
  const best = br[bi];
  return {
    code: kw === 'oneOf' ? 'ATA4001' : 'ATA4003',
    keyword: kw,
    instancePath: pp || '',
    path: pp || '',
    schemaPath: sp,
    _o: o,
    message: 'value matched 0 of ' + br.length + ' ' + kw + ' variants',
    params: { variants: br.length, closest: bi, closestName: best.title || ('variant ' + (bi + 1)) },
    branchErrors: best.errors,
  };
}

// The named-argument form the interpreter and the tests call.
function collapseBranches ({ keyword, branchResults, parentPath, parentSchemaPath, ordinal }) {
  return __ataCollapse(keyword, branchResults, parentPath, parentSchemaPath, ordinal === undefined ? null : ordinal);
}

// The three declarations as source, for the generated code to carry. Derived
// from the functions above rather than written out again, so a fix to one
// cannot miss the other. `tests/test_branch_collapse.js` runs both.
function embedSource () {
  return 'const __ATA_SEVERITY=' + JSON.stringify(__ATA_SEVERITY) + ';' +
    'const __ataScore=' + __ataScore.toString() + ';' +
    'const __ataCollapse=' + __ataCollapse.toString() + ';';
}

module.exports = { collapseBranches, scoreBranch: __ataScore, SEVERITY: __ATA_SEVERITY, embedSource };
