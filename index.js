'use strict';

// The full package: the validator core with the code generator registered,
// plus the tools no Validator calls (TypeScript generation, renderers, output
// formats). The core lives in lib/validator-core.js and the code generator in
// lib/codegen-engine.js, so that the edge entry (index.edge.js) and
// ata-validator/lite can load the core without it.
const core = require('./lib/validator-core.js');

// Validation as the body arrives: `v.stream(opts)` is a record stream over the
// validator (lib/stream.js), loaded on first use. Defined here, on the Node
// entry, and not in the core: the lite, edge and browser builds are measured
// to the byte and a static require from the core would put the stream into
// every one of them; there `ata-validator/stream` is imported where it is used.
Object.defineProperty(core.Validator.prototype, 'stream', {
  configurable: true, writable: true,
  value: function stream (opts) { return require('./lib/stream.js').streamValidator(this, opts); },
});
// The code generator loads on first need, or once the event loop is free,
// not with the package: it is most of what requiring the package parsed. The
// timer is unref'd, so a script that has finished does not stay to load it.
// The loader lives here rather than in the core, which the browser build
// shares and which has no use for it there.
let engine = null;
const loadCodegen = () => {
  if (engine === null) core._registerCodegen(engine = require('./lib/codegen-engine.js'));
  return engine;
};
core._setCodegenLoader(loadCodegen);
const warm = setTimeout(loadCodegen, 0);
if (typeof warm === 'object' && typeof warm.unref === 'function') warm.unref();

// A process whose first check comes after the event loop has turned, a
// server's first request, pays on that check for V8 compiling the generator's
// functions and the error builders: on a four-field schema 5 ms for the
// verdict and 7 to 10 ms for the first error list, measured with the
// generator already loaded. One check of a small schema, accepted and
// rejected, run once the loop is free, moves that off the request: 0.5 and
// 0.7 ms after it (the same warm-up as the browser build's, lib/tiering.js).
// It runs only where a validator was built and is still uncompiled when the
// loop turns: a script that builds one and checks in the same tick never runs
// it, and the timer is unref'd, so a finished script does not stay for it.
// ATA_NO_WARM=1 turns it off.
let built = null;
core._registerBuiltHook((v) => {
  if (built === null) {
    built = [];
    const t = setTimeout(warmUp, 0);
    if (typeof t === 'object' && typeof t.unref === 'function') t.unref();
  }
  if (built.length < 8) built.push(new WeakRef(v));
});
function warmUp () {
  const list = built;
  built = [];
  core._registerBuiltHook(null);
  if (process.env.ATA_NO_WARM === '1') return;
  // Untouched: neither compiled for validate() nor a verdict or validate
  // method read off it (the prototype's accessors bind the method on the
  // instance at the first read, a verdict-only compile sets no other mark).
  const untouched = (v) => !v._initialized && !Object.prototype.hasOwnProperty.call(v, 'isValidObject') && !Object.prototype.hasOwnProperty.call(v, 'validate');
  if (!list.some((r) => { const v = r.deref(); return v !== undefined && untouched(v); })) return;
  try {
    const v = new core.Validator({
      type: 'object',
      properties: {
        a: { type: 'string', minLength: 2, maxLength: 9, pattern: '^[a-z]+$', format: 'email' },
        b: { type: 'integer', minimum: 1, maximum: 9 },
        c: { type: 'array', items: { type: 'string' }, maxItems: 3 },
        d: { const: true },
        e: { type: 'object', properties: { f: { type: 'string' } }, required: ['f'] },
      },
      required: ['a', 'b'],
    });
    v.isValidObject({ a: 'ab@c.de', b: 2, c: ['x'], d: true, e: { f: 'x' } });
    void v.validate({ a: '1', b: 0, c: [1], d: false, e: {} }).errors.length;
  } catch { /* a warm-up never reaches the caller */ }
}

// The public names. lib/public-api.js holds the same for index.edge.js; they
// are written out here rather than required so that loading the package in
// Node reads one file fewer (tests/test_edge_entry.js and
// tests/test_esm_exports.js hold the two to the same names).




// The parts no Validator calls: TypeScript generation, the error renderers,
// the spec output format, the retry message for language models, the schema
// description and the suggestion helper. ata-validator/lite leaves them out.
// Each loads its module on first call. None of them is on the path to a first
// validated request, and together they were about a sixth of what requiring
// the package cost.
function toTypeScript (...a) { return require('./lib/ts-gen').toTypeScript(...a); }
function renderPretty (...a) { return require('./lib/render-pretty').renderPretty(...a); }
function renderCompact (...a) { return require('./lib/render-compact').renderCompact(...a); }
function toOutput (...a) { return require('./lib/output-format').toOutput(...a); }
function toRetryMessage (...a) { return require('./lib/retry-message').toRetryMessage(...a); }
function describeSchema (...a) { return require('./lib/describe-schema').describeSchema(...a); }
function renderJSON (...a) { return require('./lib/render-json').renderJSON(...a); }

// Walk a JSON pointer (RFC 6901 escapes) into a data tree. Mirrors the helper
// inside lib/suggestions.js, kept local to avoid exporting an internal.
function _walkPointer (root, pointer) {
  if (!pointer) return root;
  const parts = pointer.replace(/^\//, '').split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  let cur = root;
  for (const p of parts) { if (cur == null) return undefined; cur = cur[p]; }
  return cur;
}

// Post-hoc suggestion enrichment for AOT-compiled validators. The standalone
// modules do not embed the suggestion engine, so consumers who want
// suggestions pass the error array through this after validation.
function attachSuggestions (errors, data) {
  if (!errors) return errors;
  const { suggestFor } = require('./lib/suggestions');
  const { reprValue } = require('./lib/enrich-error');
  for (const e of errors) {
    if (!e || e.suggestion) continue;
    let received = e.received;
    if (received === undefined && data !== undefined) {
      const ptr = e.instancePath != null ? e.instancePath : (e.path || '');
      const raw = _walkPointer(data, ptr);
      if (raw !== undefined || ptr === '') received = reprValue(raw);
    }
    const probe = received !== undefined && e.received === undefined
      ? Object.assign({}, e, { received })
      : e;
    const s = suggestFor(probe, data);
    if (s) e.suggestion = s;
  }
  // AOT modules import nothing, so this is their only route to a frame. The
  // caller holds the original object and ran no preprocessing through here.
  require('./lib/diagnostic-source').setDiagnosticSource(errors, { data, mutatesInput: false });
  return errors;
}

module.exports = {
  Validator: core.Validator,
  compile: core.compile,
  validate: core.validate,
  validateAsync: core.validateAsync,
  parseAsync: core.parseAsync,
  version: core.version,
  createPaddedBuffer: core.createPaddedBuffer,
  SIMDJSON_PADDING: core.SIMDJSON_PADDING,
  parseJSON: core.parseJSON,
  toTypeScript,
  defineSchema: core.defineSchema,
  schemaOf: core.schemaOf,
  renderPretty,
  renderCompact,
  toOutput,
  toRetryMessage,
  describeSchema,
  renderJSON,
  attachSuggestions, // internal: used by the renderers; not public API
};
