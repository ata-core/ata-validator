'use strict';

/**
 * Build pointer → { byteOffset, length, line, col, text } from a JSON
 * input buffer. Called only when validation fails AND richErrors is on
 * AND abortEarly is off. Zero cost on the valid path.
 */

const { escapePtr } = require('./source-positions');

function buildDataPositionMap (input) {
  const text = Buffer.isBuffer(input) ? input.toString('utf8') : String(input);
  const map = Object.create(null);
  const lines = text.split('\n');
  const lineStart = new Array(lines.length + 1);
  lineStart[0] = 0;
  for (let i = 0; i < lines.length; i++) lineStart[i + 1] = lineStart[i] + lines[i].length + 1;

  function offsetToLineCol (off) {
    let lo = 0, hi = lineStart.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStart[mid] <= off) lo = mid; else hi = mid - 1;
    }
    return { line: lo + 1, col: off - lineStart[lo] + 1, text: lines[lo] || '' };
  }

  let i = 0;
  const n = text.length;

  function skipWs () {
    while (i < n) {
      const ch = text.charCodeAt(i);
      if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d) i++; else break;
    }
  }

  function readString () {
    const start = i;
    i++;
    while (i < n) {
      const ch = text.charCodeAt(i);
      if (ch === 0x5c) { i += 2; continue; }
      if (ch === 0x22) { i++; return JSON.parse(text.slice(start, i)); }
      i++;
    }
    throw new Error('unterminated string at offset ' + start);
  }

  function pointerOf (path) {
    if (path.length === 0) return '';
    return '/' + path.map(escapePtr).join('/');
  }

  function walk (path, keySpan) {
    skipWs();
    if (i >= n) return;
    const start = i;
    const pos = offsetToLineCol(start);

    const ch = text.charCodeAt(i);
    if (ch === 0x7b) {
      i++;
      while (true) {
        skipWs();
        if (text.charCodeAt(i) === 0x7d) { i++; break; }
        if (text.charCodeAt(i) === 0x2c) { i++; continue; }
        skipWs();
        // Record the key token before consuming it. The caret for an error
        // that names a property belongs on the property, not on the value and
        // not on the enclosing object.
        const keyStart = i;
        const keyPos = offsetToLineCol(keyStart);
        const key = readString();
        const span = {
          keyOffset: keyStart,
          keyLength: i - keyStart,
          keyLine: keyPos.line,
          keyCol: keyPos.col,
        };
        skipWs();
        if (text.charCodeAt(i) !== 0x3a) throw new Error('expected ":" at offset ' + i);
        i++;
        walk(path.concat([key]), span);
      }
    } else if (ch === 0x5b) {
      i++;
      let idx = 0;
      while (true) {
        skipWs();
        if (text.charCodeAt(i) === 0x5d) { i++; break; }
        if (text.charCodeAt(i) === 0x2c) { i++; continue; }
        walk(path.concat([String(idx)]));
        idx++;
      }
    } else if (ch === 0x22) {
      readString();
    } else {
      while (i < n) {
        const c = text.charCodeAt(i);
        if (c === 0x2c || c === 0x7d || c === 0x5d || c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) break;
        i++;
      }
    }

    const length = i - start;
    const entry = { byteOffset: start, length, line: pos.line, col: pos.col, text: pos.text };
    if (keySpan) {
      entry.keyOffset = keySpan.keyOffset;
      entry.keyLength = keySpan.keyLength;
      entry.keyLine = keySpan.keyLine;
      entry.keyCol = keySpan.keyCol;
    }
    map[pointerOf(path)] = entry;
  }

  if (text.charCodeAt(0) === 0xfeff) i = 1;
  walk([]);
  return map;
}

module.exports = { buildDataPositionMap };
