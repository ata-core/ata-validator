'use strict';
// ata-validator/openapi: the JSON Schema of each operation's request body in
// an OpenAPI document, ready for new Validator(schema), so a server and a page
// built from the same document check the same schema. @ata-project/unplugin
// writes a page's validators from it; a server reads it directly.
//
//   const { operationSchemas } = require('ata-validator/openapi')
//   const bodies = operationSchemas(require('./openapi.json'))
//   const createUser = new Validator(bodies.createUser)
//
// Each schema carries the document's components.schemas as $defs, its
// references rewritten to them. OpenAPI 3.1 schemas are JSON Schema 2020-12
// and are taken as they are (a nullable left in one is read as ata reads it
// in every dialect). OpenAPI 3.0 schemas are read as 3.0 defines
// them: nullable: true adds null to the type (and to an enum), and a boolean
// exclusiveMinimum or exclusiveMaximum makes minimum or maximum exclusive.
// Only application/json bodies (and +json media types) are read. A reference
// outside components.schemas, or to a schema that is not there, throws.

const METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'];
const isObj = (v) => typeof v === 'object' && v !== null && !Array.isArray(v);
const own = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

// An operation without an operationId is named by its method and path:
// post /users/{id}/roles -> postUsersIdRoles.
function nameOf(method, p, op) {
  if (typeof op.operationId === 'string' && /^[A-Za-z_$][\w$]*$/.test(op.operationId)) return op.operationId;
  const words = (p.match(/[A-Za-z0-9]+/g) || []);
  return method + words.map((w) => w[0].toUpperCase() + w.slice(1)).join('');
}

function jsonBody(content) {
  if (!isObj(content)) return null;
  for (const type of Object.keys(content)) {
    const base = type.split(';')[0].trim().toLowerCase();
    if ((base === 'application/json' || /^application\/[\w.-]+\+json$/.test(base)) && isObj(content[type]) && own(content[type], 'schema')) return content[type].schema;
  }
  return null;
}

// Where a schema keeps its subschemas: one, a list, or a map of names to
// subschemas (a name there is the data's, not a keyword). Every other keyword
// is copied as it is.
const ONE = new Set(['items', 'additionalItems', 'additionalProperties', 'not', 'if', 'then', 'else', 'contains', 'propertyNames', 'unevaluatedItems', 'unevaluatedProperties']);
const LIST = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems']);
const MAP = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']);

// A copy of a schema with references into components.schemas pointed at
// $defs, and, for 3.0, its nullable and boolean exclusive bounds rewritten.
function convert(s, v30, where) {
  if (!isObj(s)) return s;
  const out = {};
  for (const k of Object.keys(s)) {
    const v = s[k];
    if (k === '$ref' && typeof v === 'string') {
      const m = /^#\/components\/schemas\/(.+)$/.exec(v);
      if (!m) throw new Error(`ata-validator/openapi: ${where} refers to ${v}; only #/components/schemas/... is read`);
      out.$ref = '#/$defs/' + m[1];
    } else if (ONE.has(k)) out[k] = Array.isArray(v) ? v.map((x, i) => convert(x, v30, `${where}/${k}/${i}`)) : convert(v, v30, `${where}/${k}`);
    else if (LIST.has(k) && Array.isArray(v)) out[k] = v.map((x, i) => convert(x, v30, `${where}/${k}/${i}`));
    else if (MAP.has(k) && isObj(v)) { const m = {}; for (const n of Object.keys(v)) m[n] = convert(v[n], v30, `${where}/${k}/${n}`); out[k] = m; }
    else out[k] = v;
  }
  if (v30) {
    if (out.nullable === true) {
      if (typeof out.type === 'string') out.type = [out.type, 'null'];
      else if (Array.isArray(out.type) && !out.type.includes('null')) out.type = [...out.type, 'null'];
      if (Array.isArray(out.enum) && !out.enum.includes(null)) out.enum = [...out.enum, null];
    }
    delete out.nullable;
    if (out.exclusiveMinimum === true && typeof out.minimum === 'number') { out.exclusiveMinimum = out.minimum; delete out.minimum; } else if (typeof out.exclusiveMinimum === 'boolean') delete out.exclusiveMinimum;
    if (out.exclusiveMaximum === true && typeof out.maximum === 'number') { out.exclusiveMaximum = out.maximum; delete out.maximum; } else if (typeof out.exclusiveMaximum === 'boolean') delete out.exclusiveMaximum;
  }
  return out;
}

// { [operation name]: schema } for every operation with a JSON request body.
function operationSchemas(doc) {
  if (!isObj(doc) || !isObj(doc.paths)) throw new Error('ata-validator/openapi: not an OpenAPI document (no paths)');
  const version = typeof doc.openapi === 'string' ? doc.openapi : '';
  const v30 = /^3\.0\./.test(version);
  if (!v30 && !/^3\.1\./.test(version)) throw new Error(`ata-validator/openapi: OpenAPI 3.0 or 3.1 is read, not ${JSON.stringify(doc.openapi || doc.swagger)}`);
  const components = isObj(doc.components) ? doc.components : {};
  const schemas = isObj(components.schemas) ? components.schemas : {};
  const defs = {};
  for (const k of Object.keys(schemas)) defs[k] = convert(schemas[k], v30, '#/components/schemas/' + k);
  const out = {};
  for (const p of Object.keys(doc.paths)) {
    const item = doc.paths[p];
    if (!isObj(item)) continue;
    for (const method of METHODS) {
      const op = item[method];
      if (!isObj(op)) continue;
      let body = op.requestBody;
      if (isObj(body) && typeof body.$ref === 'string') {
        const m = /^#\/components\/requestBodies\/(.+)$/.exec(body.$ref);
        body = m && isObj(components.requestBodies) ? components.requestBodies[m[1]] : undefined;
        if (!isObj(body)) throw new Error(`ata-validator/openapi: ${method} ${p} refers to a request body that is not there`);
      }
      if (!isObj(body)) continue;
      const schema = jsonBody(body.content);
      if (schema === null) continue;
      const name = nameOf(method, p, op);
      if (own(out, name)) throw new Error(`ata-validator/openapi: two operations are named ${name}`);
      const root = convert(schema, v30, `${method} ${p} request body`);
      out[name] = Object.keys(defs).length ? { ...root, $defs: { ...defs, ...(isObj(root.$defs) ? root.$defs : {}) } } : root;
    }
  }
  return out;
}

module.exports = { operationSchemas };
