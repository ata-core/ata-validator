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
function errorSite (keyword, schemaPath, params, format) {
  const dependent = keyword === 'required' && typeof schemaPath === 'string' && schemaPath.endsWith('/dependentRequired');
  const code = (dependent && 'ATA7005') || codeFor(keyword, format) || 'ATA9001';
  return {
    code,
    keyword,
    schemaPath,
    docUrl: DOC_BASE + code,
    rank: rankFor(keyword),
    headline: (CODES[code] && CODES[code].headline) || 'validation failed',
    expected: params === undefined ? NO_EXPECTED : expectedFor({ keyword, params }),
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
  const detail = detailFor({ keyword: site.keyword, params }, out, at);
  if (detail !== undefined) out.detail = detail;
  out.rank = site.rank;
  return out;
}

module.exports = { errorSite, makeRich };
