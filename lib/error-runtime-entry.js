'use strict';

// The error runtime that compiled modules share. A module built in the
// compact shape carries only its verdict function and its schema with the
// annotations taken out; when a document fails, it hands the document to this
// runtime, which walks the same schema with the interpreted engine and returns
// the error list. One copy serves every module of a build, so the error detail
// a module used to carry as generated code is paid for once.
//
// What comes back is what `validate()` returns on the runtime Validator with
// `richErrors: false`, plus the `code` and `docUrl` a module stamps: the same
// errors, in schema declaration order.
//
// It loads the interpreter without its plan compiler, which adds speed and
// no answers: lib/error-runtime.js packs this file and what it requires into
// the runtime a build writes, and `ata-validator/error-runtime` exports it
// for bundler plugins.

const { createInterpreter } = require('./interpreter-core');
const { sortErrorsByRank } = require('./error-sort-rank');

const DOC = 'https://ata-validator.com/e/';

function stamp(errors, codeOf) {
  const out = new Array(errors.length);
  for (let i = 0; i < errors.length; i++) {
    const e = errors[i];
    // A collapsed oneOf/anyOf error comes with its code and no docUrl, as
    // the module's own collector leaves it; only its branches are stamped.
    if (e.code !== undefined) {
      const x = {};
      for (const k in e) if (k !== '_o' && k !== 'branchErrors') x[k] = e[k];
      if (Array.isArray(e.branchErrors)) x.branchErrors = stamp(e.branchErrors, codeOf);
      out[i] = x;
      continue;
    }
    let code;
    {
      code = e.keyword === 'required' && typeof e.schemaPath === 'string' && e.schemaPath.endsWith('/dependentRequired')
        ? 'ATA7005'
        : codeOf(e.keyword, e.params && e.params.format);
    }
    const x = code === null || code === undefined ? {} : { code };
    for (const k in e) if (k !== 'code' && k !== '_o' && k !== 'docUrl' && k !== 'branchErrors') x[k] = e[k];
    if (code !== null && code !== undefined) x.docUrl = DOC + code;
    if (Array.isArray(e.branchErrors)) x.branchErrors = stamp(e.branchErrors, codeOf);
    out[i] = x;
  }
  return out;
}

// schema: the schema the module's verdict was compiled from, after dialect
// normalization. codeOf(keyword, format): the module's own code table.
function createErrors(schema, codeOf, options) {
  let interp = null;
  return function errorsFor(data) {
    if (interp === null) interp = createInterpreter(schema, { v1: !!(options && options.v1), flat: !!(options && options.flat) });
    let raw;
    try {
      raw = interp.validate(data).errors;
    } catch (e) {
      // Data nested deeper than the walk's stack allows: no detail, which the
      // module reports as its ATA9000 stub. The verdict came from the module.
      if (e instanceof RangeError) return null;
      throw e;
    }
    if (!raw || raw.length === 0) return null;
    const ordered = raw.length > 1 || (raw[0] && Array.isArray(raw[0].branchErrors))
      ? sortErrorsByRank(schema, raw)
      : raw;
    return stamp(ordered, codeOf);
  };
}

module.exports = { createErrors };
