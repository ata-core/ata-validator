'use strict';

// The targeted position map must answer exactly what the full one would.
//
// `buildTargetedPositionMap` walks the same JSON grammar as
// `buildDataPositionMap` but skips subtrees that cannot hold a wanted pointer, so
// there are now two implementations of one thing. This holds them to identical
// output over random documents, including truncated and BOM-prefixed and CRLF
// ones, because the failure mode if they drift is a caret that quietly points
// somewhere else, or no caret at all.
//
// The cache layer is checked here too: a pointer the caller did not ask for must
// still resolve, by falling back to the full map, so a derivation that misses
// something costs time rather than a frame.

const assert = require('node:assert');
const { buildDataPositionMap, buildTargetedPositionMap } = require('../lib/data-positions');
const { createCache } = require('../lib/data-position-cache');

function makeRng (seed) {
  let s = seed | 0 || 1;
  return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; return ((s >>> 0) % 1e9) / 1e9 };
}

const KEYS = ['a', 'b', 'entries', 'nested', 'a/b', 'c~d', '', 'café', 'x\ty', '🚀', 'deep'];

function randVal (rng, depth) {
  const r = rng();
  if (depth > 3 || r < 0.45) {
    const k = (rng() * 5) | 0;
    if (k === 0) return (rng() * 1000) | 0;
    if (k === 1) return rng() > 0.5;
    if (k === 2) return null;
    if (k === 3) return rng() * 1e-7;
    return 'v' + ((rng() * 100) | 0);
  }
  if (r < 0.72) {
    const len = (rng() * 5) | 0;
    const arr = [];
    for (let i = 0; i < len; i++) arr.push(randVal(rng, depth + 1));
    return arr;
  }
  const len = (rng() * 5) | 0;
  const obj = {};
  for (let i = 0; i < len; i++) obj[KEYS[(rng() * KEYS.length) | 0]] = randVal(rng, depth + 1);
  return obj;
}

const ITERATIONS = process.env.TARGETED_POSITIONS_ITERATIONS
  ? Number(process.env.TARGETED_POSITIONS_ITERATIONS)
  : 600;

let docs = 0;
let entries = 0;
for (let seed = 1; seed <= ITERATIONS; seed++) {
  const rng = makeRng(seed);
  let text;
  try { text = JSON.stringify(randVal(rng, 0), null, rng() < 0.5 ? 2 : 0) } catch { continue }
  if (text === undefined) continue;

  const variants = [
    ['plain', text],
    ['truncated', text.slice(0, (rng() * text.length) | 0)],
    ['bom', '﻿' + text],
    ['crlf', text.replace(/\n/g, '\r\n')],
  ];

  for (const [label, t] of variants) {
    docs++;
    let full;
    try { full = buildDataPositionMap(t) } catch { continue } // both decline together, covered elsewhere
    const pointers = Object.keys(full);
    if (!pointers.length) continue;

    // First, last and one random pointer: the extremes are where an early exit
    // or a skipped subtree would go wrong.
    const wanted = new Set([pointers[0], pointers[pointers.length - 1], pointers[(rng() * pointers.length) | 0]]);
    const got = buildTargetedPositionMap(t, wanted);

    assert.deepStrictEqual(
      new Set(Object.keys(got)), wanted,
      `${label} seed ${seed}: wanted ${JSON.stringify([...wanted])}, got ${JSON.stringify(Object.keys(got))}`,
    );
    for (const p of wanted) {
      assert.strictEqual(
        JSON.stringify(got[p]), JSON.stringify(full[p]),
        `${label} seed ${seed}: entry ${JSON.stringify(p)}\n  full     ${JSON.stringify(full[p])}\n  targeted ${JSON.stringify(got[p])}`,
      );
      entries++;
    }

    // A pointer that is nowhere in the document is absent, not invented.
    assert.deepStrictEqual(Object.keys(buildTargetedPositionMap(t, new Set(['/nope/nowhere']))), []);
  }
}
console.log(`ok: targeted positions agree with the full map (${docs} documents, ${entries} entries)`);

// --- the cache answers a pointer the caller did not ask for ------------------
{
  const text = JSON.stringify({ a: { b: [1, 2, { c: 'deep' }] }, z: 'last' }, null, 2);
  const full = buildDataPositionMap(text);
  const cache = createCache();
  const positions = cache.targeted(text, new Set(['/a']));

  assert.deepStrictEqual(JSON.stringify(positions['/a']), JSON.stringify(full['/a']), 'the asked-for pointer');
  // Not in the wanted set: the cache must fall back rather than report nothing.
  assert.deepStrictEqual(JSON.stringify(positions['/z']), JSON.stringify(full['/z']), 'an unasked pointer still resolves');
  assert.deepStrictEqual(JSON.stringify(positions['/a/b/2/c']), JSON.stringify(full['/a/b/2/c']), 'a deep unasked pointer too');
  assert.strictEqual(positions['/not/here'], undefined, 'a pointer in no document is undefined');
  assert.ok('/z' in positions, 'the has trap agrees with the get trap');

  // Asked for but genuinely absent stays absent, without building anything.
  const p2 = createCache().targeted(text, new Set(['/missing']));
  assert.strictEqual(p2['/missing'], undefined, 'asked for and absent is undefined');

  console.log('ok: the cache falls back for pointers outside the wanted set');
}
