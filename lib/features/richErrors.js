'use strict';
// The rich error fields for the 2.0 Validator: Validator.use(richErrors).
// With it, an error has the fields the 1.x Validator gives by default: code,
// path, expected, received, docUrl, detail, suggestion, rank and related
// beside keyword, instancePath, schemaPath, params and message. Without it,
// an error has the fields of the 1.x Validator's `richErrors: false` shape.
// The enrichment and its list step are those lib/rejections.js applies; that
// module is not required here, since the 2.0 Validator carries its own copy
// of the rest of it (lib/rejection-core.js).
const { enrich: enrichError } = require('../enrich-error');
const { correlateTypos } = require('../correlate');
const enrich = (e, opts) => enrichError(e, opts);
// As attachRelated in lib/rejections.js: each error of a typo pair names the
// other in `related`.
enrich.related = (errors) => {
  const pairs = correlateTypos(errors);
  if (pairs === null) return errors;
  for (const [from, to] of pairs) {
    const e = errors[from];
    if (!e) continue;
    if (e.related) { if (!e.related.includes(to)) e.related.push(to); }
    else e.related = [to];
  }
  return errors;
};
module.exports = { richErrors: Object.freeze({ name: 'richErrors', enrich }) };
