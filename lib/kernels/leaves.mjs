// The leaf keywords as the IR's front end and closures read them
// (lib/ir/front.mjs), with the format keyword, which reads the current
// engine's CommonJS files: its run-time checks, codes and hints. This module
// is not part of ata-validator/kernels; a module written by the IR imports
// none of it.
import { minLength, maxLength, minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf, pattern, minItems, maxItems, minProperties, maxProperties, constK, enumK, uniqueItems, isStr, formatDetail } from './kernels.mjs'

// Formats are the current engine's own: its run-time checks (lib/formats.js
// formatChecks), its codes (lib/error-codes.js codeFor) and its hints
// (lib/suggestions.js; generated code carries only its format's hint, see lib/ir/emit.mjs). The generated code is its code generator's
// (FORMAT_CODEGEN, written in by ir/emit.mjs). A format it does not know is
// not checked, as there.
import formats from '../formats.js'
import errorCodes from '../error-codes.js'
import suggestions from '../suggestions.js'
const formatCheck = (n) => { const fc = formats.formatChecks(); return Object.prototype.hasOwnProperty.call(fc, n) ? fc[n] : null }
// The closures call it; a written module carries only its format's hint (lib/ir/emit.mjs).
export function formatSuggest (v, p) { return suggestions.suggestFormat(p.format, v) }
export const format = {
  code: (n) => errorCodes.codeFor('format', n), on: isStr, ok: (v, n) => n(v),
  // null: a format the current engine does not know, which it does not check.
  prepare: (n) => formatCheck(n),
  params: (n) => ({ format: n }), msg: (n) => `must match format "${n}"`, exp: (n) => `format '${n}'`, rank: 2,
  detail: formatDetail,
  suggest: formatSuggest,
}

export const LEAVES = { minLength, maxLength, minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf, pattern, format, minItems, maxItems, minProperties, maxProperties, const: constK, enum: enumK, uniqueItems }
