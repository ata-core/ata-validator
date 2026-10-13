'use strict';

const { CODES, codeFor } = require('./error-codes');
const { suggestFor } = require('./suggestions');
const { reprValue, expectedFor, detailFor, rankFor, MISSING, DOC_BASE } = require('./enrich-error');

// Enrichment done where the error happens. The combined generator, once a
// validator's errors are being read, calls `makeRich` at each failure with a
// site record built at compile time by `errorSite` and the value it was
// checking, and gets the same object `enrich` would build from the raw error:
// same keys, same order, same values. What depends only on the site (code,
// docUrl, rank, and `expected` when the params are fixed) is worked out once,
// and the value comes from the generated code instead of a pointer walk. It is
// for validate(data) without positions or a schema source; those reads keep
// `enrich`. tests/test_rich_errors_generated.js holds the two to the same
// output. A module of its own because only the code generator reaches it, and
// ata-validator/lite, which enriches through `enrich`, should not carry it.
const NO_EXPECTED = {};
// `detail` (see detailFor in lib/enrich-error.js), worked out at the site as
// far as the site allows: the whole string when it depends only on the
// params, its fixed head when only the received value is left to append, and
// neither when it depends on the value (type) or the params are not fixed.
const DETAIL_AT_RUN = 0;
const DETAIL_FIXED = 1;
const DETAIL_HEAD = 2;
const RANGE_KEYWORDS = new Set(['minimum', 'maximum', 'exclusiveMinimum', 'exclusiveMaximum', 'minLength', 'maxLength']);
function siteDetail (keyword, params, expected) {
  if (params === undefined || keyword === 'type') return [DETAIL_AT_RUN, undefined];
  switch (keyword) {
    case 'required': return [DETAIL_FIXED, `missing required property "${params.missingProperty}"`];
    case 'additionalProperties': return [DETAIL_FIXED, `unknown property "${params.additionalProperty}"`];
    case 'unevaluatedProperties': return [DETAIL_FIXED, `unevaluated property "${params.unevaluatedProperty}"`];
    case 'format': return [DETAIL_HEAD, `not a valid ${params.format}: `];
  }
  if (RANGE_KEYWORDS.has(keyword) || expected) return [DETAIL_HEAD, `expected ${expected}, found `];
  return [DETAIL_FIXED, undefined];
}

function errorSite (keyword, schemaPath, params, format) {
  const dependent = keyword === 'required' && typeof schemaPath === 'string' && schemaPath.endsWith('/dependentRequired');
  const code = (dependent && 'ATA7005') || codeFor(keyword, format) || 'ATA9001';
  const expected = params === undefined ? NO_EXPECTED : expectedFor({ keyword, params });
  const [detailKind, detail] = siteDetail(keyword, params, expected);
  return {
    code,
    keyword,
    schemaPath,
    docUrl: DOC_BASE + code,
    rank: rankFor(keyword),
    headline: (CODES[code] && CODES[code].headline) || 'validation failed',
    expected,
    detailKind,
    detail,
  };
}

function makeRich (site, path, params, message, value, root, spPrefix) {
  // As resolveAt: a root that is null, undefined, '' or NaN resolves nothing.
  const at = (!root && root !== 0 && root !== false) ? MISSING : value;
  const out = {
    code: site.code,
    message: message || site.headline,
    keyword: site.keyword,
    path,
    expected: site.expected === NO_EXPECTED ? expectedFor({ keyword: site.keyword, params }) : site.expected,
    received: at === MISSING ? undefined : reprValue(at),
    schemaPath: spPrefix === undefined ? site.schemaPath : spPrefix + site.schemaPath,
    docUrl: site.docUrl,
    instancePath: path,
    dataPath: path,
    params,
    parentSchema: undefined,
  };
  const sugg = suggestFor(out, root, at === MISSING ? undefined : at);
  if (sugg) out.suggestion = sugg;
  const kind = site.detailKind;
  const detail = kind === DETAIL_FIXED ? site.detail
    : kind === DETAIL_HEAD ? site.detail + out.received
      : detailFor({ keyword: site.keyword, params }, out, at);
  if (detail !== undefined) out.detail = detail;
  out.rank = site.rank;
  return out;
}

module.exports = { errorSite, makeRich };
