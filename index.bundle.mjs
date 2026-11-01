// ESM entry for bundlers that target a server (Bun, esbuild or Rollup for
// Node) and for Node before 22.10, which does not match `module-sync`: the
// validator core with the code generator registered, as index.js, but with
// each tool imported on its own (lib/tools.mjs), so the tools an application
// does not import stay out of its bundle. Through index.js a bundler sees one
// CommonJS module and keeps all of them.
import core from './lib/validator-core.js';
import engine from './lib/codegen-engine.js';
import { toTypeScript, renderPretty, renderCompact, toOutput, toRetryMessage, describeSchema, renderJSON } from './lib/tools.mjs';
import { defineSchema, schemaOf } from './lib/schema-helpers.mjs';

// Pure-marked reads, so a bundler drops what goes unused (lib/schema-helpers.mjs).
const api = /* @__PURE__ */ (() => { core._registerCodegen(engine); return core; })();
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
