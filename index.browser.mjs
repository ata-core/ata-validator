// Browser ESM entry, for bundlers: the validator core, with each tool imported
// on its own (see lib/tools.mjs) so that the tools an application does not
// import stay out of its bundle. The native addon is stubbed by the
// package.json "browser" field.
//
// The code generator is not in the page's bundle. Every schema starts on the
// interpreted engine, which gives the same answers; a validator that gets hot
// (lib/validator-core.js, TIER_CALLS) loads the generator through the dynamic
// import below, which bundlers split into a chunk of its own, and rebuilds
// itself on generated code. A page that wants generated code from the first
// call imports 'ata-validator/codegen' once.
import core from './lib/validator-core.js';
import tiering from './lib/tiering.js';
import { toTypeScript, renderPretty, renderCompact, toOutput, toRetryMessage, describeSchema, renderJSON } from './lib/tools.mjs';
import { defineSchema, schemaOf } from './lib/schema-helpers.mjs';

// Pure-marked reads, so a bundler drops what goes unused (lib/schema-helpers.mjs).
const api = /* @__PURE__ */ (() => { core._registerTiering(tiering.createTiering(() => import('./lib/codegen-engine.js'))); return core; })();
export const Validator = /* @__PURE__ */ (() => api.Validator)();
export const compile = /* @__PURE__ */ (() => api.compile)();
export const validate = /* @__PURE__ */ (() => api.validate)();
export const validateAsync = /* @__PURE__ */ (() => api.validateAsync)();
export const parseAsync = /* @__PURE__ */ (() => api.parseAsync)();
export const version = /* @__PURE__ */ (() => api.version)();
export const createPaddedBuffer = /* @__PURE__ */ (() => api.createPaddedBuffer)();
export const SIMDJSON_PADDING = /* @__PURE__ */ (() => api.SIMDJSON_PADDING)();
export const parseJSON = /* @__PURE__ */ (() => api.parseJSON)();
export { defineSchema, schemaOf };
export { toTypeScript, renderPretty, renderCompact, toOutput, toRetryMessage, describeSchema, renderJSON };
export default /* @__PURE__ */ (() => ({ Validator: api.Validator, compile: api.compile, validate: api.validate, validateAsync: api.validateAsync, parseAsync: api.parseAsync, version: api.version, createPaddedBuffer: api.createPaddedBuffer, SIMDJSON_PADDING: api.SIMDJSON_PADDING, parseJSON: api.parseJSON, toTypeScript, defineSchema, schemaOf, renderPretty, renderCompact, toOutput, toRetryMessage, describeSchema, renderJSON }))();
