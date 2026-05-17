'use strict';

const { CODES, codeFor } = require('./error-codes');

const DOC_BASE = 'https://ata-validator.com/e/';

function reprValue (v) {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  const t = typeof v;
  if (t === 'string') {
    const s = JSON.stringify(v);
    return s.length > 60 ? s.slice(0, 57) + '..."' : s;
  }
  if (t === 'number' || t === 'boolean') return String(v);
  if (Array.isArray(v)) return `[array, ${v.length} items]`;
  if (t === 'object') {
    try {
      const s = JSON.stringify(v);
      if (s.length <= 60) return s;
      return `[object, ~${(s.length / 1024).toFixed(1)}KB]`;
    } catch {
      return '[object, unserializable]';
    }
  }
  return `[${t}]`;
}

function expectedFor (err) {
  switch (err.keyword) {
    case 'type': return err.params && err.params.type ? String(err.params.type) : undefined;
    case 'minLength': return err.params && err.params.limit != null ? `string with ≥${err.params.limit} chars` : undefined;
    case 'maxLength': return err.params && err.params.limit != null ? `string with ≤${err.params.limit} chars` : undefined;
    case 'minimum': return err.params && err.params.limit != null ? `≥${err.params.limit}` : undefined;
    case 'maximum': return err.params && err.params.limit != null ? `≤${err.params.limit}` : undefined;
    case 'format': return err.params && err.params.format ? `format '${err.params.format}'` : undefined;
    case 'enum': return err.params && err.params.allowedValues
      ? `one of [${err.params.allowedValues.map(reprValue).join(', ')}]`
      : undefined;
    case 'const': return err.params && 'allowedValue' in err.params ? reprValue(err.params.allowedValue) : undefined;
    case 'required': return err.params && err.params.missingProperty ? `property '${err.params.missingProperty}'` : undefined;
    default: return undefined;
  }
}

function pickReceived (err, data) {
  if (!data && data !== 0 && data !== false) return undefined;
  // Walk JSON pointer to extract the actual offending value
  const p = err.instancePath || err.path || '';
  if (!p) return reprValue(data);
  const parts = p.replace(/^\//, '').split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cur = data;
  for (const part of parts) {
    if (cur == null) return undefined;
    cur = cur[part];
  }
  return reprValue(cur);
}

/**
 * Enrich a raw codegen error with code/path/expected/received/docUrl.
 * Pure: returns a new object. Source frames and suggestions are added by
 * other helpers later in the pipeline.
 */
function enrich (rawErr, opts) {
  const data = opts && opts.data;
  const positions = opts && opts.positions;
  const keyword = rawErr.keyword;
  const format = rawErr.params && rawErr.params.format;
  const code = codeFor(keyword, format) || 'ATA9001';
  const meta = CODES[code];
  const path = rawErr.instancePath != null ? rawErr.instancePath : (rawErr.path || '');

  const out = {
    code,
    message: rawErr.message || (meta && meta.headline) || 'validation failed',
    keyword,
    path,
    expected: expectedFor(rawErr),
    received: data !== undefined ? pickReceived(rawErr, data) : undefined,
    schemaPath: rawErr.schemaPath,
    docUrl: DOC_BASE + code,
    // Back-compat aliases (additive, present in both rich and legacy paths)
    instancePath: path,
    dataPath: path,
    params: rawErr.params,
    parentSchema: rawErr.parentSchema,
  };

  if (positions && positions[path]) {
    const p = positions[path];
    out.dataFrame = { byteOffset: p.byteOffset, length: p.length, line: p.line, col: p.col, text: p.text };
  }
  return out;
}

module.exports = { enrich, reprValue, expectedFor };
