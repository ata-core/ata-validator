'use strict';

const { buildDataPositionMap, buildTargetedPositionMap } = require('./data-positions');

/**
 * Memoize the position map for the duration of a single validate() call.
 * Caller passes the original buffer/string. Identity-keyed: same reference
 * == same map. No global state, caller holds the cache instance.
 */

function createCache () {
  const wm = new WeakMap();
  const sm = new Map(); // strings can't go in WeakMap; clear after each validate
  let lastInput = null;
  const cache = {
    /**
     * The entries for a known set of pointers, which is what a rejection needs:
     * recording one per node in the document was the dominant cost of reading an
     * error's frame.
     *
     * The caller derives `wanted` from the errors, and a derivation that misses a
     * pointer must not cost a frame, so the result answers any pointer outside
     * the set by building the full map once and reading from that. A wrong
     * derivation is then slow rather than silently short of frames, which is the
     * only acceptable direction for this trade: a missing caret is the failure
     * nobody reports.
     */
    targeted (input, wanted) {
      if (input == null) return null;
      if (!wanted || wanted.size === 0) return null;
      const already = typeof input === 'string'
        ? sm.get(input)
        : (Buffer.isBuffer(input) ? wm.get(input) : undefined);
      if (already) return already;
      let filtered;
      try {
        filtered = buildTargetedPositionMap(input, wanted);
      } catch {
        return null;
      }
      let full;
      const fallback = (key) => {
        if (wanted.has(key)) return undefined; // asked for, absent from the document
        if (full === undefined) full = cache.get(input) || null;
        return full ? full[key] : undefined;
      };
      return new Proxy(filtered, {
        get (target, key) {
          if (typeof key !== 'string') return target[key];
          if (key in target) return target[key];
          return fallback(key);
        },
        has (target, key) {
          if (typeof key !== 'string') return key in target;
          return (key in target) || fallback(key) !== undefined;
        },
      });
    },
    get (input) {
      if (input == null) return null;
      if (typeof input === 'string') {
        if (sm.has(input)) return sm.get(input);
        try {
          const m = buildDataPositionMap(input);
          sm.set(input, m);
          return m;
        } catch { return null; }
      }
      if (Buffer.isBuffer(input)) {
        if (wm.has(input)) return wm.get(input);
        try {
          const m = buildDataPositionMap(input);
          wm.set(input, m);
          return m;
        } catch { return null; }
      }
      return null;
    },
    reset () {
      sm.clear();
      lastInput = null;
    },
  };
  return cache;
}

module.exports = { createCache };
