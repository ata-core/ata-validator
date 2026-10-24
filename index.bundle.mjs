// ESM entry for bundlers that target a server (Bun, esbuild or Rollup for
// Node) and for Node before 22.10, which does not match `module-sync`: the
// validator core with the code generator registered, as index.js, but with
// each tool imported on its own (lib/tools.mjs), so the tools an application
// does not import stay out of its bundle. Through index.js a bundler sees one
// CommonJS module and keeps all of them.
import core from './lib/validator-core.js';
import engine from './lib/codegen-engine.js';
import { toTypeScript, renderPretty, renderCompact, toOutput, toRetryMessage, describeSchema, renderJSON } from './lib/tools.mjs';

core._registerCodegen(engine);

export const { Validator, compile, validate, validateAsync, parseAsync, version, createPaddedBuffer, SIMDJSON_PADDING, parseJSON, defineSchema, schemaOf } = core;
export { toTypeScript, renderPretty, renderCompact, toOutput, toRetryMessage, describeSchema, renderJSON };
export default { Validator, compile, validate, validateAsync, parseAsync, version, createPaddedBuffer, SIMDJSON_PADDING, parseJSON, toTypeScript, defineSchema, schemaOf, renderPretty, renderCompact, toOutput, toRetryMessage, describeSchema, renderJSON };
