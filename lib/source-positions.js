'use strict';

/**
 * Build a map of JSON pointer → { line, col, text } by scanning JSON text.
 *
 * Approach: use JSON.parse for correctness, then do one structural scan
 * tracking bracket depth and key positions. This avoids hand-rolling a
 * full JSON parser while delivering keyword-level positions sufficient
 * for source frames.
 *
 * Limitations (acceptable for source frames):
 *  - Duplicate keys: last wins.
 *  - Whitespace inside string values does not affect tracking (strings
 *    are skipped over wholesale).
 *  - Comments / trailing commas: JSON only, no JSON5.
 */

function escapePtr (s) {
  return s.replace(/~/g, '~0').replace(/\//g, '~1');
}

function buildPositionMap (text) {
  const map = Object.create(null);
  const lines = text.split('\n');
  const lineStart = new Array(lines.length + 1);
  lineStart[0] = 0;
  for (let i = 0; i < lines.length; i++) lineStart[i + 1] = lineStart[i] + lines[i].length + 1;

  function offsetToLineCol (off) {
    // Binary search lineStart
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
      if (ch === 0x20 || ch === 0x09 || ch === 0x0a || ch === 0x0d) i++;
      else break;
    }
  }

  function readString () {
    // Assumes text[i] === '"'
    const start = i;
    i++;
    while (i < n) {
      const ch = text.charCodeAt(i);
      if (ch === 0x5c) { i += 2; continue; }   // backslash escape
      if (ch === 0x22) { i++; return JSON.parse(text.slice(start, i)); }
      i++;
    }
    throw new Error('unterminated string at offset ' + start);
  }

  function skipValue () {
    skipWs();
    if (i >= n) return;
    const ch = text.charCodeAt(i);
    if (ch === 0x22) { readString(); return; }
    if (ch === 0x7b || ch === 0x5b) { // { or [
      const open = ch;
      const close = open === 0x7b ? 0x7d : 0x5d;
      let depth = 1;
      i++;
      while (i < n && depth > 0) {
        const c = text.charCodeAt(i);
        if (c === 0x22) { readString(); continue; }
        if (c === open) depth++;
        else if (c === close) depth--;
        i++;
      }
      return;
    }
    // primitive: read until ,, }, ], or whitespace
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 0x2c || c === 0x7d || c === 0x5d || c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) return;
      i++;
    }
  }

  function pointerOf (path) {
    if (path.length === 0) return '';
    return '/' + path.map(escapePtr).join('/');
  }

  function walk (path) {
    skipWs();
    if (i >= n) return;
    // Record position of the *value* at this path
    const pos = offsetToLineCol(i);
    map[pointerOf(path)] = pos;

    const ch = text.charCodeAt(i);

    if (ch === 0x7b) { // object
      i++;
      while (true) {
        skipWs();
        if (text.charCodeAt(i) === 0x7d) { i++; return; }
        if (text.charCodeAt(i) === 0x2c) { i++; continue; }
        skipWs();
        // Key
        const keyStart = i;
        const key = readString();
        // Record key position too — keyed by `<path>/<key>` so source frame
        // can point at the keyword name, not its value.
        const keyPos = offsetToLineCol(keyStart);
        skipWs();
        if (text.charCodeAt(i) !== 0x3a) throw new Error('expected ":" at offset ' + i);
        i++;
        const childPath = path.concat([key]);
        // Mark the key location at <path>/<key>#key (used by renderers
        // for keyword-name framing); the value location overwrites in walk().
        map[pointerOf(childPath) + '#key'] = keyPos;
        walk(childPath);
      }
    } else if (ch === 0x5b) { // array
      i++;
      let idx = 0;
      while (true) {
        skipWs();
        if (text.charCodeAt(i) === 0x5d) { i++; return; }
        if (text.charCodeAt(i) === 0x2c) { i++; continue; }
        walk(path.concat([String(idx)]));
        idx++;
      }
    } else {
      skipValue();
    }
  }

  // Strip BOM if present
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  walk([]);
  return map;
}

module.exports = { buildPositionMap, escapePtr };
