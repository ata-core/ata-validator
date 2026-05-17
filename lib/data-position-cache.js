'use strict';

const { buildDataPositionMap } = require('./data-positions');

/**
 * Memoize the position map for the duration of a single validate() call.
 * Caller passes the original buffer/string. Identity-keyed: same reference
 * == same map. No global state, caller holds the cache instance.
 */

function createCache () {
  const wm = new WeakMap();
  const sm = new Map(); // strings can't go in WeakMap; clear after each validate
  let lastInput = null;
  return {
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
}

module.exports = { createCache };
