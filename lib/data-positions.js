'use strict';

/**
 * Build pointer → { byteOffset, length, line, col, text } from a JSON
 * input buffer. Called only when validation fails AND richErrors is on
 * AND abortEarly is off. Zero cost on the valid path.
 */

// Self-contained on purpose: `toStandaloneModule({ positions: true })` embeds
// this function verbatim via Function.prototype.toString, so it may not close
// over anything in this module and may not assume Node globals. The inlined
// pointer escaping below duplicates lib/source-positions.js for that reason.
function buildDataPositionMap (input) {
  const text = (typeof Buffer !== 'undefined' && Buffer.isBuffer(input)) ? input.toString('utf8') : String(input);
  const map = Object.create(null);
  const n = text.length;

  // Offsets during the walk, line and column afterwards. Resolving them here
  // cost a binary search and an object allocation for every node in the
  // document, when only the nodes an error names are ever read.
  const ptrs = [];
  const starts = [];
  const lens = [];
  const keyStarts = [];
  const keyLens = [];

  let i = 0;

  function skipWs () {
    while (i < n) {
      const ch = text.charCodeAt(i);
      if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d) i++; else break;
    }
  }

  // Span the string token, leaving `i` just past the closing quote. A plain
  // token is sliced; one holding an escape or a raw control character goes
  // through JSON.parse, which is what decodes `é` and what rejects a
  // literal newline or a bad escape. Values are spanned and not decoded, but a
  // malformed one still has to be rejected, so it is parsed for the throw.
  //
  // A token that does not open with a quote is not simple either. Object keys
  // are read here unconditionally, so a document whose opening quote is missing
  // (`{ mo": 1 }`) arrives with `m` under the cursor, and slicing it would map a
  // key nobody wrote. Parsing the span rejects it instead.
  function readString (decode) {
    const start = i;
    let simple = text.charCodeAt(i) === 0x22;
    i++;
    let closed = false;
    while (i < n) {
      const ch = text.charCodeAt(i);
      if (ch === 0x5c) { simple = false; i += 2; continue; }
      if (ch === 0x22) { i++; closed = true; break; }
      if (ch < 0x20) simple = false;
      i++;
    }
    if (!closed) throw new Error('unterminated string at offset ' + start);
    if (simple) return decode ? text.slice(start + 1, i - 1) : null;
    const decoded = JSON.parse(text.slice(start, i));
    return decode ? decoded : null;
  }

  // The pointer is carried down the walk. Rebuilding it per node from a path
  // array cost an array copy, a map and a join for every node.
  function walk (ptr, keyStart, keyLen) {
    skipWs();
    if (i >= n) return;
    const start = i;

    const ch = text.charCodeAt(i);
    if (ch === 0x7b) {
      i++;
      while (true) {
        skipWs();
        // The input is not required to be valid JSON: this map is built to
        // put a caret on a syntax error, so a document that stops in the
        // middle of a container is the normal case, not an impossible one.
        if (i >= n) break;
        if (text.charCodeAt(i) === 0x7d) { i++; break; }
        if (text.charCodeAt(i) === 0x2c) { i++; continue; }
        skipWs();
        // Record the key token before consuming it. The caret for an error
        // that names a property belongs on the property, not on the value and
        // not on the enclosing object.
        const memberKeyStart = i;
        const key = readString(true);
        const memberKeyLen = i - memberKeyStart;
        skipWs();
        if (text.charCodeAt(i) !== 0x3a) throw new Error('expected ":" at offset ' + i);
        i++;
        const seg = (key.indexOf('~') === -1 && key.indexOf('/') === -1)
          ? key
          : key.replace(/~/g, '~0').replace(/\//g, '~1');
        walk(ptr + '/' + seg, memberKeyStart, memberKeyLen);
      }
    } else if (ch === 0x5b) {
      i++;
      let idx = 0;
      while (true) {
        skipWs();
        if (i >= n) break;
        if (text.charCodeAt(i) === 0x5d) { i++; break; }
        if (text.charCodeAt(i) === 0x2c) { i++; continue; }
        const before = i;
        walk(ptr + '/' + idx, -1, 0);
        // A character that begins no value at all, a stray `}` for instance,
        // leaves the position where it was, and a loop that does not advance
        // does not end. `validateJSON('[')` hung here on one byte.
        if (i === before) break;
        idx++;
      }
    } else if (ch === 0x22) {
      readString(false);
    } else {
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === 0x2c || c === 0x7d || c === 0x5d || c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) break;
        i++;
      }
    }

    ptrs.push(ptr);
    starts.push(start);
    lens.push(i - start);
    keyStarts.push(keyStart);
    keyLens.push(keyLen);
  }

  if (text.charCodeAt(0) === 0xfeff) i = 1;
  walk('', -1, 0);

  if (ptrs.length === 0) return map;

  const lines = text.split('\n');
  const lineStart = new Array(lines.length + 1);
  lineStart[0] = 0;
  for (let k = 0; k < lines.length; k++) lineStart[k + 1] = lineStart[k] + lines[k].length + 1;

  function lineOf (off) {
    let lo = 0, hi = lineStart.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStart[mid] <= off) lo = mid; else hi = mid - 1;
    }
    return lo;
  }

  for (let k = 0; k < ptrs.length; k++) {
    const off = starts[k];
    const line = lineOf(off);
    const entry = {
      byteOffset: off,
      length: lens[k],
      line: line + 1,
      col: off - lineStart[line] + 1,
      text: lines[line] || '',
    };
    if (keyStarts[k] >= 0) {
      const keyLine = lineOf(keyStarts[k]);
      entry.keyOffset = keyStarts[k];
      entry.keyLength = keyLens[k];
      entry.keyLine = keyLine + 1;
      entry.keyCol = keyStarts[k] - lineStart[keyLine] + 1;
    }
    map[ptrs[k]] = entry;
  }
  return map;
}

module.exports = { buildDataPositionMap };
