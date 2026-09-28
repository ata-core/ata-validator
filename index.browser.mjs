// Browser ESM entry: the same code, with the native addon stubbed out by the
// bundler through the package.json "browser" field.
import mod from './index.js';
export const { Validator, compile, validate, validateAsync, parseAsync, version, createPaddedBuffer, SIMDJSON_PADDING, parseJSON, toTypeScript, defineSchema, renderPretty, renderCompact, toOutput, toRetryMessage, describeSchema, renderJSON } = mod;
export default mod;
