'use strict';

// Attach to an errors array the material a renderer needs to build frames:
// the data, the original text when there was one, the schema, and whether
// validate() changed the data before the verdict.
//
// It rides on the array as a non-enumerable symbol property, never on the
// error objects. JSON.stringify, Object.keys, length and deep equality against
// a fixture are unchanged. A WeakMap side table was tried and measured: it
// keyed short-lived arrays, and the ephemeron work pushed the garbage
// collector to a third of the reject path. A property costs about 80 ns and
// nothing at collection time.
const KEY = Symbol.for('ata.diagnosticSource');

// One descriptor, reused. Building a fresh one per call was most of this
// function's cost in the single-error profile, through the allocation and
// the collection that followed it.
const DESCRIPTOR = { value: null, enumerable: false, configurable: true, writable: true };

function setDiagnosticSource (errors, payload) {
  if (!Array.isArray(errors) || !payload || !Object.isExtensible(errors)) return errors;
  const prev = errors[KEY];
  let value = payload;
  if (prev) {
    // validateJSON's already-enriched path runs after the validate() wrapper
    // has recorded the parsed data. Merge, so the text arrives without the
    // data going missing.
    value = Object.assign({}, prev);
    for (const k of Object.keys(payload)) if (payload[k] !== undefined) value[k] = payload[k];
  }
  try {
    DESCRIPTOR.value = value;
    Object.defineProperty(errors, KEY, DESCRIPTOR);
    DESCRIPTOR.value = null;
  } catch {
    // A validator that throws from its own error path is worse than a
    // missing frame. The renderer degrades to pointer-only output.
  }
  return errors;
}

function getDiagnosticSource (errors) {
  return (Array.isArray(errors) && errors[KEY]) || null;
}

module.exports = { setDiagnosticSource, getDiagnosticSource };
