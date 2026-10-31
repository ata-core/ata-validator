'use strict';

// Sets up the native engine for one validator: its compiled schema and its
// slot in the addon's fast registry, which the buffer APIs read. Kept out of
// lib/validator-core.js so the browser build, which has no addon, maps this
// file to lib/native-attach.browser.js and leaves it out.
function attachNative(self, native) {
  if (!native) return;
  if (!self._schemaStr) self._schemaStr = JSON.stringify(self._schemaObj);
  let nativeSchemaStr = self._schemaStr;
  // A boolean root references nothing, so the registry has nowhere to go and
  // is left out; merging it used to throw on `true` and `false`.
  if (self._schemaMap.size > 0 && typeof self._schemaObj === 'object' && self._schemaObj !== null) {
    const merged = JSON.parse(self._schemaStr);
    if (!merged.$defs) merged.$defs = {};
    // The registry goes into $defs under generated names. A name the
    // schema already uses, or two ids that flatten to one name, would put
    // one schema where another is referenced; the native engine is then
    // left out and the JS engines answer.
    for (const [id, s] of self._schemaMap) {
      const name = '__ext_' + id.replace(/[^a-zA-Z0-9]/g, '_');
      if (Object.prototype.hasOwnProperty.call(merged.$defs, name)) { self._fastSlot = -1; return; }
      merged.$defs[name] = s;
    }
    nativeSchemaStr = JSON.stringify(merged);
  }
  // The fast registry is a fixed array of slots in the addon, and registering
  // a distinct schema past the last one throws. It is an accelerator for the
  // buffer path, not a requirement, so a full registry leaves the slot at -1
  // and the buffer methods answer from the JS engine instead. Letting this
  // throw made every validator built after the 4096th unusable on that path.
  // A schema the native engine declines to compile (a pattern RE2 cannot
  // take) goes the same way.
  try {
    self._compiled = new native.CompiledSchema(nativeSchemaStr);
    self._fastSlot = native.fastRegister(nativeSchemaStr);
  } catch {
    self._compiled = null;
    self._fastSlot = -1;
  }
}

// The buffer APIs on the native engine's fast slot, or through validate()
// for the shapes lib/buffer-gate.js routes and a validator with no slot.
function installFast(self, native, bufferNeedsSlowPath, installSlowBufferApis) {
  if (bufferNeedsSlowPath(self._schemaObj, self._schemaMap, self._keywords, self._userFormats)) return installSlowBufferApis(self);
  self._ensureNative();
  const slot = self._fastSlot;
  if (!(slot >= 0)) return installSlowBufferApis(self);
  const bytes = (b, who) => {
    if (typeof b === 'string') return Buffer.from(b);
    if (b instanceof Uint8Array) return b;
    throw new TypeError(`${who}() requires a Buffer, Uint8Array, or string. For parsed objects, use isValidObject().`);
  };
  self.isValid = (b) => native.rawFastValidate(slot, bytes(b, 'isValid'));
  self.isValidPrepadded = (paddedBuffer, jsonLength) => native.rawFastValidate(slot, paddedBuffer, jsonLength);
  self.isValidParallel = (b) => native.rawParallelValidate(slot, bytes(b, 'isValidParallel'));
  self.isValidNDJSON = (b) => native.rawNDJSONValidate(slot, bytes(b, 'isValidNDJSON'));
  self.countValid = (b) => {
    const r = native.rawNDJSONValidate(slot, bytes(b, 'countValid'));
    let n = 0;
    for (let i = 0; i < r.length; i++) if (r[i]) n++;
    return n;
  };
  self.batchIsValid = (buffers) => {
    let n = 0;
    for (const b of buffers) {
      if (!(b instanceof Uint8Array)) throw new TypeError('batchIsValid() requires Buffer or Uint8Array elements');
      if (native.rawFastValidate(slot, b)) n++;
    }
    return n;
  };
}

attachNative.installFast = installFast;
module.exports = attachNative;
