// Which backend makes the smallest browser bundle for a set of schemas: the
// module writer (./emit.mjs), plans (./table.mjs) or closures
// (./closures.mjs). One decision for the whole set, since each of the last
// two brings a runtime the set shares: a single form is smallest as a
// written module, several are smaller behind one runtime.
//
// The caller gives the measure, `size(text)`, the gzipped length of a text
// (node:zlib where there is one; this file loads where there is none). What
// can be measured without a bundler is the sources: a backend is taken when
// its sources are smaller than the written modules by more than its runtime
// costs a bundle. The costs are set so that the choice was never the larger
// bundle on the builds they were measured on (tests/test_ir_pick.mjs bundles
// a few and holds that): a set near the line stays on written modules.
//
// A schema a backend does not take is written as a module beside the others;
// one the module writer refuses is null, for the caller to handle as before.
import { specialize } from './emit.mjs'
import { tableModule } from './table.mjs'
import { closureModule } from './closures.mjs'

// What a backend's runtime costs a bundle, in the measure this file has:
// the gzipped sources of the written modules minus those of the backend's.
// Measured on 142 sets of 1 to 7 generated forms, each bundled both ways
// (minified, gzipped): written modules were the smaller bundle only where
// that difference was under 2665 bytes for closures (plain errors), 2340 for
// plans with plain errors and 2653 with rich ones, and above the costs below
// the backend's bundle was the smaller one every time. Under them some sets
// would have been smaller too (about one in ten for closures, one in four
// for plans): those stay written modules, which are faster to check.
export const TABLE_COST = 2800
export const CLOSURE_COST = 2800

// options: what the backends take (richErrors, useDefaults, assertFormat).
// moduleOptions: more for the module writer alone (verdict, fillSource).
// Returns { backend: 'module' | 'table' | 'closures', sources, saving }:
// sources[i] is { kind, source } for schemas[i], or null where the module
// writer refuses it; saving is what the choice measured, in bytes.
export function pickModules (schemas, options = {}, size, moduleOptions = {}) {
  const mods = schemas.map((s) => { try { return specialize(s, { ...options, ...moduleOptions }) } catch { return null } })
  const out = (backend, alt, saving) => ({ backend, saving, sources: mods.map((m, i) => m === null ? null : alt && alt[i] ? { kind: backend, source: alt[i] } : { kind: 'module', source: m }) })
  const write = (f) => mods.map((m, i) => { if (m === null) return null; try { return f(schemas[i], options) } catch { return null } })
  const join = (list) => list.filter((x) => x !== null).join('\n')
  const base = size(join(mods))
  const saved = (alt) => alt.some((x) => x !== null) ? base - size(join(mods.map((m, i) => alt[i] || m))) : 0
  const closures = write(closureModule)
  const c = saved(closures)
  // Closures before plans where both pay: they check a form in about a third
  // of the time, and were the smaller bundle or within 170 bytes of it.
  if (c > CLOSURE_COST) return out('closures', closures, c)
  const plans = write(tableModule)
  const t = saved(plans)
  if (t > TABLE_COST) return out('table', plans, t)
  return out('module', null, 0)
}
