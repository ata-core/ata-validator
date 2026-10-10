// Browser ESM entry, for bundlers: the validator core with the code generator
// registered, as index.js, but with each tool imported on its own (see
// lib/tools.mjs) so that the tools an application does not import stay out
// of its bundle. The native addon is stubbed by the package.json "browser"
// field.
import core from './lib/validator-core.js';
import engine from './lib/codegen-engine.js';
import { toTypeScript, renderPretty, renderCompact, toOutput, toRetryMessage, describeSchema, renderJSON } from './lib/tools.mjs';

core._registerCodegen(engine);

export const { Validator, compile, validate, validateAsync, parseAsync, version, createPaddedBuffer, SIMDJSON_PADDING, parseJSON, defineSchema } = core;
export { toTypeScript, renderPretty, renderCompact, toOutput, toRetryMessage, describeSchema, renderJSON };
export default { Validator, compile, validate, validateAsync, parseAsync, version, createPaddedBuffer, SIMDJSON_PADDING, parseJSON, toTypeScript, defineSchema, renderPretty, renderCompact, toOutput, toRetryMessage, describeSchema, renderJSON };
