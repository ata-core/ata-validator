'use strict';

// Helpers shared by every generated scanner. The scanner reads a JSON document
// straight out of the text and answers the schema from it, so anything here
// that is laxer than JSON.parse turns into a document accepted that parsing
// would have rejected. Each function below is written to the JSON grammar,
// not to what looks close enough.

// Four hex digits after a \u escape. JSON.parse throws without them.
function hex4(s, i) {
  for (let k = i; k < i + 4; k++) {
    const c = s.charCodeAt(k);
    if (c >= 48 && c <= 57) continue;
    if (c >= 97 && c <= 102) continue;
    if (c >= 65 && c <= 70) continue;
    return false;
  }
  return true;
}

// The depth at which a skipped subtree stops being skipped and the caller
// falls back to JSON.parse. V8's own parser gives up somewhere past this, and
// the point is not to guess where: past this depth the scanner declines rather
// than risk answering a document the parser would have refused.
const MAX_SKIP_DEPTH = 512;

const MALFORMED = -1;
const TOO_DEEP = -2;

// Validate one JSON value starting at `i` and return the index just past it,
// MALFORMED if the text is not JSON, or TOO_DEEP. Iterative: a nesting depth
// the schema knows nothing about must not be able to overflow the stack.
function skipValue(s, i) {
  const len = s.length;
  // `stack` holds, per open container, 0 for an object and 1 for an array.
  const stack = [];
  let depth = 0;
  for (;;) {
    // --- one value
    let c = s.charCodeAt(i);
    while (c === 32 || c === 10 || c === 9 || c === 13) c = s.charCodeAt(++i);
    if (c === 34) {
      i = skipString(s, i);
      if (i < 0) return MALFORMED;
    } else if (c === 123 || c === 91) {
      if (depth >= MAX_SKIP_DEPTH) return TOO_DEEP;
      stack[depth++] = c === 123 ? 0 : 1;
      i++;
      c = s.charCodeAt(i);
      while (c === 32 || c === 10 || c === 9 || c === 13) c = s.charCodeAt(++i);
      if (c === (stack[depth - 1] === 0 ? 125 : 93)) { depth--; i++; }
      else if (stack[depth - 1] === 0) {
        // an object member starts with a key
        if (c !== 34) return MALFORMED;
        i = skipString(s, i);
        if (i < 0) return MALFORMED;
        c = s.charCodeAt(i);
        while (c === 32 || c === 10 || c === 9 || c === 13) c = s.charCodeAt(++i);
        if (c !== 58) return MALFORMED;
        i++;
        continue;
      } else {
        continue;
      }
    } else if (c === 116) {
      if (s.charCodeAt(i + 1) !== 114 || s.charCodeAt(i + 2) !== 117 || s.charCodeAt(i + 3) !== 101) return MALFORMED;
      i += 4;
    } else if (c === 102) {
      if (s.charCodeAt(i + 1) !== 97 || s.charCodeAt(i + 2) !== 108 || s.charCodeAt(i + 3) !== 115 || s.charCodeAt(i + 4) !== 101) return MALFORMED;
      i += 5;
    } else if (c === 110) {
      if (s.charCodeAt(i + 1) !== 117 || s.charCodeAt(i + 2) !== 108 || s.charCodeAt(i + 3) !== 108) return MALFORMED;
      i += 4;
    } else {
      i = skipNumber(s, i);
      if (i < 0) return MALFORMED;
    }

    // --- close as many containers as the next punctuation closes
    for (;;) {
      if (depth === 0) return i;
      let c2 = s.charCodeAt(i);
      while (c2 === 32 || c2 === 10 || c2 === 9 || c2 === 13) c2 = s.charCodeAt(++i);
      const inObject = stack[depth - 1] === 0;
      if (c2 === 44) {
        i++;
        if (inObject) {
          let c3 = s.charCodeAt(i);
          while (c3 === 32 || c3 === 10 || c3 === 9 || c3 === 13) c3 = s.charCodeAt(++i);
          if (c3 !== 34) return MALFORMED;
          i = skipString(s, i);
          if (i < 0) return MALFORMED;
          c3 = s.charCodeAt(i);
          while (c3 === 32 || c3 === 10 || c3 === 9 || c3 === 13) c3 = s.charCodeAt(++i);
          if (c3 !== 58) return MALFORMED;
          i++;
        }
        break; // read the next value
      }
      if (c2 === (inObject ? 125 : 93)) { depth--; i++; continue; }
      return MALFORMED;
    }
    if (i > len) return MALFORMED;
  }
}

// `i` is at the opening quote; returns the index just past the closing one.
function skipString(s, i) {
  i++;
  for (;;) {
    const c = s.charCodeAt(i);
    if (c === 34) return i + 1;
    if (c === 92) {
      const e = s.charCodeAt(i + 1);
      if (e === 117) {
        if (!hex4(s, i + 2)) return -1;
        i += 6;
        continue;
      }
      if (e === 34 || e === 92 || e === 47 || e === 98 || e === 102 || e === 110 || e === 114 || e === 116) { i += 2; continue; }
      return -1;
    }
    // NaN at end of input fails this too, which is the unterminated case.
    if (!(c >= 32)) return -1;
    i++;
  }
}

function skipNumber(s, i) {
  let c = s.charCodeAt(i);
  if (c === 45) c = s.charCodeAt(++i);
  if (c === 48) c = s.charCodeAt(++i);
  else if (c >= 49 && c <= 57) { do { c = s.charCodeAt(++i); } while (c >= 48 && c <= 57); }
  else return -1;
  if (c === 46) {
    c = s.charCodeAt(++i);
    if (!(c >= 48 && c <= 57)) return -1;
    do { c = s.charCodeAt(++i); } while (c >= 48 && c <= 57);
  }
  if (c === 101 || c === 69) {
    c = s.charCodeAt(++i);
    if (c === 43 || c === 45) c = s.charCodeAt(++i);
    if (!(c >= 48 && c <= 57)) return -1;
    do { c = s.charCodeAt(++i); } while (c >= 48 && c <= 57);
  }
  return i;
}

// The decoded value of a string span, for the checks that need the string
// itself. `p` is just past the opening quote, `e` is at the closing one.
// An escaped span is decoded by the parser, so the result is what JSON.parse
// would have produced for that member and nothing subtler.
function span(s, p, e, escaped) {
  if (!escaped) return s.slice(p, e);
  return JSON.parse(s.slice(p - 1, e + 1));
}

module.exports = { hex4, skipValue, skipString, skipNumber, span, MALFORMED, TOO_DEEP, MAX_SKIP_DEPTH };
