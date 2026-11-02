// IR backend: JavaScript source. It knows the IR operations
// (README.md) and nothing about JSON Schema; a leaf kernel's check is written
// from the kernel's own source (or a build-time fast path held to it).

import { TYPES } from '../kernels/kernels.mjs'
import { front, orderSkeleton, needsOrder } from './front.mjs'
import * as KERNELS from '../kernels/index.mjs'

// The names a module may import: exactly the exports of ata-validator/kernels.
const KERNEL_NAMES = new Set(Object.keys(KERNELS))
// The pattern unrolling of the code generator and the format hints of
// lib/suggestions.js, as a generated copy (scripts/gen-ir-emit-deps.js), so
// this file loads where neither the code generator nor the file system is.
import { compilePatternInline, FORMAT_HINTS } from './emit-deps.mjs'
const FAST = {
  pattern: (n, x) => compilePatternInline(n, x),
  // A string has between length/2 and length code points, so the length
  // alone settles most cases and the count runs only near the bound.
  minLength: (n, x) => `${x}.length>=${2 * n}||${x}.length>=${n}&&cpLen(${x})>=${n}`,
  maxLength: (n, x) => `${x}.length<=${n}||${x}.length<=${2 * n}&&cpLen(${x})<=${n}`,
}
// enum and const with only primitive values need no deep equality: the
// value is one of them exactly when it is === one of them (JSON numbers have
// no NaN, and 0 and -0 are one value to JSON equality too).
const prim = (v) => v === null || typeof v !== 'object'
FAST.enum = (n, x) => Array.isArray(n) && n.every(prim) ? (n.length ? n.map((v) => `${x}===${JSON.stringify(v)}`).join('||') : 'false') : null
FAST.const = (n, x) => prim(n) ? `${x}===${JSON.stringify(n)}` : null
const GUARD = {
  isStr: (x) => `typeof ${x}==="string"`,
  isNum: (x) => `typeof ${x}==="number"`,
  isArr: (x) => `Array.isArray(${x})`,
  isObjV: (x) => `(typeof ${x}==="object"&&${x}!==null&&!Array.isArray(${x}))`,
  isAny: () => 'true',
}
const lit = (v) => v === undefined ? 'void 0' : JSON.stringify(v)

// The body of a one-expression arrow `(v, n) => body` or `(v) => body`, with
// v and n replaced: the kernel's own source, specialized to the schema value.
function inline (fn, vExpr, nExpr) {
  const src = fn.toString()
  const m = /^\(\s*v\s*(?:,\s*n\s*)?\)\s*=>\s*([\s\S]+)$/.exec(src)
  if (!m) throw new Error('ir: kernel ok() must be (v, n) => expression: ' + src)
  return '(' + m[1].replace(/\bv\b/g, vExpr).replace(/\bn\b/g, nExpr) + ')'
}

// How many names an object must list before a module visits the object's own
// names instead of looking each one up.
const WALK_MIN = 16
// Source characters past which a verdict body is its own function (the
// verdict threshold of the current engine's generator, SPLIT_PROP_SCHEMA).
const SPLIT_MIN = 2000
// Entries a verdict's walk looks up in a table rather than a switch. A call
// through the table is indirect, so V8 does not inline a small check behind
// it: when most entries call a function of INLINE_MAX characters or fewer,
// the switch's direct calls win below 64 entries (mocharc 650 to 229 ns,
// huskyrc 290 to 149, targets about 90 characters). With larger targets
// there is nothing to inline and the table stays from WALK_MIN entries
// (abc-supply-plan, targets of 230 characters and more, 8-16% slower as a
// switch).
const TABLE_MIN = 64
const INLINE_MAX = 160
// A verdict that visits an object's names moves even small entries out when
// they would add up past this many characters, and otherwise only the ones of
// SPLIT_SMALL characters or more (the current engine's SPLIT_FN_BUDGET and
// SPLIT_PROP_SMALL).
const SPLIT_BUDGET = 24 * 1024
const SPLIT_SMALL = 220

