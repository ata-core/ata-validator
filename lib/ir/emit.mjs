// IR backend: JavaScript source. It knows the IR operations
// (README.md) and nothing about JSON Schema; a leaf kernel's check is written
// from the kernel's own source (or a build-time fast path held to it).

import { TYPES } from '../kernels/kernels.mjs'
import { front } from './front.mjs'
import * as KERNELS from '../kernels/index.mjs'

// The names a module may import: exactly the exports of ata-validator/kernels.
const KERNEL_NAMES = new Set(Object.keys(KERNELS))
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const { compilePatternInline, FORMAT_CODEGEN } = createRequire(import.meta.url)('../js-compiler.js')._internal
// The format hints of lib/suggestions.js, read from its source at build time
// so the run-time module exports nothing more: the object literal assigned to
// FORMAT_HINTS, evaluated here. The format suites compare every suggestion,
// so a change to that file's shape fails them rather than going unnoticed.
const FORMAT_HINTS = (() => {
  const src = readFileSync(fileURLToPath(new URL('../suggestions.js', import.meta.url)), 'utf8')
  const start = src.indexOf('const FORMAT_HINTS = {')
  const end = src.indexOf('\n};\n', start)
  if (start < 0 || end < 0) throw new Error('ir emit: FORMAT_HINTS not found in lib/suggestions.js')
  return new Function('return ' + src.slice(start + 'const FORMAT_HINTS = '.length, end + 2))()
})()
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

