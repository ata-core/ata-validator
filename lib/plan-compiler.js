'use strict';

// Compiles interpreter Plans into a tree of specialized closures. No source
// generation, no `new Function`: this is plain closure composition, so it
// runs wherever the interpreter runs, CSP included. The payoff over eval()
// is that every keyword branch is decided once at compile time and every
// child call is a direct monomorphic call, which is the same advantage the
// code generator has, minus the codegen.
//
// Everything eval() decides at run time from the schema path is decided
// here at compile time instead, because the schema path is static:
//   - the base URI in effect, so `$ref` targets resolve once;
//   - the dynamic scope, kept as the ordered list of resources entered so
//     far, so `$dynamicRef` targets resolve once too. eval() pushes a
//     resource every time the base changes, which can repeat entries; the
//     outermost-first anchor search gives the same answer on the list with
//     repeats removed, and that list is finite, so compilation terminates
//     on cyclic schemas;
//   - whether a node's annotations are read by anyone. A node under an
//     in-place applicator of a collecting node collects; one under a child
//     applicator (properties, items, not, ...) does not, exactly as eval()
//     hands those the discard sink;
//   - whether the schema can recurse at all. eval() guards every reference
//     against revisiting a (schema, data) pair; that guard can only fire
//     when the compiled graph has a cycle, which compilation notices, so an
//     acyclic schema compiles without the guard and without the stack.
// A `$ref` or `$dynamicRef` that does not resolve compiles into the same
// runtime rejection eval() produces, so nothing declines. Error output must
// be byte-for-byte what eval() produces; tests/test_plan_compiler.js diffs
// the two over the official suite.
//
// Compiled pairs: `c(data, errors, instancePath, schemaPath, stack[, rec])`
// collects errors and returns the verdict; `v(data, stack[, rec])` returns
// the verdict alone, with no path strings and no error objects, and returns
// on the first failure. `errors` may be the NOERRORS sentinel, in which case
// the collect variant also stops at the first failure.
//
// Annotations live in a record {props, n, x}: the property names evaluated
// so far, the count of items evaluated contiguously from index 0, and any
// further item indexes (from `contains`). A node that reads annotations
// (unevaluated*) owns a fresh record per call; every in-place child writes
// straight into the record it is handed. eval() keeps a failed child's
// annotations out of its parent by merging only on success; here the
// caller notes the record's lengths before a child that may fail without
// failing the caller, and truncates back on failure. Same result, no
// allocation per child.

