'use strict'

const DRAFT7_SCHEMAS = new Set([
  'http://json-schema.org/draft-07/schema#',
  'http://json-schema.org/draft-07/schema',
])

function isDraft7(schema) {
  return !!(schema && schema.$schema && DRAFT7_SCHEMAS.has(schema.$schema))
}

function normalizeDraft7(schema) {
  if (!isDraft7(schema)) return schema
  _normalize(schema)
  return schema
}

function _normalize(schema) {
  if (typeof schema !== 'object' || schema === null) return

  // definitions → $defs
  if (schema.definitions && !schema.$defs) {
    schema.$defs = schema.definitions
    delete schema.definitions
  }

  // dependencies → dependentSchemas + dependentRequired
  if (schema.dependencies) {
    for (const [key, value] of Object.entries(schema.dependencies)) {
      if (Array.isArray(value)) {
        if (!schema.dependentRequired) schema.dependentRequired = {}
        schema.dependentRequired[key] = value
      } else {
        if (!schema.dependentSchemas) schema.dependentSchemas = {}
        schema.dependentSchemas[key] = value
      }
    }
    delete schema.dependencies
  }

  // items (array form) → prefixItems + items/additionalItems swap
  if (Array.isArray(schema.items)) {
    schema.prefixItems = schema.items
    if (schema.additionalItems !== undefined) {
      schema.items = schema.additionalItems
      delete schema.additionalItems
    } else {
      delete schema.items
    }
  }

  // Recurse into object-valued sub-schemas
  const objSubs = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']
  for (const key of objSubs) {
    if (schema[key] && typeof schema[key] === 'object') {
      for (const v of Object.values(schema[key])) {
        if (typeof v === 'object' && v !== null) _normalize(v)
      }
    }
  }

  // Recurse into array-valued sub-schemas
  const arrSubs = ['allOf', 'anyOf', 'oneOf', 'prefixItems']
  for (const key of arrSubs) {
    if (Array.isArray(schema[key])) {
      for (const s of schema[key]) {
        if (typeof s === 'object' && s !== null) _normalize(s)
      }
    }
  }

  // Recurse into single sub-schemas
  const singleSubs = ['items', 'contains', 'not', 'if', 'then', 'else',
                       'additionalProperties', 'propertyNames']
  for (const key of singleSubs) {
    if (typeof schema[key] === 'object' && schema[key] !== null) {
      _normalize(schema[key])
    }
  }
}

// OpenAPI `nullable: true` is not JSON Schema. Convert it to a union with
// 'null' (`{ type: 'X', nullable: true }` -> `{ type: ['X', 'null'] }`), the
// same shape AJV produces under its `nullable` option. Recurses only through
// schema-bearing keywords so it never touches data values (default, const, etc.).
function normalizeNullable(schema) {
  if (typeof schema !== 'object' || schema === null) return schema
  _normalizeNullable(schema)
  return schema
}

function _normalizeNullable(schema) {
  if (typeof schema !== 'object' || schema === null) return

  if (schema.nullable === true && schema.type !== undefined) {
    if (Array.isArray(schema.type)) {
      if (!schema.type.includes('null')) schema.type = schema.type.concat('null')
    } else {
      schema.type = [schema.type, 'null']
    }
  }
  if ('nullable' in schema) delete schema.nullable

  const objSubs = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']
  for (const key of objSubs) {
    if (schema[key] && typeof schema[key] === 'object') {
      for (const v of Object.values(schema[key])) {
        if (typeof v === 'object' && v !== null) _normalizeNullable(v)
      }
    }
  }
  const arrSubs = ['allOf', 'anyOf', 'oneOf', 'prefixItems']
  for (const key of arrSubs) {
    if (Array.isArray(schema[key])) {
      for (const s of schema[key]) {
        if (typeof s === 'object' && s !== null) _normalizeNullable(s)
      }
    }
  }
  const singleSubs = ['items', 'contains', 'not', 'if', 'then', 'else',
                       'additionalProperties', 'propertyNames', 'unevaluatedItems', 'unevaluatedProperties']
  for (const key of singleSubs) {
    if (typeof schema[key] === 'object' && schema[key] !== null) {
      _normalizeNullable(schema[key])
    }
  }
}

// Draft 2020-12 treats `format` as an annotation unless the assertion
// vocabulary is in use. Removing the keyword is exactly that reading, and it
// keeps every engine in agreement without each one growing its own switch.
// Walks schema-bearing keywords only, so a property or definition named
// "format" is untouched.
function stripFormatAssertions(schema) {
  if (typeof schema !== 'object' || schema === null) return schema
  _stripFormat(schema, new Set())
  return schema
}

function _stripFormat(schema, seen) {
  if (typeof schema !== 'object' || schema === null || Array.isArray(schema)) return
  if (seen.has(schema)) return
  seen.add(schema)

  if (typeof schema.format === 'string') delete schema.format

  const objSubs = ['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas']
  for (const key of objSubs) {
    if (schema[key] && typeof schema[key] === 'object' && !Array.isArray(schema[key])) {
      for (const v of Object.values(schema[key])) _stripFormat(v, seen)
    }
  }
  const arrSubs = ['allOf', 'anyOf', 'oneOf', 'prefixItems']
  for (const key of arrSubs) {
    if (Array.isArray(schema[key])) {
      for (const s of schema[key]) _stripFormat(s, seen)
    }
  }
  const singleSubs = ['items', 'additionalItems', 'contains', 'not', 'if', 'then', 'else',
                      'additionalProperties', 'propertyNames', 'unevaluatedItems',
                      'unevaluatedProperties', 'contentSchema']
  for (const key of singleSubs) {
    if (Array.isArray(schema[key])) {
      for (const s of schema[key]) _stripFormat(s, seen)
    } else {
      _stripFormat(schema[key], seen)
    }
  }
}

module.exports = { isDraft7, normalizeDraft7, normalizeNullable, stripFormatAssertions }