export function emitIR (ir, { from = 'ata-validator/kernels', verdict = false, fill = null, richErrors = true } = {}) {
  // richErrors false: the current engine's plain shape (keyword, instancePath,
  // schemaPath, params, message), no enrichment, no related links.
  const plain = richErrors === false
  const uses = new Set(richErrors === false ? [] : ['E'])
  const consts = []
  const constOf = (src) => { const name = 'K' + consts.length; consts.push(`const ${name}=${src}`); return name }
  const emitted = new Map()
  const fns = []
  const use = (...n) => { for (const x of n) if (x) uses.add(x) }
  const ident = (src) => { for (const m of src.matchAll(/[A-Za-z_$][\w$]*/g)) use(m[0]); return src }

  // Formats: the current engine's generated check (FORMAT_CODEGEN), wrapped
  // in a function per format; the helpers it hoists are written once.
  const fctx = { preamble: [] }
  const hintFns = new Map()
  const fmtFns = new Map()
  const formatFn = (name) => {
    if (fmtFns.has(name)) return fmtFns.get(name)
    const gen = FORMAT_CODEGEN[name]
    if (!gen) throw new Error(`ir emit: no generated check for format "${name}"`)
    const fn = 'F' + fmtFns.size
    fmtFns.set(name, fn)
    const src = gen('s', true, fctx)
    consts.push(`function ${fn}(s){${src};return true}`)
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
    const fn = procName(n.proc)
    let target = fn
    if (n.dynamic) { const table = constOf(`new Map([${n.dynamic.map(([b, id]) => `[${lit(b)},${procName(id)}]`).join(',')}])`); target = `pick(${table},${fn})` }
    return `${target}(${expr(n.x)},${eArg},s,${n.path ? expr(n.path) : '""'},${n.ev ? expr(n.ev) : expr(n.x)},${n.sp ? expr(n.sp) : '""'},${aArg})`
  }

  function stmt (n, v) {
    switch (n.t) {
      case 'seq': return n.body.map((x) => stmt(x, v)).join('')
      case 'if': {
        // A condition that is a call under annotations merges its collector.
        if (n.c.t === 'pcall' && n.c.ann === 'merge') {
          use('newAnn', 'mergeAnn')
          return `{const a=newAnn();if(${callOf(n.c, 'null', 'a')}){mergeAnn(A,a)\n${stmt(n.then, v)}}else{\n${n.else ? stmt(n.else, v) : ''}}}\n`
        }
        return `if(${expr(n.c)}){\n${stmt(n.then, v)}}${n.else ? `else{\n${stmt(n.else, v)}}` : ''}\n`
      }
      case 'let': return `{const ${n.name}=${expr(n.value)}\n${stmt(n.body, v)}}\n`
      case 'bind': return `const ${n.names.map(([k, e]) => `${k}=${expr(e)}`).join(',')}\n`
      case 'keys': {
        if (n.order === 'forin') return `for(const ${n.k} in ${expr(n.obj)}){\n${stmt(n.body, v)}}\n`
        if (n.order === 'protoLast') use('keysOf')
        return `for(const ${n.k} of ${n.order === 'protoLast' ? 'keysOf' : 'Object.keys'}(${expr(n.obj)})){\n${stmt(n.body, v)}}\n`
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
        use('own', 'setOwn')
        const val = n.v
        let src
        if (typeof val !== 'object' || val === null) src = lit(val)
        else if (Array.isArray(val) && val.length === 0) src = '[]'
        else { use('copyOf'); src = `copyOf(${constOf(lit(val))})` }
        const o = expr(n.o)
        return `if(!own(${o},${lit(n.k)}))setOwn(${o},${lit(n.k)},${src})\n`
      }
      case 'fcall': return `${procName(n.proc)}(${expr(n.x)})\n`
    }
    throw new Error('ir emit: statement ' + n.t)
  }

  function branches (n, v) {
    const isAny = n.kw === 'anyOf'
    const ps = n.procs.map(procName)
    const x = expr(n.x); const path = expr(n.path); const ev = expr(n.ev); const sps = n.sps.map(expr)
    if (v) {
      const calls = ps.map((p, i) => `${p}(${x},null,s,${path},${ev},${sps[i]},null)`)
      return `if(${isAny ? `!(${calls.join('||')})` : `(${calls.map((c) => `(${c}?1:0)`).join('+')})!==1`})return false\n`
    }
    use('collapse')
    const titles = constOf(lit(n.titles))
    const tgt = n.ann === 'onlyIfOne' ? 'h' : 'A'
    if (n.ann) use('newAnn', 'mergeAnn')
    const vcalls = ps.map((p, i) => n.ann
      ? `{const a=newAnn();if(${p}(${x},null,s,${path},${ev},${sps[i]},a)){c++;mergeAnn(${tgt},a)}}`
      : `if(${p}(${x},null,s,${path},${ev},${sps[i]},null)){c++${isAny ? ';break b' : ''}}`).join('')
    const ecalls = ps.map((p, i) => `(()=>{const be=[]${n.ann ? ',a=newAnn()' : ''};${p}(${x},be,s,${path},${ev},${sps[i]},${n.ann ? 'a' : 'null'});const ok=be.length===0;${n.ann ? `if(ok)mergeAnn(${tgt},a);` : ''}return{valid:ok,errors:be}})()`).join(',')
    const sp = expr(n.sp)
    return `{${n.ann === 'onlyIfOne' ? 'const h=newAnn();' : ''}if(e===null){let c=0;b:{${vcalls}}if(${isAny ? 'c===0' : 'c!==1'})return false${n.ann === 'onlyIfOne' ? ';mergeAnn(A,h)' : ''}}else{const r=collapse(${lit(n.kw)},[${ecalls}],${path},${sp},null,${titles});if(r!==null)e.push(${plain ? 'r' : `E(r.code,${lit(n.kw)},${path},${sp},r.params,r.message,void 0,${n.rank},${ev},s,void 0,void 0,r.branchErrors)`})${n.ann === 'onlyIfOne' ? ';else mergeAnn(A,h)' : ''}}}\n`
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
        use('isTypes'); return `isTypes(${x},${lit(n.types)})`
      }
      case 'guard': return GUARD[n.g](expr(n.x))
      case 'kernel': {
        const x = expr(n.x)
        if (n.kw === 'format') return `${formatFn(n.n)}(${x})`
        const fast = FAST[n.kw] ? FAST[n.kw](n.n, x) : null
        const src = fast ? `(${fast})` : inline(n.K.ok, x, pvExpr(n))
        for (const id of ['cpLen', 'deq']) if (src.includes(id + '(')) use(id)
        return src
      }
      case 'kfail': use(n.K.fail.name); return `${n.K.fail.name}(${expr(n.x)},${pvExpr(n)})`
      case 'known': {
        const k = expr(n.k)
        const names = n.names.length <= 8 ? n.names.map((q) => `${k}===${lit(q)}`) : (n.names.length ? [`${constOf(`new Set(${lit(n.names)})`)}.has(${k})`] : [])
        const pats = n.pats.map((p) => `${constOf(`new RegExp(${lit(p)},"u")`)}.test(${k})`)
        const all = [...names, ...pats]
        return all.length ? `(${all.join('||')})` : 'false'
      }
      case 're': return `${constOf(`new RegExp(${lit(n.src)},"u")`)}.test(${expr(n.k)})`
      case 'seg': use('seg'); return `seg(${expr(n.k)})`
      case 'cat': return `${expr(n.a)}+${expr(n.b)}`
      case 'str': return n.parts.map(expr).join('+')
      case 'obj': return `{${n.fields.map(([k, v]) => `${JSON.stringify(k)}:${expr(v)}`).join(',')}}`
      case 'annKey': return `A.p.add(${expr(n.k)})`
      case 'annHasKey': return `A.p.has(${expr(n.k)})`
      case 'annPrefix': return `A.n=Math.max(A.n,Math.min(${n.n},${expr(n.arr)}.length))`
      case 'annAll': return 'A.all=true'
      case 'annAllSet': return 'A.all'
      case 'annAt': return `A.at.add(${expr(n.i)})`
      case 'annAtHas': return `A.at.has(${expr(n.i)})`
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
  const names = [...uses].filter((u) => KERNEL_NAMES.has(u)).sort()
  const imports = names.length ? `import {${names.join(',')}} from ${JSON.stringify(from)}` : ''
  return `${imports}
const PN=({}).__proto__===Object.prototype
${ir.dynamic ? `let SC=null
function pick(T,f){const a=[];for(let c=SC;c!==null;c=c.up)a.push(c.b);for(let i=a.length-1;i>=0;i--){const g=T.get(a[i]);if(g!==undefined)return g}return f}` : ''}
${fctx.preamble.join('\n')}
${consts.join('\n')}
${fns.join('\n')}
const NONE=Object.freeze([])
export function isValid(d){${pre}return ${ver || dual}(d,null,true,"",d,"#",null)}
export function validate(d){${pre}if(${ver || dual}(d,null,true,"",d,"#",null))return{valid:true,data:d,errors:NONE};const e=[];${dual}(d,e,!(!d&&d!==0&&d!==false),"",d,"#",null);return{valid:false,errors:${ir.relate && !plain ? 'e.length>1?relate(e):e' : 'e'}}}
`
}

export function specialize (schema, opts = {}) {
  const ir = front(schema, { assertFormat: opts.assertFormat !== false, schemas: opts.schemas || null, metaschemas: opts.metaschemas || null })
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

// Compile to a module and load it (tests and the differential): written to
// a temporary directory, importing the kernels by file URL.
export async function compile (schema, opts = {}) {
  const { writeFileSync, mkdtempSync } = await import('node:fs')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { fileURLToPath, pathToFileURL } = await import('node:url')
  const kernels = pathToFileURL(fileURLToPath(new URL('../kernels/index.mjs', import.meta.url))).href
  const dir = compile.dir || (compile.dir = mkdtempSync(join(tmpdir(), 'ata-ir-')))
  const file = join(dir, 'm' + (++compile.n) + '.mjs')
  writeFileSync(file, specialize(schema, { from: kernels, verdict: opts.verdict === true, assertFormat: opts.assertFormat !== false, useDefaults: opts.useDefaults, schemas: opts.schemas, metaschemas: opts.metaschemas, richErrors: opts.richErrors }))
  return import(pathToFileURL(file).href)
}
compile.n = 0
