'use strict';

/**
 * Resolve a JSON pointer against a document, for the diagnostic paths that run
 * once per error on a rejected payload.
 *
 * Segments are read straight out of the pointer string: no leading-slash
 * regex, no parts array, and no unescape pass on the segments that carry no
 * `~`. A pointer that leaves the document returns rather than throwing,
 * because a diagnostic must not fail where validation succeeded.
 *
 * `missing` separates the two ways a pointer yields nothing: a key that is
 * absent from a container that exists resolves to undefined, while a pointer
 * that walks through a null or a primitive returns `missing`. Callers that
 * format the value need that apart, since the first is a value worth printing
 * and the second is a path that was never in the document.
 *
 * @param {*} data the document the pointer is read against
 * @param {string} pointer an RFC 6901 pointer, '' for the document itself
 * @param {*} [missing] returned when the walk leaves the document
 * @returns {*} the value at the pointer, `missing` if the walk broke
 */
function resolvePointer (data, pointer, missing) {
  if (!pointer) return data;
  const len = pointer.length;
  let cur = data;
  let i = pointer.charCodeAt(0) === 47 ? 1 : 0; // 47 is '/'
  for (;;) {
    let j = pointer.indexOf('/', i);
    if (j === -1) j = len;
    let seg = pointer.slice(i, j);
    if (seg.indexOf('~') !== -1) seg = seg.replace(/~1/g, '/').replace(/~0/g, '~');
    if (cur == null) return missing;
    cur = cur[seg];
    if (j === len) break;
    i = j + 1;
  }
  return cur;
}

// Passed where a caller has no resolved value to offer, which is not the same
// as resolving to undefined: the first means walk it yourself, the second
// means the document really holds nothing there.
const UNRESOLVED = Symbol('ata.pointer.unresolved');

module.exports = { resolvePointer, UNRESOLVED };
