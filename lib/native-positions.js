'use strict';

// The entries buildTargetedPositionMap gives, found by the native addon where
// it can: simdjson indexes the document's structure once and walks that
// index to each pointer, where the script walk reads every character. On a
// 5 MB log with the error near its end that is 3.1 ms against 8.3. Only for
// a large ASCII string, where the addon's UTF-8 byte offsets are the string's
// indexes, and only when every wanted pointer is found; otherwise null, and
// the caller builds the map in script as before.
const NATIVE_MIN = 32 * 1024;
let _native;
function nativeTargeted (text, wanted) {
  if (typeof text !== 'string' || text.length < NATIVE_MIN) return null;
  if (_native === undefined) {
    try { _native = require('./native-load')(); } catch { _native = null; }
    if (_native && typeof _native.locatePointers !== 'function') _native = null;
  }
  if (_native === null || typeof Buffer === 'undefined' || Buffer.byteLength(text, 'utf8') !== text.length) return null;
  const ptrs = Array.from(wanted);
  let found;
  try { found = _native.locatePointers(text, ptrs); } catch { return null; }
  const offs = [];
  for (let k = 0; k < ptrs.length; k++) {
    if (!(found[2 * k] >= 0)) return null;
    offs.push(found[2 * k]);
  }
  // Line starts for the offsets that are asked about, in one forward pass.
  const needed = [];
  for (let k = 0; k < ptrs.length; k++) {
    needed.push(offs[k]);
    const ks = keyStartBefore(text, offs[k]);
    if (ks >= 0) needed.push(ks);
  }
  const lineOf = lineFinder(text, needed);
  const map = Object.create(null);
  for (let k = 0; k < ptrs.length; k++) {
    const off = offs[k];
    const at = lineOf(off);
    const entry = { byteOffset: off, length: found[2 * k + 1], line: at.line, col: off - at.start + 1, text: at.text };
    const ks = keyStartBefore(text, off);
    if (ks >= 0 && ptrs[k] !== '') {
      const kat = lineOf(ks);
      entry.keyOffset = ks;
      entry.keyLength = keyEndAfter(text, ks) - ks + 1;
      entry.keyLine = kat.line;
      entry.keyCol = ks - kat.start + 1;
    }
    map[ptrs[k]] = entry;
  }
  return map;
}

// The opening quote of the member name before a value at `off`, or -1 where
// the value is an array element or the root.
function keyStartBefore (text, off) {
  let j = off - 1;
  while (j >= 0) { const c = text.charCodeAt(j); if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) j--; else break; }
  if (j < 0 || text.charCodeAt(j) !== 0x3a) return -1;
  j--;
  while (j >= 0) { const c = text.charCodeAt(j); if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) j--; else break; }
  if (j < 0 || text.charCodeAt(j) !== 0x22) return -1;
  // Back to the quote that opens the name: one not preceded by an odd run of
  // backslashes.
  for (let q = j - 1; q >= 0; q--) {
    if (text.charCodeAt(q) !== 0x22) continue;
    let b = q - 1;
    while (b >= 0 && text.charCodeAt(b) === 0x5c) b--;
    if (((q - 1 - b) & 1) === 0) return q;
  }
  return -1;
}
function keyEndAfter (text, start) {
  let q = start + 1;
  for (;;) {
    const c = text.charCodeAt(q);
    if (c === 0x5c) { q += 2; continue; }
    if (c === 0x22 || q >= text.length) return q;
    q++;
  }
}
// Line number, line start and line text for any of `offsets`, from one pass.
function lineFinder (text, offsets) {
  const sorted = Array.from(new Set(offsets)).sort((a, b) => a - b);
  const info = new Map();
  let line = 1, start = 0, s = 0;
  while (s < sorted.length) {
    const nl = text.indexOf('\n', start);
    const end = nl === -1 ? text.length : nl;
    while (s < sorted.length && sorted[s] <= end) {
      info.set(sorted[s], { line, start, text: text.slice(start, end) });
      s++;
    }
    if (nl === -1) break;
    line++;
    start = nl + 1;
  }
  return (off) => info.get(off);
}

module.exports = { nativeTargeted };