function install(deps) {
  const { Plan, NOERRORS, err, evalLeaf, evalLeafV, dataBits, escapePointer,
          deepEqual, multipleOfOk, cpAtLeast, cpAtMost,
          T_STRING, T_ARRAY, T_OBJECT, resolveRef, splitFragment, resolveUri } = deps;

  const TRUE_FN = () => true;
  const TRUE_PAIR = { v: TRUE_FN, c: TRUE_FN };
  const FALSE_PAIR = {
    v: () => false,
    c: (data, errors, instancePath, schemaPath) => {
      if (errors !== NOERRORS) errors.push(err('false schema', 'not', instancePath, schemaPath, {}, 'boolean schema is false'));
      return false;
    },
  };

  // Static $dynamicRef target, mirroring the `$dynamicRef` branch of eval()
  // with the compile-time scope list in place of the runtime one.
  function dynTarget(interp, ref, base, chain) {
    const state = interp.state;
    let { node, base: refBase } = resolveRef(ref, base, state);
    const [, fragment] = splitFragment(resolveUri(base, ref));
    if (fragment && !fragment.startsWith('/')) {
      const initialDyn = state.dynamicAnchors.get(refBase);
      const bookended = node !== undefined && initialDyn && initialDyn.get(fragment) === node;
      if (bookended || !interp.bookending) {
        for (let i = 0; i < chain.length; i++) {
          const dyn = state.dynamicAnchors.get(chain[i]);
          if (dyn && dyn.has(fragment)) { node = dyn.get(fragment); refBase = chain[i]; break; }
        }
      }
    }
    return { node, base: refBase };
  }

  // ---- annotation records ----
  function fresh() { return { props: null, n: 0, x: null, keys: null }; }
  // Object.keys once per record: every node that shares a record sees the
  // same data object.
  function keysOf(rec, data) {
    if (rec.keys === null) rec.keys = Object.keys(data);
    return rec.keys;
  }
  function hasProp(rec, key) {
    const p = rec.props;
    if (p === null) return false;
    for (let i = 0; i < p.length; i++) if (p[i] === key) return true;
    return false;
  }
  function addProp(rec, key) {
    if (rec.props === null) rec.props = [key];
    else rec.props.push(key);
  }
  function hasItem(rec, i) {
    if (i < rec.n) return true;
    const x = rec.x;
    if (x === null) return false;
    for (let j = 0; j < x.length; j++) if (x[j] === i) return true;
    return false;
  }
  function addItem(rec, i) {
    if (i < rec.n) return;
    if (i === rec.n) { rec.n = i + 1; return; }
    if (rec.x === null) rec.x = [i];
    else rec.x.push(i);
  }
  function markRange(rec, from, to) {
    if (from >= to) return;
    if (from <= rec.n) { if (to > rec.n) rec.n = to; return; }
    if (rec.x === null) rec.x = [];
    for (let i = from; i < to; i++) rec.x.push(i);
  }
  function mergeRec(target, from) {
    if (from.props !== null) {
      if (target.props === null) target.props = from.props;
      else for (let i = 0; i < from.props.length; i++) target.props.push(from.props[i]);
    }
    if (from.n > target.n) target.n = from.n;
    if (from.x !== null) {
      if (target.x === null) target.x = from.x;
      else for (let i = 0; i < from.x.length; i++) target.x.push(from.x[i]);
    }
  }
  // Rollback marks: the two array lengths and the contiguous count.
  function pLen(rec) { return rec.props === null ? 0 : rec.props.length; }
  function xLen(rec) { return rec.x === null ? 0 : rec.x.length; }
  function undo(rec, pl, n0, xl) {
    if (rec.props !== null) rec.props.length = pl;
    rec.n = n0;
    if (rec.x !== null) rec.x.length = xl;
  }

  // The value-level keywords of one node, compiled. evalLeafV() answers the
  // same question by re-reading a dozen presence flags off the plan on every
  // call, which is work the schema already decided: a plan's keywords never
  // change. So each present keyword becomes one closure over its own operand
  // and the node keeps only those, in the same order evalLeafV() runs them.
  // Checks take (data, bits) because the type of the value is worth computing
  // once per node rather than once per keyword; `needsBits` stays false when
  // nothing in the node asks for it.
  function compileLeafV(P) {
    const checks = [];
    let needsBits = false;

    if (P.hasType) {
      const mask = P.typeMask;
      needsBits = true;
      checks.push((data, bits) => (bits & mask) !== 0);
    }
    if (P.enum !== null) {
      const vals = P.enum;
      if (vals.length === 0) checks.push(() => false);
      else checks.push((data) => {
        for (let i = 0; i < vals.length; i++) if (deepEqual(vals[i], data)) return true;
        return false;
      });
    }
    if (P.hasConst) {
      const c = P.const;
      checks.push((data) => deepEqual(c, data));
    }
    if (P.hasNumber) {
      const nums = [];
      if (P.minimum !== undefined) { const m = P.minimum; nums.push((d) => d >= m); }
      if (P.maximum !== undefined) { const m = P.maximum; nums.push((d) => d <= m); }
      if (P.exclusiveMinimum !== undefined) { const m = P.exclusiveMinimum; nums.push((d) => d > m); }
      if (P.exclusiveMaximum !== undefined) { const m = P.exclusiveMaximum; nums.push((d) => d < m); }
      if (P.multipleOf !== undefined) { const m = P.multipleOf; nums.push((d) => multipleOfOk(d, m)); }
      const run = combineValue(nums);
      if (run !== null) checks.push((data) => typeof data !== 'number' || run(data));
    }
    if (P.hasString) {
      const strs = [];
      if (P.minLength !== undefined) { const m = P.minLength; strs.push((d) => cpAtLeast(d, m)); }
      if (P.maxLength !== undefined) { const m = P.maxLength; strs.push((d) => cpAtMost(d, m)); }
      if (P.pattern !== null) { const re = P.pattern; strs.push((d) => re.test(d)); }
      if (P.formatFn !== null) { const f = P.formatFn; strs.push((d) => f(d)); }
      const run = combineValue(strs);
      if (run !== null) { needsBits = true; checks.push((data, bits) => bits !== T_STRING || run(data)); }
    }
    // `hasArray` also covers prefixItems/items/contains, which are not leaf
    // keywords; only the three value-level ones belong here, exactly as
    // evalLeafV() reads them.
    if (P.minItems !== undefined || P.maxItems !== undefined || P.uniqueItems) {
      const arrs = [];
      if (P.minItems !== undefined) { const m = P.minItems; arrs.push((d) => d.length >= m); }
      if (P.maxItems !== undefined) { const m = P.maxItems; arrs.push((d) => d.length <= m); }
      if (P.uniqueItems) {
        arrs.push((d) => {
          for (let i = 0; i < d.length; i++) {
            for (let j = i + 1; j < d.length; j++) if (deepEqual(d[i], d[j])) return false;
          }
          return true;
        });
      }
      const run = combineValue(arrs);
      if (run !== null) { needsBits = true; checks.push((data, bits) => bits !== T_ARRAY || run(data)); }
    }
    if (P.required !== null || P.minProperties !== undefined || P.maxProperties !== undefined || P.dependentRequired !== null) {
      const objs = [];
      if (P.required !== null) {
        const req = P.required;
        if (req.length === 1) { const k = req[0]; objs.push((d) => Object.hasOwn(d, k)); }
        else objs.push((d) => {
          for (let i = 0; i < req.length; i++) if (!Object.hasOwn(d, req[i])) return false;
          return true;
        });
      }
      if (P.minProperties !== undefined) { const m = P.minProperties; objs.push((d) => Object.keys(d).length >= m); }
      if (P.maxProperties !== undefined) { const m = P.maxProperties; objs.push((d) => Object.keys(d).length <= m); }
      if (P.dependentRequired !== null) {
        const entries = P.dependentRequired;
        objs.push((d) => {
          for (let i = 0; i < entries.length; i++) {
            const [key, deps] = entries[i];
            if (!Object.hasOwn(d, key)) continue;
            for (let j = 0; j < deps.length; j++) if (!Object.hasOwn(d, deps[j])) return false;
          }
          return true;
        });
      }
      const run = combineValue(objs);
      if (run !== null) { needsBits = true; checks.push((data, bits) => bits !== T_OBJECT || run(data)); }
    }

    if (checks.length === 0) return TRUE_FN;
    if (!needsBits) {
      if (checks.length === 1) { const a = checks[0]; return (data) => a(data, 0); }
      return (data) => {
        for (let i = 0; i < checks.length; i++) if (!checks[i](data, 0)) return false;
        return true;
      };
    }
    if (checks.length === 1) { const a = checks[0]; return (data) => a(data, dataBits(data)); }
    if (checks.length === 2) {
      const [a, b] = checks;
      return (data) => { const bits = dataBits(data); return a(data, bits) && b(data, bits); };
    }
    return (data) => {
      const bits = dataBits(data);
      for (let i = 0; i < checks.length; i++) if (!checks[i](data, bits)) return false;
      return true;
    };
  }

  // Folds a group's checks into one call, or null when the group is empty.
  function combineValue(fns) {
    if (fns.length === 0) return null;
    if (fns.length === 1) return fns[0];
    if (fns.length === 2) { const [a, b] = fns; return (d) => a(d) && b(d); }
    return (d) => {
      for (let i = 0; i < fns.length; i++) if (!fns[i](d)) return false;
      return true;
    };
  }

  function compileNode(ctx, node, base, chain, ann) {
    if (node === true) return TRUE_PAIR;
    if (node === false) return FALSE_PAIR;
    if (!(node instanceof Plan)) return TRUE_PAIR;
    const interp = ctx.interp;
    const P = node;
    if (P.nodeBase !== null && P.nodeBase !== base) base = P.nodeBase;
    if (chain.indexOf(base) === -1) chain = chain.concat(base);
    const collect = ann || P.hasUnevaluated;

    let perKey = ctx.memo.get(P);
    if (perKey === undefined) { perKey = new Map(); ctx.memo.set(P, perKey); }
    const key = (ann ? 'a ' : 'p ') + base + ' ' + chain.join(' ');
    const cached = perKey.get(key);
    if (cached !== undefined) {
      if (cached.open) ctx.cyclic = true;
      return cached;
    }
    // Cycles: register trampolines before compiling children.
    const box = { v: null, c: null };
    const pair = {
      open: true,
      v: (d, st, rec) => box.v(d, st, rec),
      c: (d, e, ip, sp, st, rec) => box.c(d, e, ip, sp, st, rec),
    };
    perKey.set(key, pair);

    // In-place children collect when this node does; child applicators
    // never do. `rec` is threaded as the trailing argument of every step
    // and is undefined on non-collecting nodes, where nothing reads it.
    const inPlace = (n, b) => compileNode(ctx, n, b, chain, collect);
    const child = (n) => compileNode(ctx, n, base, chain, false);

    const steps = [];   // collect variant: (data, errors, ip, sp, stack, rec)
    const vsteps = [];  // verdict variant: (data, stack, rec)

    // $ref / $dynamicRef, resolved at compile time.
    for (let which = 0; which < 2; which++) {
      let t, seg;
      if (which === 0) {
        if (P.ref === null) continue;
        t = resolveRef(P.ref, base, interp.state);
        seg = '/$ref';
      } else {
        if (P.dynamicRef === null) continue;
        t = dynTarget(interp, P.dynamicRef, base, chain);
        seg = '/$dynamicRef';
      }
      if (t.node === undefined) {
        // Reported when reached, exactly as eval() does; a metaschema-sized
        // tree with one dangling reference in a branch the data never
        // enters still compiles.
        const ref = which === 0 ? P.ref : P.dynamicRef;
        const kw = which === 0 ? '$ref' : '$dynamicRef';
        steps.push((data, errors, instancePath, schemaPath) => {
          if (errors !== NOERRORS) errors.push(err(kw, kw, instancePath, schemaPath + seg, { ref }, `cannot resolve ${kw} ${ref}`));
          return false;
        });
        vsteps.push(() => false);
        continue;
      }
      const target = inPlace(interp.node(t.node), t.base);
      let cstep, vstep;
      if (collect) {
        cstep = (data, errors, instancePath, schemaPath, stack, rec) => {
          const pl = pLen(rec), n0 = rec.n, xl = xLen(rec);
          const ok = target.c(data, errors, instancePath, schemaPath + seg, stack, rec);
          if (!ok) undo(rec, pl, n0, xl);
          return ok;
        };
        vstep = (data, stack, rec) => target.v(data, stack, rec);
      } else {
        cstep = (data, errors, instancePath, schemaPath, stack) => target.c(data, errors, instancePath, schemaPath + seg, stack);
        vstep = target.v;
      }
      if (ctx.guard) {
        // The cycle guard mirrors eval(): a (schema, data) pair already on
        // the stack is a fixed point.
        const schema = P.schema;
        const ic = cstep, iv = vstep;
        cstep = (data, errors, instancePath, schemaPath, stack, rec) => {
          for (let i = stack.length - 2; i >= 0; i -= 2) {
            if (stack[i] === schema && stack[i + 1] === data) return true;
          }
          stack.push(schema, data);
          const ok = ic(data, errors, instancePath, schemaPath, stack, rec);
          stack.length -= 2;
          return ok;
        };
        vstep = (data, stack, rec) => {
          for (let i = stack.length - 2; i >= 0; i -= 2) {
            if (stack[i] === schema && stack[i + 1] === data) return true;
          }
          stack.push(schema, data);
          const ok = iv(data, stack, rec);
          stack.length -= 2;
          return ok;
        };
      }
      steps.push(cstep);
      vsteps.push(vstep);
    }

    // Every value-level keyword in one step, reusing the leaf evaluator so
    // the two paths cannot drift.
    if (P.hasType || P.enum !== null || P.hasConst || P.hasNumber || P.hasString ||
        P.minItems !== undefined || P.maxItems !== undefined || P.uniqueItems ||
        P.required !== null || P.minProperties !== undefined || P.maxProperties !== undefined ||
        P.dependentRequired !== null) {
      steps.push((data, errors, instancePath, schemaPath) => evalLeaf(P, data, errors, instancePath, schemaPath));
      vsteps.push(compileLeafV(P));
    }

    // Arrays
    if (P.prefixItems !== null) {
      const fns = P.prefixItems.map(child);
      steps.push((data, errors, instancePath, schemaPath, stack, rec) => {
        if (dataBits(data) !== T_ARRAY) return true;
        let ok = true;
        const n = Math.min(fns.length, data.length);
        for (let i = 0; i < n; i++) {
          if (!fns[i].c(data[i], errors, instancePath + '/' + i, schemaPath + '/prefixItems/' + i, stack)) {
            ok = false;
            if (errors === NOERRORS) return false;
          }
        }
        if (collect) markRange(rec, 0, n);
        return ok;
      });
      vsteps.push((data, stack, rec) => {
        if (dataBits(data) !== T_ARRAY) return true;
        const n = Math.min(fns.length, data.length);
        for (let i = 0; i < n; i++) if (!fns[i].v(data[i], stack)) return false;
        if (collect) markRange(rec, 0, n);
        return true;
      });
    }
    if (P.items !== undefined) {
      const fn = child(P.items);
      const start = P.prefixItems !== null ? P.prefixItems.length : 0;
      steps.push((data, errors, instancePath, schemaPath, stack, rec) => {
        if (dataBits(data) !== T_ARRAY) return true;
        let ok = true;
        for (let i = start; i < data.length; i++) {
          if (!fn.c(data[i], errors, instancePath + '/' + i, schemaPath + '/items', stack)) {
            ok = false;
            if (errors === NOERRORS) return false;
          }
        }
        if (collect) markRange(rec, start, data.length);
        return ok;
      });
      const fv = fn.v;
      vsteps.push((data, stack, rec) => {
        if (dataBits(data) !== T_ARRAY) return true;
        for (let i = start; i < data.length; i++) if (!fv(data[i], stack)) return false;
        if (collect) markRange(rec, start, data.length);
        return true;
      });
    }
    if (P.contains !== undefined) {
      const fn = child(P.contains);
      const minC = P.minContains !== undefined ? P.minContains : 1;
      const maxC = P.maxContains;
      steps.push((data, errors, instancePath, schemaPath, stack, rec) => {
        if (dataBits(data) !== T_ARRAY) return true;
        let matched = 0;
        for (let i = 0; i < data.length; i++) {
          if (fn.v(data[i], stack)) {
            matched++;
            if (collect) addItem(rec, i);
          }
        }
        let ok = true;
        if (matched < minC) {
          if (errors !== NOERRORS) errors.push(err('contains', 'contains', instancePath, schemaPath + '/contains', { minContains: minC }, `must contain at least ${minC} valid item(s)`));
          ok = false;
        }
        if (maxC !== undefined && matched > maxC) {
          if (errors !== NOERRORS) errors.push(err('maxContains', 'maxContains', instancePath, schemaPath + '/maxContains', { limit: maxC }, `must NOT contain more than ${maxC} valid item(s)`));
          ok = false;
        }
        return ok;
      });
      if (collect) {
        // Every matching index is an annotation, so the scan runs to the end.
        vsteps.push((data, stack, rec) => {
          if (dataBits(data) !== T_ARRAY) return true;
          let matched = 0;
          for (let i = 0; i < data.length; i++) {
            if (fn.v(data[i], stack)) { matched++; addItem(rec, i); }
          }
          return matched >= minC && (maxC === undefined || matched <= maxC);
        });
      } else {
        vsteps.push((data, stack) => {
          if (dataBits(data) !== T_ARRAY) return true;
          let matched = 0;
          for (let i = 0; i < data.length; i++) {
            if (fn.v(data[i], stack)) { matched++; if (maxC === undefined && matched >= minC) return true; }
          }
          return matched >= minC && (maxC === undefined || matched <= maxC);
        });
      }
    }

    // Objects
    if (P.properties !== null || P.patternProperties !== null || P.additionalProperties !== undefined || P.propertyNames !== undefined) {
      const props = P.properties;
      // Declared properties: a linear scan over a short list beats a Map
      // lookup, and most schemas declare a handful.
      const propKeys = props !== null ? [...props.keys()] : null;
      const propList = props !== null
        ? [...props.values()].map((entry) => ({ fn: child(entry.node), seg: entry.seg, schemaSeg: entry.schemaSeg }))
        : null;
      const propMap = props !== null && props.size > 8 ? new Map(propKeys.map((k, i) => [k, propList[i]])) : null;
      const lookup = propMap !== null
        ? (key) => propMap.get(key)
        : propKeys !== null
          ? (key) => { for (let i = 0; i < propKeys.length; i++) if (propKeys[i] === key) return propList[i]; return undefined; }
          : null;
      const patterns = P.patternProperties !== null
        ? P.patternProperties.map((e) => ({ re: e.re, src: e.src, fn: child(e.node) }))
        : null;
      const apFn = P.additionalProperties !== undefined ? child(P.additionalProperties) : null;
      const pnFn = P.propertyNames !== undefined ? child(P.propertyNames) : null;
      steps.push((data, errors, instancePath, schemaPath, stack, rec) => {
        if (dataBits(data) !== T_OBJECT) return true;
        let ok = true;
        const keys = collect ? keysOf(rec, data) : Object.keys(data);
        if (pnFn !== null) {
          for (const k of keys) {
            if (!pnFn.c(k, errors, instancePath + '/' + escapePointer(k), schemaPath + '/propertyNames', stack)) {
              ok = false;
              if (errors === NOERRORS) return false;
            }
          }
        }
        for (let k = 0; k < keys.length; k++) {
          const key = keys[k];
          let evaluated = false;
          const prop = lookup !== null ? lookup(key) : undefined;
          if (prop !== undefined) {
            if (!prop.fn.c(data[key], errors, instancePath + prop.seg, schemaPath + prop.schemaSeg, stack)) {
              ok = false;
              if (errors === NOERRORS) return false;
            }
            evaluated = true;
          }
          if (patterns !== null) {
            for (let pi = 0; pi < patterns.length; pi++) {
              const pp = patterns[pi];
              if (pp.re.test(key)) {
                if (!pp.fn.c(data[key], errors, instancePath + '/' + escapePointer(key), schemaPath + '/patternProperties/' + escapePointer(pp.src), stack)) {
                  ok = false;
                  if (errors === NOERRORS) return false;
                }
                evaluated = true;
              }
            }
          }
          if (!evaluated && apFn !== null) {
            if (!apFn.c(data[key], errors, instancePath + '/' + escapePointer(key), schemaPath + '/additionalProperties', stack)) {
              ok = false;
              if (errors === NOERRORS) return false;
            }
            evaluated = true;
          }
          if (evaluated && collect) addProp(rec, key);
        }
        return ok;
      });
      if (patterns === null && apFn === null && pnFn === null && propKeys.length <= 8) {
        // Only declared properties matter and there are few: walk the
        // schema's list and look each one up, no key array. Own-property
        // test on purpose, so an inherited name (`toString`, `__proto__`) is
        // not mistaken for data. A long list walks the data's keys instead,
        // since the data usually carries far fewer.
        const n = propKeys.length;
        vsteps.push((data, stack, rec) => {
          if (dataBits(data) !== T_OBJECT) return true;
          for (let i = 0; i < n; i++) {
            const key = propKeys[i];
            if (!Object.hasOwn(data, key)) continue;
            if (!propList[i].fn.v(data[key], stack)) return false;
            if (collect) addProp(rec, key);
          }
          return true;
        });
      } else vsteps.push((data, stack, rec) => {
        if (dataBits(data) !== T_OBJECT) return true;
        const keys = collect ? keysOf(rec, data) : Object.keys(data);
        if (pnFn !== null) {
          for (const k of keys) if (!pnFn.v(k, stack)) return false;
        }
        for (let k = 0; k < keys.length; k++) {
          const key = keys[k];
          let evaluated = false;
          const prop = lookup !== null ? lookup(key) : undefined;
          if (prop !== undefined) {
            if (!prop.fn.v(data[key], stack)) return false;
            evaluated = true;
          }
          if (patterns !== null) {
            for (let pi = 0; pi < patterns.length; pi++) {
              const pp = patterns[pi];
              if (pp.re.test(key)) {
                if (!pp.fn.v(data[key], stack)) return false;
                evaluated = true;
              }
            }
          }
          if (!evaluated && apFn !== null) {
            if (!apFn.v(data[key], stack)) return false;
            evaluated = true;
          }
          if (evaluated && collect) addProp(rec, key);
        }
        return true;
      });
    }
    if (P.dependentSchemas !== null) {
      const entries = P.dependentSchemas.map(([k, v]) => [k, inPlace(v, base), escapePointer(k)]);
      steps.push((data, errors, instancePath, schemaPath, stack, rec) => {
        if (dataBits(data) !== T_OBJECT) return true;
        let ok = true;
        for (const [k, fn, ek] of entries) {
          if (Object.hasOwn(data, k)) {
            if (collect) {
              const pl = pLen(rec), n0 = rec.n, xl = xLen(rec);
              if (!fn.c(data, errors, instancePath, schemaPath + '/dependentSchemas/' + ek, stack, rec)) {
                undo(rec, pl, n0, xl);
                ok = false;
                if (errors === NOERRORS) return false;
              }
            } else if (!fn.c(data, errors, instancePath, schemaPath + '/dependentSchemas/' + ek, stack)) {
              ok = false;
              if (errors === NOERRORS) return false;
            }
          }
        }
        return ok;
      });
      vsteps.push((data, stack, rec) => {
        if (dataBits(data) !== T_OBJECT) return true;
        for (const [k, fn] of entries) {
          if (Object.hasOwn(data, k) && !fn.v(data, stack, rec)) return false;
        }
        return true;
      });
    }
    if (P.propertyDependencies !== null) {
      const entries = P.propertyDependencies.map(([k, choices]) => {
        const m = new Map();
        for (const [value, v] of choices) m.set(value, inPlace(v, base));
        return [k, m];
      });
      steps.push((data, errors, instancePath, schemaPath, stack, rec) => {
        if (dataBits(data) !== T_OBJECT) return true;
        let ok = true;
        for (const [k, choices] of entries) {
          if (!Object.hasOwn(data, k)) continue;
          const value = data[k];
          if (typeof value !== 'string') continue;
          const fn = choices.get(value);
          if (fn === undefined) continue;
          const branchPath = schemaPath + '/propertyDependencies/' + escapePointer(k) + '/' + escapePointer(value);
          if (collect) {
            const pl = pLen(rec), n0 = rec.n, xl = xLen(rec);
            if (!fn.c(data, errors, instancePath, branchPath, stack, rec)) {
              undo(rec, pl, n0, xl);
              ok = false;
              if (errors === NOERRORS) return false;
            }
          } else if (!fn.c(data, errors, instancePath, branchPath, stack)) {
            ok = false;
            if (errors === NOERRORS) return false;
          }
        }
        return ok;
      });
      vsteps.push((data, stack, rec) => {
        if (dataBits(data) !== T_OBJECT) return true;
        for (const [k, choices] of entries) {
          if (!Object.hasOwn(data, k)) continue;
          const value = data[k];
          if (typeof value !== 'string') continue;
          const fn = choices.get(value);
          if (fn !== undefined && !fn.v(data, stack, rec)) return false;
        }
        return true;
      });
    }

    // In-place applicators
    if (P.allOf !== null) {
      const fns = P.allOf.map((v) => inPlace(v, base));
      steps.push((data, errors, instancePath, schemaPath, stack, rec) => {
        let ok = true;
        for (let i = 0; i < fns.length; i++) {
          if (collect) {
            const pl = pLen(rec), n0 = rec.n, xl = xLen(rec);
            if (!fns[i].c(data, errors, instancePath, schemaPath + '/allOf/' + i, stack, rec)) {
              undo(rec, pl, n0, xl);
              ok = false;
              if (errors === NOERRORS) return false;
            }
          } else if (!fns[i].c(data, errors, instancePath, schemaPath + '/allOf/' + i, stack)) {
            ok = false;
            if (errors === NOERRORS) return false;
          }
        }
        return ok;
      });
      vsteps.push((data, stack, rec) => {
        for (let i = 0; i < fns.length; i++) if (!fns[i].v(data, stack, rec)) return false;
        return true;
      });
    }
    if (P.anyOf !== null) {
      const fns = P.anyOf.map((v) => inPlace(v, base));
      steps.push((data, errors, instancePath, schemaPath, stack, rec) => {
        const scratch = errors === NOERRORS ? NOERRORS : [];
        let any = false;
        for (let i = 0; i < fns.length; i++) {
          if (collect) {
            const pl = pLen(rec), n0 = rec.n, xl = xLen(rec);
            if (fns[i].c(data, scratch, instancePath, schemaPath + '/anyOf/' + i, stack, rec)) any = true;
            else undo(rec, pl, n0, xl);
          } else if (fns[i].c(data, scratch, instancePath, schemaPath + '/anyOf/' + i, stack)) any = true;
        }
        if (!any) {
          if (errors !== NOERRORS) {
            for (const e of scratch) errors.push(e);
            errors.push(err('anyOf', 'anyOf', instancePath, schemaPath + '/anyOf', {}, 'must match a schema in anyOf'));
          }
          return false;
        }
        return true;
      });
      if (collect) {
        // Every passing branch contributes annotations, so all of them run.
        vsteps.push((data, stack, rec) => {
          let any = false;
          for (let i = 0; i < fns.length; i++) {
            const pl = pLen(rec), n0 = rec.n, xl = xLen(rec);
            if (fns[i].v(data, stack, rec)) any = true;
            else undo(rec, pl, n0, xl);
          }
          return any;
        });
      } else {
        vsteps.push((data, stack) => {
          for (let i = 0; i < fns.length; i++) if (fns[i].v(data, stack)) return true;
          return false;
        });
      }
    }
    if (P.oneOf !== null) {
      const fns = P.oneOf.map((v) => inPlace(v, base));
      steps.push((data, errors, instancePath, schemaPath, stack, rec) => {
        const scratch = errors === NOERRORS ? NOERRORS : [];
        let count = 0;
        // With a record: the winner's annotations stay, every other branch's
        // are undone, and a second winner undoes everything since the node
        // fails and merges nothing.
        const pl0 = collect ? pLen(rec) : 0, n00 = collect ? rec.n : 0, xl0 = collect ? xLen(rec) : 0;
        for (let i = 0; i < fns.length; i++) {
          if (collect) {
            const pl = pLen(rec), n0 = rec.n, xl = xLen(rec);
            if (fns[i].c(data, scratch, instancePath, schemaPath + '/oneOf/' + i, stack, rec)) count++;
            else undo(rec, pl, n0, xl);
          } else if (fns[i].c(data, scratch, instancePath, schemaPath + '/oneOf/' + i, stack)) count++;
        }
        if (count !== 1) {
          if (collect) undo(rec, pl0, n00, xl0);
          if (errors !== NOERRORS) {
            if (count === 0) for (const e of scratch) errors.push(e);
            errors.push(err('oneOf', 'oneOf', instancePath, schemaPath + '/oneOf', { passingSchemas: count }, 'must match exactly one schema in oneOf'));
          }
          return false;
        }
        return true;
      });
      if (collect) {
        vsteps.push((data, stack, rec) => {
          let count = 0;
          for (let i = 0; i < fns.length; i++) {
            const pl = pLen(rec), n0 = rec.n, xl = xLen(rec);
            if (fns[i].v(data, stack, rec)) { count++; if (count > 1) return false; }
            else undo(rec, pl, n0, xl);
          }
          return count === 1;
        });
      } else {
        vsteps.push((data, stack) => {
          let count = 0;
          for (let i = 0; i < fns.length; i++) {
            if (fns[i].v(data, stack)) { count++; if (count > 1) return false; }
          }
          return count === 1;
        });
      }
    }
    if (P.not !== undefined) {
      const fn = child(P.not);
      steps.push((data, errors, instancePath, schemaPath, stack) => {
        if (fn.v(data, stack)) {
          if (errors !== NOERRORS) errors.push(err('not', 'not', instancePath, schemaPath + '/not', {}, 'must NOT be valid'));
          return false;
        }
        return true;
      });
      vsteps.push((data, stack) => !fn.v(data, stack));
    }
    if (P.if !== undefined) {
      const ifFn = inPlace(P.if, base);
      const thenFn = P.then !== undefined ? inPlace(P.then, base) : null;
      const elseFn = P.else !== undefined ? inPlace(P.else, base) : null;
      // The `if` branch keeps its annotations only when it passes; then and
      // else fail the node when they fail, and the collect variant undoes
      // theirs so the node's own unevaluated* sees what eval() sees.
      steps.push((data, errors, instancePath, schemaPath, stack, rec) => {
        let pl = collect ? pLen(rec) : 0, n0 = collect ? rec.n : 0, xl = collect ? xLen(rec) : 0;
        let ok;
        if (ifFn.v(data, stack, rec)) {
          if (thenFn === null) return true;
          if (collect) { pl = pLen(rec); n0 = rec.n; xl = xLen(rec); }
          ok = thenFn.c(data, errors, instancePath, schemaPath + '/then', stack, rec);
        } else {
          if (collect) undo(rec, pl, n0, xl);
          if (elseFn === null) return true;
          ok = elseFn.c(data, errors, instancePath, schemaPath + '/else', stack, rec);
        }
        if (!ok && collect) undo(rec, pl, n0, xl);
        return ok;
      });
      vsteps.push((data, stack, rec) => {
        const pl = collect ? pLen(rec) : 0, n0 = collect ? rec.n : 0, xl = collect ? xLen(rec) : 0;
        if (ifFn.v(data, stack, rec)) {
          if (thenFn !== null) return thenFn.v(data, stack, rec);
          return true;
        }
        if (collect) undo(rec, pl, n0, xl);
        if (elseFn !== null) return elseFn.v(data, stack, rec);
        return true;
      });
    }

    // unevaluated*: run last, against the annotations of everything above.
    if (P.unevaluatedProperties !== undefined) {
      const fn = child(P.unevaluatedProperties);
      steps.push((data, errors, instancePath, schemaPath, stack, rec) => {
        if (dataBits(data) !== T_OBJECT) return true;
        let ok = true;
        const keys = keysOf(rec, data);
        for (let k = 0; k < keys.length; k++) {
          const key = keys[k];
          if (hasProp(rec, key)) continue;
          if (!fn.c(data[key], errors, instancePath + '/' + escapePointer(key), schemaPath + '/unevaluatedProperties', stack)) {
            ok = false;
            if (errors === NOERRORS) return false;
          }
          addProp(rec, key);
        }
        return ok;
      });
      if (fn === FALSE_PAIR) {
        // Every key must already be evaluated; on success there is nothing
        // new to record.
        vsteps.push((data, stack, rec) => {
          if (dataBits(data) !== T_OBJECT) return true;
          const keys = keysOf(rec, data);
          if (keys.length === 0) return true;
          if (rec.props === null) return false;
          for (let k = 0; k < keys.length; k++) if (!hasProp(rec, keys[k])) return false;
          return true;
        });
      } else {
        vsteps.push((data, stack, rec) => {
          if (dataBits(data) !== T_OBJECT) return true;
          const keys = keysOf(rec, data);
          for (let k = 0; k < keys.length; k++) {
            const key = keys[k];
            if (hasProp(rec, key)) continue;
            if (!fn.v(data[key], stack)) return false;
            addProp(rec, key);
          }
          return true;
        });
      }
    }
    if (P.unevaluatedItems !== undefined) {
      const fn = child(P.unevaluatedItems);
      steps.push((data, errors, instancePath, schemaPath, stack, rec) => {
        if (dataBits(data) !== T_ARRAY) return true;
        let ok = true;
        for (let i = 0; i < data.length; i++) {
          if (hasItem(rec, i)) continue;
          if (!fn.c(data[i], errors, instancePath + '/' + i, schemaPath + '/unevaluatedItems', stack)) {
            ok = false;
            if (errors === NOERRORS) return false;
          }
        }
        if (data.length > rec.n) rec.n = data.length;
        return ok;
      });
      if (fn === FALSE_PAIR) {
        vsteps.push((data, stack, rec) => {
          if (dataBits(data) !== T_ARRAY) return true;
          for (let i = rec.n; i < data.length; i++) if (!hasItem(rec, i)) return false;
          return true;
        });
      } else {
        vsteps.push((data, stack, rec) => {
          if (dataBits(data) !== T_ARRAY) return true;
          for (let i = 0; i < data.length; i++) {
            if (hasItem(rec, i)) continue;
            if (!fn.v(data[i], stack)) return false;
          }
          if (data.length > rec.n) rec.n = data.length;
          return true;
        });
      }
    }

    let cfn;
    if (steps.length === 0) cfn = TRUE_FN;
    else if (steps.length === 1) cfn = steps[0];
    else {
      const arr = steps;
      cfn = (d, e, ip, sp, st, rec) => {
        let ok = true;
        for (let i = 0; i < arr.length; i++) {
          if (!arr[i](d, e, ip, sp, st, rec)) {
            if (e === NOERRORS) return false;
            ok = false;
          }
        }
        return ok;
      };
    }
    let vfn;
    if (vsteps.length === 0) vfn = TRUE_FN;
    else if (vsteps.length === 1) vfn = vsteps[0];
    else if (vsteps.length === 2) {
      const [a, b] = vsteps;
      vfn = (d, st, rec) => a(d, st, rec) && b(d, st, rec);
    } else {
      const arr = vsteps;
      vfn = (d, st, rec) => {
        for (let i = 0; i < arr.length; i++) if (!arr[i](d, st, rec)) return false;
        return true;
      };
    }
    if (P.hasUnevaluated) {
      // This node reads annotations, so it owns a record that starts empty
      // (siblings' annotations are not its to see) and hands it up on
      // success when a caller reads it.
      const inner = cfn;
      const innerV = vfn;
      if (ann) {
        cfn = (d, e, ip, sp, st, rec) => {
          const own = fresh();
          const ok = inner(d, e, ip, sp, st, own);
          if (ok) mergeRec(rec, own);
          return ok;
        };
        vfn = (d, st, rec) => {
          const own = fresh();
          const ok = innerV(d, st, own);
          if (ok) mergeRec(rec, own);
          return ok;
        };
      } else {
        cfn = (d, e, ip, sp, st) => inner(d, e, ip, sp, st, fresh());
        vfn = (d, st) => innerV(d, st, fresh());
      }
    }
    box.c = cfn;
    box.v = vfn;
    pair.c = cfn;
    pair.v = vfn;
    pair.open = false;
    return pair;
  }

  // Entry point: every schema the interpreter accepts compiles. The first
  // pass carries the cycle guard and reports whether the graph has a cycle;
  // an acyclic schema is compiled again without the guard, since eval()'s
  // guard can never fire on it.
  function compileInterpreter(interp) {
    const root = interp.rootNode;
    const base = interp.state.rootBase;
    let ctx = { interp, memo: new Map(), guard: true, cyclic: false };
    let pair = compileNode(ctx, root, base, [base], false);
    if (!ctx.cyclic) {
      ctx = { interp, memo: new Map(), guard: false, cyclic: false };
      pair = compileNode(ctx, root, base, [base], false);
    }
    return { v: pair.v, c: pair.c, cyclic: ctx.guard };
  }

  return { compileInterpreter };
}

module.exports = { install };
