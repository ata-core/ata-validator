// ata-validator/compiled-standard as an ES module of its own, not a re-export
// of the CommonJS file, so a bundler adds no interop code (see
// compiled-bare.mjs). The same `~standard` as lib/compiled-standard.js builds
// through lib/standard-schema.js; tests/test_compiled_standard.js holds the
// two to the same issues and the same schema documents.

// When the module's error function answers valid where its verdict said no,
// the disagreement is reported rather than turned into an acceptance.
const DISAGREES = [{ message: 'schema validation failed', instancePath: '' }];
const EMPTY_PATH = Object.freeze([]);

// A JSON pointer as a Standard Schema path: an all-digit segment without a
// leading zero is an array index and comes out as a number.
function pathOf(pointer) {
  if (!pointer) return EMPTY_PATH;
  const out = [];
  for (const raw of pointer.split('/').slice(1)) {
    const seg = raw.indexOf('~') >= 0 ? raw.replace(/~1/g, '/').replace(/~0/g, '~') : raw;
    out.push({ key: /^(?:0|[1-9][0-9]*)$/.test(seg) ? Number(seg) : seg });
  }
  return Object.freeze(out);
}

// Standard JSON Schema: the document, as a copy, for its own dialect.
function jsonSchemaOf(schema) {
  const convert = (options) => {
    const target = options && options.target;
    if (schema === true) return {};
    if (schema === false) return { not: {} };
    const declared = typeof schema.$schema === 'string' ? schema.$schema : '';
    const dialect = declared === '' || declared.includes('draft/2020-12/schema') ? 'draft-2020-12'
      : declared.includes('draft-07/schema') ? 'draft-07' : declared;
    if (target !== dialect) {
      throw new TypeError(`ata-validator cannot provide a ${dialect} schema as ${String(target)}; it does not convert between dialects`);
    }
    return JSON.parse(JSON.stringify(schema));
  };
  return Object.freeze({ input: convert, output: convert });
}

export function bareStandard(mod, schema, useDefaults) {
  const fill = useDefaults !== false && typeof mod.applyDefaults === 'function' ? mod.applyDefaults : null;
  const isValid = mod.isValid;
  const errFn = mod.validate;
  return {
    '~standard': Object.freeze({
      version: 1,
      vendor: 'ata-validator',
      jsonSchema: jsonSchemaOf(schema),
      validate(value) {
        if (fill !== null) fill(value);
        if (isValid(value)) return { value };
        const r = errFn(value);
        const errors = r && r.valid === false ? r.errors : DISAGREES;
        const issues = new Array(errors.length);
        for (let i = 0; i < errors.length; i++) {
          const e = errors[i];
          issues[i] = { message: e.message || 'validation failed', path: pathOf(e.instancePath != null ? e.instancePath : (e.path || '')) };
        }
        return { issues };
      },
    }),
  };
}

export default { bareStandard };
