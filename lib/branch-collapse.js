'use strict';

const SEVERITY = {
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
const DEFAULT_SEVERITY = 4;

function scoreBranch (errors) {
  if (!errors || errors.length === 0) return 0;
  let sum = 0;
  for (const e of errors) sum += SEVERITY[e.keyword] || DEFAULT_SEVERITY;
  return errors.length * 100 + sum; // primary: count, secondary: severity
}

/**
 * Given an array of branch result objects ({ valid, errors }) for a oneOf
 * or anyOf, pick the best branch and emit a single user-facing error.
 *
 * @param keyword 'oneOf' | 'anyOf'
 * @param branchResults Array<{ valid, errors, title? }>
 * @param parentPath JSON pointer to the data location
 * @param parentSchemaPath JSON pointer to the keyword in the schema
 * @returns A ValidationError-shaped object, or null if branch passed (caller treats as success).
 */
function collapseBranches ({ keyword, branchResults, parentPath, parentSchemaPath }) {
  const passing = branchResults.filter(b => b.valid);
  if (keyword === 'oneOf') {
    if (passing.length === 1) return null;
    if (passing.length > 1) {
      return {
        code: 'ATA4002', keyword: 'oneOf', path: parentPath || '',
        message: `value matched ${passing.length} of ${branchResults.length} oneOf variants, expected exactly one`,
        schemaPath: parentSchemaPath,
        params: { matched: passing.length, total: branchResults.length },
      };
    }
    // 0 matched, find best
    return buildBranchError('ATA4001', 'oneOf', branchResults, parentPath, parentSchemaPath);
  }
  // anyOf
  if (passing.length >= 1) return null;
  return buildBranchError('ATA4003', 'anyOf', branchResults, parentPath, parentSchemaPath);
}

function buildBranchError (code, keyword, branchResults, parentPath, parentSchemaPath) {
  let bestIdx = 0;
  let bestScore = Infinity;
  for (let i = 0; i < branchResults.length; i++) {
    const s = scoreBranch(branchResults[i].errors);
    if (s < bestScore) { bestScore = s; bestIdx = i; }
  }
  const best = branchResults[bestIdx];
  const variantName = best.title || `variant ${bestIdx + 1}`;
  return {
    code, keyword, path: parentPath || '',
    message: `value matched 0 of ${branchResults.length} ${keyword} variants`,
    schemaPath: parentSchemaPath,
    params: { variants: branchResults.length, closest: bestIdx, closestName: variantName },
    branchErrors: best.errors, // surfaced in pretty render
  };
}

module.exports = { collapseBranches, scoreBranch, SEVERITY };