export function emitIR (ir, { from = 'ata-validator/kernels', verdict = false, fill = null, richErrors = true } = {}) {
  // richErrors false: the current engine's plain shape (keyword, instancePath,
  // schemaPath, params, message), no enrichment, no related links.
  const plain = richErrors === false
  // Set when an object's names are visited in the object's order (`props`).
  let WALKED = false
  const uses = new Set(richErrors === false ? [] : ['E'])
  const consts = []
  const constOf = (src) => { const name = 'K' + consts.length; consts.push(`const ${name}=${src}`); return name }
  const emitted = new Map()
  const fns = []
  const use = (...n) => { for (const x of n) if (x) uses.add(x) }
  const ident = (src) => { for (const m of src.matchAll(/[A-Za-z_$][\w$]*/g)) use(m[0]); return src }

  const hintFns = new Map()
  const enumSets = new Map()
  const knownFns = new Map()
  // Each emitted function's body size, for the choice between a switch of
  // direct calls and a table (a procedure still being written has none).
  const sizes = new Map()
  // Imported from ata-validator/kernels (lib/kernels/formats.mjs, the same
  // generated checks), so a page with several modules carries each once.
  const formatFn = (name) => {
    const fn = 'fmt_' + name.replace(/-/g, '_')
    if (!KERNEL_NAMES.has(fn)) throw new Error(`ir emit: no generated check for format "${name}"`)
    use(fn)
    return fn
  }
  const procName = (id) => {
    if (emitted.has(id)) return emitted.get(id)
    const p = ir.procs.get(id)
    const name = id
    emitted.set(id, name)
    const isVerdict = p.mode === 'verdict'
    if (p.mode === 'fill') { fns.push(`function ${name}(d){\n${stmt(p.body, true)}}`); return name }
    const body = stmt(p.body, isVerdict)
    const head = p.mode === 'ann' ? 'if(A===null)A=newAnn()\n' : ''
    if (p.mode === 'ann') use('newAnn')
    const wrapped = ir.dynamic
      ? `const sv=SC;if(SC===null||SC.b!==${lit(p.base)})SC={b:${lit(p.base)},up:SC};try{\n${body}return true}finally{SC=sv}`
      : `${body}return true`
    fns.push(`function ${name}(d,e,s,P,V,SP,A){${head}${wrapped}}`)
    sizes.set(name, wrapped.length)
    return name
  }

  // A failure: `return false` in a verdict, a pushed error otherwise.
  const fail = (er, v) => {
    if (v) return 'return false'
    if (plain) return `{if(e===null)return false;e.push({keyword:${lit(er.kw)},instancePath:${expr(er.path)},schemaPath:${expr(er.sp)},params:${expr(er.params)},message:${expr(er.msg)}})}`
    let detail = 'void 0'; let suggest = 'void 0'
    // A kernel function generated code names must have a name to import.
    if ((er.detail && !er.detail.src) || (er.suggest && !er.suggest.src)) throw new Error(`ir emit: an unnamed enrichment function for ${er.kw}`)
    if (er.detail) detail = ident(er.detail.src)
    // A format's suggestion: only that format's hint, from the current
    // engine's table (lib/suggestions.js FORMAT_HINTS), written in as source.
    if (er.suggest && er.suggest.src === 'formatSuggest') {
      const f = er.params.fields.find(([k]) => k === 'format')[1].v
      const hint = FORMAT_HINTS[f]
      suggest = hint ? (hintFns.get(f) || (hintFns.set(f, constOf(`(v)=>{const t=(${hint.toString()})(v);return t?{text:t,kind:"format"}:null}`)), hintFns.get(f))) : 'void 0'
    } else if (er.suggest) suggest = /\(/.test(er.suggest.src) ? (ident(er.suggest.src), constOf(er.suggest.src)) : ident(er.suggest.src)
    return `{if(e===null)return false;e.push(E(${lit(er.code)},${lit(er.kw)},${expr(er.path)},${expr(er.sp)},${expr(er.params)},${expr(er.msg)},${lit(er.exp)},${er.rank},${expr(er.ev)},s,${detail},${suggest}))}`
  }

  // A procedure call: its arguments, its target (a dynamic pick or fixed).
  const callOf = (n, eArg, aArg) => {
    if (n.proc === null) throw new Error('ir: a v1 $dynamicRef with no target of its own needs the closure backend')
    const fn = procName(n.proc)
    let target = fn
    if (n.dynamic) { const table = constOf(`new Map([${n.dynamic.map(([b, id]) => `[${lit(b)},${procName(id)}]`).join(',')}])`); target = `pick(${table},${fn})` }
    // A call that gathers no errors never reads its paths (custom keywords,
    // the one reader that could, are refused by this writer): no strings to build.
    const quiet = eArg === 'null'
    return `${target}(${expr(n.x)},${eArg},s,${n.path && !quiet ? expr(n.path) : '""'},${n.ev ? expr(n.ev) : expr(n.x)},${n.sp && !quiet ? expr(n.sp) : '""'},${aArg})`
  }

  // A verdict statement as a function of `name`, called the way a procedure
  // is (value, e, s): it leaves only by `return false`.
  const hoist = (node, name, text = stmt(node, true)) => {
    const fn = 'L' + fns.length
    fns.push(`function ${fn}(${name},e,s){\n${text}return true}`)
    sizes.set(fn, text.length)
    return fn
  }

  // Whether a statement reads no name but `name` and the ones it declares,
  // and nothing of annotations (the caller's collector).
  const selfContained = (n, name) => {
    const bound = new Set([name]); const used = []; let ann = false
    const walk = (x) => {
      if (x === null || typeof x !== 'object') return
      if (Array.isArray(x)) { for (const y of x) walk(y); return }
      if (typeof x.t === 'string') {
        if (x.t === 'var' || x.t === 'incr') used.push(x.n ?? x.name)
        else if (x.t === 'let' || x.t === 'count') bound.add(x.name)
        else if (x.t === 'keys') bound.add(x.k)
        else if (x.t === 'range') bound.add(x.i)
        else if (x.t === 'bind') for (const [k] of x.names) bound.add(k)
        if (x.t.startsWith('ann') || x.t === 'firstUneval' || x.ann) ann = true
      }
      for (const k in x) if (k !== 'proc' && k !== 'K') walk(x[k])
    }
    walk(n)
    return !ann && used.every((u) => bound.has(u))
  }

  // A keyed entry that reads its value and, when present, requires one
  // procedure of it gathering nothing: the call, or null.
  const verdictCall = (n) => {
    if (n.t !== 'let' || n.body.t !== 'if' || n.body.else) return null
    let b = n.body.then
    while (b.t === 'seq' && b.body.length === 1) b = b.body[0]
    if (b.t !== 'require') return null
    const c = b.e
    return c.t === 'pcall' && (c.e === 'null' || c.e === 'inherit') && !c.ann && !c.dynamic && c.x.t === 'var' && c.x.n === n.name ? c : null
  }


  // A default's value as source: a literal, a fresh empty array, or a copy.
  const defaultSrc = (val) => {
    if (typeof val !== 'object' || val === null) return lit(val)
    if (Array.isArray(val) && val.length === 0) return '[]'
    use('copyOf'); return `copyOf(${constOf(lit(val))})`
  }

  function stmt (n, v) {
    switch (n.t) {
      case 'seq': return n.body.map((x) => stmt(x, v)).join('')
      // An object that lists many names: visit the object's own names, every
      // one enumerable or not (an entry checks its own presence, so a name it
      // skips is one the object lacks), instead of looking each listed name
      // up. Errors then come in the object's key order, so the module sorts
      // them into schema order as the current engine does (WALKED).
      case 'props': {
        if (n.keyed === null || n.keyed.length < WALK_MIN) return n.body.map((x) => stmt(x, v)).join('')
        WALKED = true
        const keyed = new Set(n.keyed.map(([, i]) => i))
        const always = n.body.filter((_, i) => !keyed.has(i)).map((x) => stmt(x, v)).join('')
        // In a verdict, the entries that only call a procedure on their value
        // go in a table by name: one lookup per key instead of a comparison
        // per listed name. An entry whose checks read only its value can move
        // into a function of its own and go in the table too: a large one
        // always, a small one when the names together would make a function
        // too large for V8 to optimize (a call costs more than a short check).
        const X = expr(n.x)
        const rows = n.keyed.map(([p, i]) => {
          const e = n.body[i]
          const c = v ? verdictCall(e) : null
          if (c !== null) return { p, fn: procName(c.proc) }
          if (v && e.t === 'let' && e.body.t === 'if' && !e.body.else && selfContained(e.body.then, e.name)) {
            const text = stmt(e.body.then, true)
            return { p, e, text, src: `{const ${e.name}=${expr(e.value)}\nif(${expr(e.body.c)}){\n${text}}}\n` }
          }
          return { p, src: stmt(e, v) }
        })
        const big = rows.reduce((t, r) => t + (r.src ? r.src.length : 0), 0) > SPLIT_BUDGET
        for (const r of rows) if (r.text !== undefined && (big || r.text.length >= SPLIT_SMALL)) r.fn = hoist(r.e.body.then, r.e.name, r.text)
        const tabled = rows.filter((r) => r.fn)
        const small = tabled.filter((r) => (sizes.get(r.fn) ?? Infinity) <= INLINE_MAX).length
        const useTable = tabled.length >= TABLE_MIN || (tabled.length >= WALK_MIN && small * 2 < tabled.length)
        const left = rows.filter((r) => !useTable || !r.fn)
        const body = (r) => r.fn ? `{const y=${X}[${lit(r.p)}];if(y!==void 0&&!${r.fn}(y,null,s,"",y,"",null))return false}\n` : r.src
        // A key is told from the names by its length first, a switch on an
        // integer the engine makes a jump table, and then compared with the
        // few names of that length: a switch on the names compared each key
        // with half of them, which lost to a lookup per name once an object
        // carried most of fifty (htmlhint).
        const byLen = new Map()
        for (const r of left) { const l = r.p.length; if (!byLen.has(l)) byLen.set(l, []); byLen.get(l).push(r) }
        const dispatch = (k) => `switch(${k}.length){\n${[...byLen].map(([l, rs]) => `case ${l}:${rs.map((r) => `if(${k}===${lit(r.p)}){\n${body(r)}}`).join('else ')}break\n`).join('')}}`
        if (!useTable) return `${always}{const ks=Object.getOwnPropertyNames(${X});for(let j=0;j<ks.length;j++){const k=ks[j];${dispatch('k')}}}\n`
        const T = constOf(`new Map([${tabled.map((r) => `[${lit(r.p)},${r.fn}]`).join(',')}])`)
        return `${always}{const ks=Object.getOwnPropertyNames(${X});for(let j=0;j<ks.length;j++){const k=ks[j],f=${T}.get(k);if(f!==void 0){const y=${X}[k];if(y!==void 0&&!f(y,null,s,"",y,"",null))return false}${left.length ? `else ${dispatch('k')}` : ''}}}\n`
      }
      case 'if': {
        // A condition that is a call under annotations merges its collector.
        if (n.c.t === 'pcall' && n.c.ann === 'merge') {
          use('newAnn', 'mergeAnn')
          return `{const a=newAnn();if(${callOf(n.c, 'null', 'a')}){mergeAnn(A,a)\n${stmt(n.then, v)}}else{\n${n.else ? stmt(n.else, v) : ''}}}\n`
        }
        return `if(${expr(n.c)}){\n${stmt(n.then, v)}}${n.else ? `else{\n${stmt(n.else, v)}}` : ''}\n`
      }
      case 'let': {
        // A large verdict body becomes a function of its value: V8 does not
        // optimize a function past its bytecode limit, and a schema inlined
        // whole into one can pass it. A verdict body leaves only by `return
        // false`, so the call keeps its meaning; what moves must read nothing
        // of the enclosing function but the value. A presence test in front
        // (it reads the parent) stays where it is.
        const guarded = n.body.t === 'if' && !n.body.else && !(n.body.c.t === 'pcall' && n.body.c.ann === 'merge')
        const inner = guarded ? n.body.then : n.body
        const text = stmt(inner, v)
        if (v && !ir.dynamic && text.length > SPLIT_MIN && selfContained(inner, n.name)) {
          const call = `if(!${hoist(inner, n.name, text)}(${n.name},null,s))return false\n`
          return `{const ${n.name}=${expr(n.value)}\n${guarded ? `if(${expr(n.body.c)}){\n${call}}\n` : call}}\n`
        }
        return `{const ${n.name}=${expr(n.value)}\n${guarded ? `if(${expr(n.body.c)}){\n${text}}\n` : text}}\n`
      }
      case 'bind': return `const ${n.names.map(([k, e]) => `${k}=${expr(e)}`).join(',')}\n`
      case 'keys': {
        if (n.order === 'forin') return `for(const ${n.k} in ${expr(n.obj)}){\n${stmt(n.body, v)}}\n`
        // A verdict stops at the first failure whatever the order, so it
        // needs no __proto__ moved last. (for-in with an own check, which
        // allocates no array, made a schema alone up to 3x faster but 13 of
        // SchemaStore's slower by 6-80% when all of them run in one process.)
        const last = n.order === 'protoLast' && !v
        if (last) use('keysOf')
        return `for(const ${n.k} of ${last ? 'keysOf' : 'Object.keys'}(${expr(n.obj)})){\n${stmt(n.body, v)}}\n`
      }
      case 'range': return `for(let ${n.i}=${typeof n.from === 'number' ? n.from : expr(n.from)};${n.i}<${expr(n.arr)}.length;${n.i}++){\n${stmt(n.body, v)}}\n`
      case 'count': return `{let ${n.name}=0\n${stmt(n.body, v)}}\n`
      case 'incr': return `${n.name}++\n`
      case 'do': return `${expr(n.e)}\n`
      case 'ret': return 'return false\n'
      case 'require': {
        const c = n.e
        if (c.ann === 'merge') {
          use('newAnn', 'mergeAnn')
          return `{const a=newAnn(),c=e===null?0:e.length;if(${callOf(c, 'e', 'a')}&&(e===null||e.length===c))mergeAnn(A,a);else if(e===null)return false}\n`
        }
        if (c.e === 'inherit') return v ? `if(!${callOf(c, 'null', 'null')})return false\n` : `if(!${callOf(c, 'e', 'null')}&&e===null)return false\n`
        return `if(!${callOf(c, 'null', 'null')})${v ? 'return false' : '{if(e===null)return false}'}\n`
      }
      case 'fail': return fail(n.err, v) + '\n'
      case 'branches': return branches(n, v)
      case 'setDefault': {
        use('own')
        if (n.k === '__proto__') use('setOwn')
        const val = n.v
        let src
        if (typeof val !== 'object' || val === null) src = lit(val)
        else if (Array.isArray(val) && val.length === 0) src = '[]'
        else { use('copyOf'); src = `copyOf(${constOf(lit(val))})` }
        const o = expr(n.o)
        // A store under the name itself: through setOwn's computed key, V8
        // turned an object given more than a few defaults into a dictionary,
        // slow from then on for every reader (htmlhint's root, 23 defaults:
        // getOwnPropertyNames 10 to 999 ns). __proto__ needs defineProperty.
        if (n.k === '__proto__') return `if(!own(${o},${lit(n.k)}))setOwn(${o},${lit(n.k)},${src})\n`
        // A read or `in` before hasOwnProperty, as the current engine's fill
        // does, was measured both ways: faster where the defaults are mostly
        // present (jshintrc 1195 to 522 ns), slower where they are mostly
        // missing (prometheus 3671 to 4601). hasOwnProperty alone is kept.
        return `if(!own(${o},${lit(n.k)}))${o}[${lit(n.k)}]=${src}\n`
      }
      case 'fcall': return `${procName(n.proc)}(${expr(n.x)})\n`
      case 'defaultsMask': {
        // Bits in 32-bit words, set from the object's own names told apart by
        // length and then by name; a default is written where its bit is clear.
        const o = expr(n.o)
        const words = Math.ceil(n.entries.length / 32)
        const m = (i) => 'm' + Math.floor(i / 32)
        const byLen = new Map()
        n.entries.forEach(([k], i) => { if (!byLen.has(k.length)) byLen.set(k.length, []); byLen.get(k.length).push([k, i]) })
        const cases = [...byLen].map(([l, ks]) => `case ${l}:${ks.map(([k, i]) => `if(k===${lit(k)})${m(i)}|=${(1 << (i % 32)) >>> 0}`).join(';else ')};break\n`).join('')
        const sets = n.entries.map(([k, val], i) => `if((${m(i)}&${(1 << (i % 32)) >>> 0})===0)${o}[${lit(k)}]=${defaultSrc(val)}\n`).join('')
        return `{let ${[...Array(words)].map((_, w) => 'm' + w + '=0').join(',')}\nconst ks=Object.getOwnPropertyNames(${o});for(let j=0;j<ks.length;j++){const k=ks[j];switch(k.length){\n${cases}}}\n${sets}}\n`
      }
      // The object's own names, each looked up in a table of the fills of
      // the properties that have one (lib/ir/front.mjs fillProc).
      case 'fillWalk': {
        const o = expr(n.o)
        const T = constOf(`new Map([${n.entries.map(([k, id]) => `[${lit(k)},${procName(id)}]`).join(',')}])`)
        return `{const ks=Object.getOwnPropertyNames(${o});for(let j=0;j<ks.length;j++){const f=${T}.get(ks[j]);if(f!==void 0)f(${o}[ks[j]])}}\n`
      }
    }
    throw new Error('ir emit: statement ' + n.t)
  }

  function branches (n, v) {
    const isAny = n.kw === 'anyOf'
    const ps = n.procs.map(procName)
    // The calls that gather no errors get no paths (see callOf).
    const x = expr(n.x); const path = expr(n.path); const ev = expr(n.ev); const sps = n.sps.map(expr)
    if (v) {
      const calls = ps.map((p) => `${p}(${x},null,s,"",${ev},"",null)`)
      return `if(${isAny ? `!(${calls.join('||')})` : `(${calls.map((c) => `(${c}?1:0)`).join('+')})!==1`})return false\n`
    }
    use('collapse')
    const titles = constOf(lit(n.titles))
    const tgt = n.ann === 'onlyIfOne' ? 'h' : 'A'
    if (n.ann) use('newAnn', 'mergeAnn')
    const vcalls = ps.map((p, i) => n.ann
      ? `{const a=newAnn();if(${p}(${x},null,s,"",${ev},"",a)){c++;mergeAnn(${tgt},a)}}`
      : `if(${p}(${x},null,s,"",${ev},"",null)){c++${isAny ? ';break b' : ''}}`).join('')
    const ecalls = ps.map((p, i) => `(()=>{const be=[]${n.ann ? ',a=newAnn()' : ''};${p}(${x},be,s,${path},${ev},${sps[i]},${n.ann ? 'a' : 'null'});const ok=be.length===0;${n.ann ? `if(ok)mergeAnn(${tgt},a);` : ''}return{valid:ok,errors:be}})()`).join(',')
    const sp = expr(n.sp)
    // An anyOf with no annotations runs each branch once, filling a list of
    // its own, and stops at the first that passes: no branch runs twice,
    // whether the keyword passes or fails.
    if (isAny && !n.ann) {
      const tries = ps.map((p, i) => `{const be=[];${p}(${x},be,s,${path},${ev},${sps[i]},null);if(be.length===0){ok=true;break b}br.push({valid:false,errors:be})}`).join('')
      return `if(e===null){let c=0;b:{${vcalls}}if(c===0)return false}else{let ok=false;const br=[];b:{${tries}}if(!ok){const r=collapse(${lit(n.kw)},br,${path},${sp},null,${titles});if(r!==null)e.push(${plain ? 'r' : `E(r.code,${lit(n.kw)},${path},${sp},r.params,r.message,void 0,${n.rank},${ev},s,void 0,void 0,r.branchErrors)`})}}\n`
    }
    // Otherwise the verdict first, with or without a list to fill: the branches' errors
    // are built only when the keyword fails (collapse answers null exactly
    // when it passes). Building them for a passing anyOf under propertyNames
    // made a 257-key object 24x slower than the current engine. A failing
    // run calls the branches again, merging the same annotations twice,
    // which changes nothing.
    return `{${n.ann === 'onlyIfOne' ? 'const h=newAnn();' : ''}let c=0;b:{${vcalls}}if(${isAny ? 'c!==0' : 'c===1'}){${n.ann === 'onlyIfOne' ? 'mergeAnn(A,h)' : ''}}else if(e===null)return false;else{const r=collapse(${lit(n.kw)},[${ecalls}],${path},${sp},null,${titles});if(r!==null)e.push(${plain ? 'r' : `E(r.code,${lit(n.kw)},${path},${sp},r.params,r.message,void 0,${n.rank},${ev},s,void 0,void 0,r.branchErrors)`})}}\n`
  }

  function pvExpr (n) {
    const pv = n.pv
    if (pv instanceof RegExp) return constOf(`new RegExp(${lit(pv.source)},${lit(pv.flags)})`)
    if (typeof pv === 'function') { use(pv.name); return pv.name }
    if (typeof pv === 'object' && pv !== null) return constOf(lit(pv))
    return lit(pv)
  }

  function expr (n) {
    switch (n.t) {
      case 'lit': return lit(n.v)
      case 'var': return n.n
      case 'get': return `${expr(n.o)}[${expr(n.k)}]`
      case 'field': return `${expr(n.o)}.${n.k}`
      case 'own': use('own'); return `own(${expr(n.o)},${expr(n.k)})`
      case 'not': return `!(${expr(n.e)})`
      case 'and': return `(${expr(n.a)}&&${expr(n.b)})`
      case 'or': return `(${expr(n.a)}||${expr(n.b)})`
      case 'cmp': return `${expr(n.a)}${n.op}${expr(n.b)}`
      case 'isObj': use('isObj'); return `isObj(${expr(n.x)})`
      case 'isArr': return `Array.isArray(${expr(n.x)})`
      case 'isObjAny': { const x = expr(n.x); return `(typeof ${x}==="object"&&${x}!==null)` }
      case 'len': return `${expr(n.x)}.length`
      case 'plainProto': { const x = expr(n.x); return `(PN?${x}.__proto__:Object.getPrototypeOf(${x}))===Object.prototype` }
      case 'type': {
        const x = expr(n.x)
        if (n.types.length === 1 && TYPES[n.types[0]]) return inline(TYPES[n.types[0]], x)
        // A union over a variable: each type's own predicate, joined, as
        // isTypes would try them; the table stays out of the module.
        if (/^[A-Za-z_$][\w$]*$/.test(x) && n.types.every((t) => TYPES[t])) return `(${n.types.map((t) => inline(TYPES[t], x)).join('||')})`
        use('isTypes'); return `isTypes(${x},${lit(n.types)})`
      }
      case 'guard': return GUARD[n.g](expr(n.x))
      case 'kernel': {
        const x = expr(n.x)
        if (n.kw === 'format') return `${formatFn(n.n)}(${x})`
        // 64 or more strings: a Set, one lookup instead of a chain that
        // grows with the list (the threshold and its measurements are
        // ENUM_SET_MIN in lib/js-compiler.js).
        if (n.kw === 'enum' && Array.isArray(n.n) && n.n.length >= 64 && n.n.every((v) => typeof v === 'string')) {
          const key = JSON.stringify(n.n)
          if (!enumSets.has(key)) enumSets.set(key, constOf(`new Set(${key})`))
          return `${enumSets.get(key)}.has(${x})`
        }
        const fast = FAST[n.kw] ? FAST[n.kw](n.n, x) : null
        const src = fast ? `(${fast})` : inline(n.K.ok, x, pvExpr(n))
        for (const id of ['cpLen', 'deq']) if (src.includes(id + '(')) use(id)
        return src
      }
      case 'kfail': use(n.K.fail.name); return `${n.K.fail.name}(${expr(n.x)},${pvExpr(n)})`
      case 'known': {
        const k = expr(n.k)
        // More than eight names: told apart by length first, a switch the
        // engine makes a jump table, then compared with the few of that
        // length, unless one length holds many (then a Set).
        let names
        if (n.names.length <= 8) names = n.names.map((q) => `${k}===${lit(q)}`)
        else {
          const byLen = new Map()
          for (const q of n.names) { if (!byLen.has(q.length)) byLen.set(q.length, []); byLen.get(q.length).push(q) }
          if (Math.max(...[...byLen.values()].map((a) => a.length)) <= 6) {
            const key = JSON.stringify(n.names)
            if (!knownFns.has(key)) knownFns.set(key, constOf(`(k)=>{switch(k.length){${[...byLen].map(([l, qs]) => `case ${l}:return ${qs.map((q) => `k===${lit(q)}`).join('||')}`).join(';')}}return false}`))
            names = [`${knownFns.get(key)}(${k})`]
          } else names = [`${constOf(`new Set(${lit(n.names)})`)}.has(${k})`]
        }
        const pats = n.pats.map((p) => `${constOf(`new RegExp(${lit(p)},"u")`)}.test(${k})`)
        const all = [...names, ...pats]
        return all.length ? `(${all.join('||')})` : 'false'
      }
      case 're': return `${constOf(`new RegExp(${lit(n.src)},"u")`)}.test(${expr(n.k)})`
      case 'seg': use('seg'); return `seg(${expr(n.k)})`
      case 'cat': return `${expr(n.a)}+${expr(n.b)}`
      case 'str': return n.parts.map(expr).join('+')
      case 'obj': return `{${n.fields.map(([k, v]) => `${JSON.stringify(k)}:${expr(v)}`).join(',')}}`
      case 'annKey': return `(A.p===null?A.p=new Set():A.p).add(${expr(n.k)})`
      case 'annHasKey': return `(A.p!==null&&A.p.has(${expr(n.k)}))`
      case 'annPrefix': return `A.n=Math.max(A.n,Math.min(${n.n},${expr(n.arr)}.length))`
      case 'annAll': return 'A.all=true'
      case 'annAllSet': return 'A.all'
      case 'annAt': return `(A.at===null?A.at=new Set():A.at).add(${expr(n.i)})`
      case 'annAtHas': return `(A.at!==null&&A.at.has(${expr(n.i)}))`
      case 'annN': return 'A.n'
      case 'firstUneval': use('firstUneval'); return `firstUneval(A,${expr(n.x)})`
      case 'pcall': return callOf(n, n.e === 'inherit' ? 'e' : 'null', 'null')
    }
    throw new Error('ir emit: expression ' + n.t)
  }

  const fillName = fill ? procName(fill) : null
  const pre = fillName ? `${fillName}(d);` : ''
  const dual = procName(ir.dual)
  const ver = verdict ? procName(ir.verdict) : null
  if (ir.relate && !plain) use('relate')
  const sorts = WALKED || needsOrder(ir.schema)
  if (sorts) use('ordered')
  const names = [...uses].filter((u) => KERNEL_NAMES.has(u)).sort()
  const imports = names.length ? `import {${names.join(',')}} from ${JSON.stringify(from)}` : ''
  return `${imports}
const PN=({}).__proto__===Object.prototype
${ir.dynamic ? `let SC=null
function pick(T,f){const a=[];for(let c=SC;c!==null;c=c.up)a.push(c.b);for(let i=a.length-1;i>=0;i--){const g=T.get(a[i]);if(g!==undefined)return g}return f}` : ''}
${consts.join('\n')}
${fns.join('\n')}
const NONE=Object.freeze([])
${sorts ? `const SK=JSON.parse(${JSON.stringify(JSON.stringify(orderSkeleton(ir.schema)))})\n` : ''}export function isValid(d){${pre}return ${ver || dual}(d,null,true,"",d,"#",null)}
export function validate(d){${pre}if(${ver || dual}(d,null,true,"",d,"#",null))return{valid:true,data:d,errors:NONE};const e=[];${dual}(d,e,!(!d&&d!==0&&d!==false),"",d,"#",null);const o=${sorts ? 'ordered(SK,e)' : 'e'};return{valid:false,errors:${ir.relate && !plain ? 'o.length>1?relate(o):o' : 'o'}}}
`
}

export function specialize (schema, opts = {}) {
  // A module cannot carry the caller's functions.
  if (opts.formats && Object.values(opts.formats).some((f) => typeof f === 'function')) throw new Error('ir: custom formats need the closure backend')
  if (opts.keywords && Object.keys(opts.keywords).length) throw new Error('ir: custom keywords need the closure backend')
  // Options that change the document or the shape of the answer: a module
  // does not apply them, so it refuses them rather than answer without them.
  for (const k of ['coerceTypes', 'removeAdditional', 'verbose', 'abortEarly']) if (opts[k]) throw new Error(`ir: ${k} needs the closure backend`)
  const ir = front(schema, { assertFormat: opts.assertFormat !== false, schemas: opts.schemas || null, metaschemas: opts.metaschemas || null, baseURI: opts.baseURI || null })
  const wantFill = opts.useDefaults !== false && hasDefault(schema)
  // The specialized fill from the IR; the shared pass where it declined.
  const src = emitIR(ir, { ...opts, fill: wantFill && ir.fill && ir.fill !== 'generic' ? ir.fill : null })
  if (!wantFill || ir.fill !== 'generic') return src
  // The shared default pass (lib/defaults.js), built from the normalized
  // schema at load.
  return src
    .replace(/^import \{([^}]*)\} from /m, (m, list) => `import {${['buildDefaultsApplier', ...list.split(',')].filter(Boolean).sort().join(',')}} from `)
    .replace('export function isValid(d){return ', `const FILL=buildDefaultsApplier(${JSON.stringify(ir.schema)})\nexport function isValid(d){FILL(d);return `)
    .replace('export function validate(d){', 'export function validate(d){FILL(d);')
}

function hasDefault (s) {
  if (typeof s !== 'object' || s === null) return false
  if (Array.isArray(s)) return s.some(hasDefault)
  if ('default' in s) return true
  for (const k in s) if (hasDefault(s[k])) return true
  return false
}

// A module's text as the body of a function that takes the kernels object and
// returns { isValid, validate }: for a page that may evaluate code but loads
// no module from a string. The text is this file's own output, in which every
// value from the schema is written by JSON.stringify.
export function functionBody (src) {
  const m = /^import \{([^}]*)\} from "[^"\n]*"\n/.exec(src)
  const head = m ? `const {${m[1]}}=K\n` : ''
  return head + (m ? src.slice(m[0].length) : src).replace(/^export function /gm, 'function ') + 'return{isValid,validate}\n'
}
