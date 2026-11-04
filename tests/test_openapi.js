'use strict';
// ata-validator/openapi: request body schemas from OpenAPI 3.0 and 3.1, read
// as each version defines them, with references to components.schemas.
const assert = require('assert');
const { operationSchemas } = require('../lib/openapi.js');
const { Validator } = require('../index.js');

const doc = (openapi, schemas, extra = {}) => ({ openapi, paths: { '/users': { post: { operationId: 'createUser', requestBody: { content: { 'application/json': { schema: { $ref: '#/components/schemas/NewUser' } } } } }, get: { operationId: 'listUsers' } }, '/users/{id}/roles': { put: { requestBody: { $ref: '#/components/requestBodies/Roles' } } }, '/upload': { post: { operationId: 'upload', requestBody: { content: { 'multipart/form-data': { schema: { type: 'object' } } } } } }, ...extra }, components: { schemas, requestBodies: { Roles: { content: { 'application/vnd.roles+json; charset=utf-8': { schema: { type: 'array', items: { enum: ['admin', 'user'] } } } } } } } });
const NewUser = { type: 'object', properties: { email: { type: 'string', format: 'email' }, nickname: { type: 'string', nullable: true }, age: { type: 'integer', minimum: 13, exclusiveMinimum: true }, enum: { $ref: '#/components/schemas/Tag' } }, required: ['email'], additionalProperties: false };
const Tag = { type: 'string', enum: ['a', 'b'], nullable: true };

// 3.0: nullable and boolean exclusive bounds; a property named like a keyword is a property.
const b30 = operationSchemas(doc('3.0.3', { NewUser, Tag }));
assert.deepStrictEqual(Object.keys(b30), ['createUser', 'putUsersIdRoles'], 'operations with a JSON body, by operationId or method and path');
const v30 = new Validator(b30.createUser);
assert.strictEqual(v30.isValidObject({ email: 'a@b.co', nickname: null, age: 14, enum: null }), true, '3.0 nullable');
assert.strictEqual(v30.isValidObject({ email: 'a@b.co', age: 13 }), false, '3.0 exclusiveMinimum: true');
assert.strictEqual(v30.isValidObject({ email: 'a@b.co', enum: 'c' }), false, 'a property named enum, through its reference');
assert.strictEqual(new Validator(b30.putUsersIdRoles).isValidObject(['admin', 'x']), false, 'a request body by reference, a +json media type');

// 3.1: JSON Schema 2020-12 as it is. A nullable left in it is read as ata
// reads it in every dialect (lib/draft7.js), on the server and the page alike.
const b31 = operationSchemas(doc('3.1.0', { NewUser, Tag }));
assert.strictEqual(b31.createUser.$defs.NewUser.properties.nickname.nullable, true, '3.1 schemas are not rewritten');
assert.strictEqual(new Validator(b31.createUser).isValidObject({ email: 'a@b.co', nickname: null }), true, 'nullable, as ata reads it');
assert.strictEqual(new Validator(b31.createUser).isValidObject({ email: 'a@b.co', age: 13 }), false, 'a boolean exclusiveMinimum, as ata reads the draft-04 form in every dialect');

// jsonSchemaDialect (3.1) is each schema's dialect: draft-07 reads items as a list of schemas by position.
{
  const d = { openapi: '3.1.0', jsonSchemaDialect: 'http://json-schema.org/draft-07/schema#', paths: { '/t': { post: { operationId: 't', requestBody: { content: { 'application/json': { schema: { type: 'array', items: [{ type: 'string' }, { type: 'integer' }] } } } } } } } };
  const b = operationSchemas(d);
  assert.strictEqual(b.t.$schema, 'http://json-schema.org/draft-07/schema#');
  assert.strictEqual(new Validator(b.t).isValidObject(['a', 1]), true);
  assert.strictEqual(new Validator(b.t).isValidObject([1, 'a']), false, 'tuple items under draft-07');
}

// The source document is not changed.
assert.strictEqual(NewUser.properties.nickname.nullable, true);

// Refused: other versions, references outside components.schemas, clashing names.
assert.throws(() => operationSchemas({ swagger: '2.0', paths: {} }), /3\.0 or 3\.1/);
assert.throws(() => operationSchemas(doc('3.1.0', { NewUser: { $ref: 'other.json#/X' } })), /only #\/components\/schemas/);
const body = { content: { 'application/json': { schema: {} } } };
assert.throws(() => operationSchemas({ openapi: '3.1.0', paths: { '/a': { post: { operationId: 'x', requestBody: body } }, '/b': { post: { operationId: 'x', requestBody: body } } } }), /post \/a and post \/b are both named x/);
// operationId in camel case, whatever its separators; names that would collide are refused by name.
assert.deepStrictEqual(Object.keys(operationSchemas({ openapi: '3.1.0', paths: { '/u': { post: { operationId: 'create-user', requestBody: body }, put: { operationId: 'users.update', requestBody: body }, patch: { operationId: 'getUserById', requestBody: body }, delete: { operationId: '2fa_reset', requestBody: body } }, '/v': { post: { requestBody: body } } } })).sort(), ['_2faReset', 'createUser', 'getUserById', 'postV', 'usersUpdate']);
assert.throws(() => operationSchemas({ openapi: '3.1.0', paths: { '/a': { post: { operationId: 'get_user', requestBody: body } }, '/b': { post: { operationId: 'getUser', requestBody: body } } } }), /post \/a and post \/b are both named getUser/);
console.log('ok: request body schemas from OpenAPI 3.0 and 3.1');
