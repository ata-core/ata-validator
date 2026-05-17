'use strict';

const assert = require('assert');
const jsonc = require('jsonc-parser');
const { buildPositionMap } = require('../lib/source-positions');

const ITERATIONS = process.env.FUZZ_POSITIONS_ITERATIONS ? Number(process.env.FUZZ_POSITIONS_ITERATIONS) : 200;

function randKey (rng) {
  const len = 1 + (rng() * 8) | 0;
  let s = '';
  for (let i = 0; i < len; i++) s += String.fromCharCode(0x61 + (rng() * 26 | 0));
  return s;
}

function randVal (rng, depth) {
  const r = rng();
  if (depth > 3 || r < 0.4) {
    // primitive
    const k = (rng() * 4) | 0;
    if (k === 0) return rng() * 1000 | 0;
    if (k === 1) return rng() > 0.5;
    if (k === 2) return null;
    return randKey(rng);
  }
  if (r < 0.7) {
    const len = (rng() * 4) | 0;
    const arr = [];
    for (let i = 0; i < len; i++) arr.push(randVal(rng, depth + 1));
    return arr;
  }
  const len = 1 + ((rng() * 4) | 0);
  const obj = {};
  for (let i = 0; i < len; i++) obj[randKey(rng)] = randVal(rng, depth + 1);
  return obj;
}

// Seedable PRNG (xorshift32)
function makeRng (seed) {
  let s = seed | 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return ((s >>> 0) % 1e9) / 1e9;
  };
}

function collectPointers (obj, path, out) {
  out.push('/' + path.map(p => p.replace(/~/g, '~0').replace(/\//g, '~1')).join('/'));
  if (path.length === 0) out[out.length - 1] = '';
  if (obj && typeof obj === 'object') {
    if (Array.isArray(obj)) {
      for (let i = 0; i < obj.length; i++) collectPointers(obj[i], path.concat([String(i)]), out);
    } else {
      for (const k of Object.keys(obj)) collectPointers(obj[k], path.concat([k]), out);
    }
  }
}

let failures = 0;
for (let it = 0; it < ITERATIONS; it++) {
  const rng = makeRng(it + 1);
  const obj = randVal(rng, 0);
  const text = JSON.stringify(obj, null, (rng() > 0.5 ? 2 : 4));

  const ours = buildPositionMap(text);
  const root = jsonc.parseTree(text);

  const pointers = [];
  collectPointers(obj, [], pointers);

  for (const ptr of pointers) {
    if (!ours[ptr]) continue;
    const segments = ptr === '' ? [] : ptr.slice(1).split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
    const node = jsonc.findNodeAtLocation(root, segments);
    if (!node) continue;
    const refOffset = node.offset;
    // Map our line/col back to an offset
    const lines = text.split('\n');
    let off = 0;
    for (let i = 0; i < ours[ptr].line - 1; i++) off += lines[i].length + 1;
    off += ours[ptr].col - 1;
    if (off !== refOffset) {
      failures++;
      if (failures <= 5) {
        console.error(`fuzz iter ${it} ptr=${ptr} ours=${off} ref=${refOffset} text=${JSON.stringify(text)}`);
      }
    }
  }
}

assert.strictEqual(failures, 0, `${failures} position mismatches across ${ITERATIONS} iterations`);
console.log(`ok: ${ITERATIONS} fuzz iterations passed`);
