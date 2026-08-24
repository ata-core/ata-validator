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
//     hands those the discard sink.
// A `$ref` or `$dynamicRef` that does not resolve compiles into the same
// runtime rejection eval() produces, so nothing declines. Error output must
// be byte-for-byte what eval() produces; tests/test_plan_compiler.js diffs
// the two over the official suite.
//
// Compiled pairs: `c(data, errors, instancePath, schemaPath, stack[, sink])`
// collects errors and returns the verdict; `v(data, stack[, sink])` returns
// the verdict alone, with no path strings and no error objects, and returns
// on the first failure. `errors` may be the NOERRORS sentinel, in which case
// the collect variant also stops at the first failure. `sink` exists only on
// nodes compiled in annotating mode; a node writes its annotations into its
// own local record and merges that into the sink when, and only when, it is
// valid, exactly like eval().

function install(deps) {
  const { Plan, NOERRORS, err, evalLeaf, evalLeafV, dataBits, escapePointer, mergeAnnotations,
          T_ARRAY, T_OBJECT, resolveRef, splitFragment, resolveUri } = deps;

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

  function fresh() { return { props: null, items: null }; }

  function markItems(local, from, to) {
    if (from >= to) return;
    if (local.items === null) local.items = new Set();
    for (let i = from; i < to; i++) local.items.add(i);
  }

  function compileNode(interp, node, base, chain, ann, memo) {
    if (node === true) return TRUE_PAIR;
    if (node === false) return FALSE_PAIR;
    if (!(node instanceof Plan)) return TRUE_PAIR;
    const P = node;
    if (P.nodeBase !== null && P.nodeBase !== base) base = P.nodeBase;
    if (chain.indexOf(base) === -1) chain = chain.concat(base);
    const collect = ann || P.hasUnevaluated;

    let perKey = memo.get(P);
    if (perKey === undefined) { perKey = new Map(); memo.set(P, perKey); }
    const key = (ann ? 'a ' : 'p ') + base + ' ' + chain.join(' ');
    const cached = perKey.get(key);
    if (cached !== undefined) return cached;
    // Cycles: register trampolines before compiling children.
    const box = { v: null, c: null };
    const pair = {
      v: (d, st, sink) => box.v(d, st, sink),
      c: (d, e, ip, sp, st, sink) => box.c(d, e, ip, sp, st, sink),
    };
    perKey.set(key, pair);

    // In-place children collect when this node does; child applicators
    // never do. `local` is threaded as the trailing argument of every step
    // and is undefined on non-collecting nodes, where nothing reads it.
    const inPlace = (n, b) => compileNode(interp, n, b, chain, collect, memo);
    const child = (n) => compileNode(interp, n, base, chain, false, memo);

    const steps = [];   // collect variant: (data, errors, ip, sp, stack, local)
    const vsteps = [];  // verdict variant: (data, stack, local)

    // $ref / $dynamicRef, resolved at compile time. The cycle guard mirrors
    // eval(): a (schema, data) pair already on the stack is a fixed point.
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
      const schema = P.schema;
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
      steps.push((data, errors, instancePath, schemaPath, stack, local) => {
        for (let i = stack.length - 2; i >= 0; i -= 2) {
          if (stack[i] === schema && stack[i + 1] === data) return true;
        }
        stack.push(schema, data);
        const ok = target.c(data, errors, instancePath, schemaPath + seg, stack, local);
        stack.length -= 2;
        return ok;
      });
      vsteps.push((data, stack, local) => {
        for (let i = stack.length - 2; i >= 0; i -= 2) {
          if (stack[i] === schema && stack[i + 1] === data) return true;
        }
        stack.push(schema, data);
        const ok = target.v(data, stack, local);
        stack.length -= 2;
        return ok;
      });
    }

    // Every value-level keyword in one step, reusing the leaf evaluator so
    // the two paths cannot drift.
    if (P.hasType || P.enum !== null || P.hasConst || P.hasNumber || P.hasString ||
        P.minItems !== undefined || P.maxItems !== undefined || P.uniqueItems ||
        P.required !== null || P.minProperties !== undefined || P.maxProperties !== undefined ||
        P.dependentRequired !== null) {
      steps.push((data, errors, instancePath, schemaPath) => evalLeaf(P, data, errors, instancePath, schemaPath));
      vsteps.push((data) => evalLeafV(P, data));
    }

    // Arrays
    if (P.prefixItems !== null) {
      const fns = P.prefixItems.map(child);
      steps.push((data, errors, instancePath, schemaPath, stack, local) => {
        if (dataBits(data) !== T_ARRAY) return true;
        let ok = true;
        const n = Math.min(fns.length, data.length);
        for (let i = 0; i < n; i++) {
          if (!fns[i].c(data[i], errors, instancePath + '/' + i, schemaPath + '/prefixItems/' + i, stack)) {
            ok = false;
            if (errors === NOERRORS) return false;
          }
        }
        if (collect) markItems(local, 0, n);
        return ok;
      });
      vsteps.push((data, stack, local) => {
        if (dataBits(data) !== T_ARRAY) return true;
        const n = Math.min(fns.length, data.length);
        for (let i = 0; i < n; i++) if (!fns[i].v(data[i], stack)) return false;
        if (collect) markItems(local, 0, n);
        return true;
      });
    }
    if (P.items !== undefined) {
      const fn = child(P.items);
      const start = P.prefixItems !== null ? P.prefixItems.length : 0;
      steps.push((data, errors, instancePath, schemaPath, stack, local) => {
        if (dataBits(data) !== T_ARRAY) return true;
        let ok = true;
        for (let i = start; i < data.length; i++) {
          if (!fn.c(data[i], errors, instancePath + '/' + i, schemaPath + '/items', stack)) {
            ok = false;
            if (errors === NOERRORS) return false;
          }
        }
        if (collect) markItems(local, start, data.length);
        return ok;
      });
      const fv = fn.v;
      vsteps.push((data, stack, local) => {
        if (dataBits(data) !== T_ARRAY) return true;
        for (let i = start; i < data.length; i++) if (!fv(data[i], stack)) return false;
        if (collect) markItems(local, start, data.length);
        return true;
      });
    }
    if (P.contains !== undefined) {
      const fn = child(P.contains);
      const minC = P.minContains !== undefined ? P.minContains : 1;
      const maxC = P.maxContains;
      steps.push((data, errors, instancePath, schemaPath, stack, local) => {
        if (dataBits(data) !== T_ARRAY) return true;
        let matched = 0;
        for (let i = 0; i < data.length; i++) {
          if (fn.v(data[i], stack)) {
            matched++;
            if (collect) { if (local.items === null) local.items = new Set(); local.items.add(i); }
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
        vsteps.push((data, stack, local) => {
          if (dataBits(data) !== T_ARRAY) return true;
          let matched = 0;
          for (let i = 0; i < data.length; i++) {
            if (fn.v(data[i], stack)) {
              matched++;
              if (local.items === null) local.items = new Set();
              local.items.add(i);
            }
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
      const propFns = props !== null ? new Map() : null;
      if (props !== null) {
        for (const [k, entry] of props) propFns.set(k, { fn: child(entry.node), seg: entry.seg, schemaSeg: entry.schemaSeg });
      }
      const patterns = P.patternProperties !== null
        ? P.patternProperties.map((e) => ({ re: e.re, src: e.src, fn: child(e.node) }))
        : null;
      const apFn = P.additionalProperties !== undefined ? child(P.additionalProperties) : null;
      const pnFn = P.propertyNames !== undefined ? child(P.propertyNames) : null;
      steps.push((data, errors, instancePath, schemaPath, stack, local) => {
        if (dataBits(data) !== T_OBJECT) return true;
        let ok = true;
        const keys = Object.keys(data);
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
          const prop = propFns !== null ? propFns.get(key) : undefined;
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
          if (evaluated && collect) { if (local.props === null) local.props = new Set(); local.props.add(key); }
        }
        return ok;
      });
      vsteps.push((data, stack, local) => {
        if (dataBits(data) !== T_OBJECT) return true;
        const keys = Object.keys(data);
        if (pnFn !== null) {
          for (const k of keys) if (!pnFn.v(k, stack)) return false;
        }
        for (let k = 0; k < keys.length; k++) {
          const key = keys[k];
          let evaluated = false;
          const prop = propFns !== null ? propFns.get(key) : undefined;
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
          if (evaluated && collect) { if (local.props === null) local.props = new Set(); local.props.add(key); }
        }
        return true;
      });
    }
    if (P.dependentSchemas !== null) {
      const entries = P.dependentSchemas.map(([k, v]) => [k, inPlace(v, base), escapePointer(k)]);
      steps.push((data, errors, instancePath, schemaPath, stack, local) => {
        if (dataBits(data) !== T_OBJECT) return true;
        let ok = true;
        for (const [k, fn, ek] of entries) {
          if (Object.hasOwn(data, k)) {
            if (!fn.c(data, errors, instancePath, schemaPath + '/dependentSchemas/' + ek, stack, local)) {
              ok = false;
              if (errors === NOERRORS) return false;
            }
          }
        }
        return ok;
      });
      vsteps.push((data, stack, local) => {
        if (dataBits(data) !== T_OBJECT) return true;
        for (const [k, fn] of entries) {
          if (Object.hasOwn(data, k) && !fn.v(data, stack, local)) return false;
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
      steps.push((data, errors, instancePath, schemaPath, stack, local) => {
        if (dataBits(data) !== T_OBJECT) return true;
        let ok = true;
        for (const [k, choices] of entries) {
          if (!Object.hasOwn(data, k)) continue;
          const value = data[k];
          if (typeof value !== 'string') continue;
          const fn = choices.get(value);
          if (fn === undefined) continue;
          const branchPath = schemaPath + '/propertyDependencies/' + escapePointer(k) + '/' + escapePointer(value);
          if (!fn.c(data, errors, instancePath, branchPath, stack, local)) {
            ok = false;
            if (errors === NOERRORS) return false;
          }
        }
        return ok;
      });
      vsteps.push((data, stack, local) => {
        if (dataBits(data) !== T_OBJECT) return true;
        for (const [k, choices] of entries) {
          if (!Object.hasOwn(data, k)) continue;
          const value = data[k];
          if (typeof value !== 'string') continue;
          const fn = choices.get(value);
          if (fn !== undefined && !fn.v(data, stack, local)) return false;
        }
        return true;
      });
    }

    // In-place applicators
    if (P.allOf !== null) {
      const fns = P.allOf.map((v) => inPlace(v, base));
      steps.push((data, errors, instancePath, schemaPath, stack, local) => {
        let ok = true;
        for (let i = 0; i < fns.length; i++) {
          if (!fns[i].c(data, errors, instancePath, schemaPath + '/allOf/' + i, stack, local)) {
            ok = false;
            if (errors === NOERRORS) return false;
          }
        }
        return ok;
      });
      vsteps.push((data, stack, local) => {
        for (let i = 0; i < fns.length; i++) if (!fns[i].v(data, stack, local)) return false;
        return true;
      });
    }
    if (P.anyOf !== null) {
      const fns = P.anyOf.map((v) => inPlace(v, base));
      steps.push((data, errors, instancePath, schemaPath, stack, local) => {
        const scratch = errors === NOERRORS ? NOERRORS : [];
        let any = false;
        for (let i = 0; i < fns.length; i++) {
          if (fns[i].c(data, scratch, instancePath, schemaPath + '/anyOf/' + i, stack, local)) any = true;
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
        vsteps.push((data, stack, local) => {
          let any = false;
          for (let i = 0; i < fns.length; i++) if (fns[i].v(data, stack, local)) any = true;
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
      steps.push((data, errors, instancePath, schemaPath, stack, local) => {
        const scratch = errors === NOERRORS ? NOERRORS : [];
        let count = 0;
        let winner = null;
        for (let i = 0; i < fns.length; i++) {
          const sub = collect ? fresh() : undefined;
          if (fns[i].c(data, scratch, instancePath, schemaPath + '/oneOf/' + i, stack, sub)) { count++; winner = sub; }
        }
        if (count !== 1) {
          if (errors !== NOERRORS) {
            if (count === 0) for (const e of scratch) errors.push(e);
            errors.push(err('oneOf', 'oneOf', instancePath, schemaPath + '/oneOf', { passingSchemas: count }, 'must match exactly one schema in oneOf'));
          }
          return false;
        }
        if (collect) mergeAnnotations(local, winner);
        return true;
      });
      if (collect) {
        vsteps.push((data, stack, local) => {
          let count = 0;
          let winner = null;
          for (let i = 0; i < fns.length; i++) {
            const sub = fresh();
            if (fns[i].v(data, stack, sub)) { count++; if (count > 1) return false; winner = sub; }
          }
          if (count !== 1) return false;
          mergeAnnotations(local, winner);
          return true;
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
      steps.push((data, errors, instancePath, schemaPath, stack, local) => {
        if (ifFn.v(data, stack, local)) {
          if (thenFn !== null) return thenFn.c(data, errors, instancePath, schemaPath + '/then', stack, local);
        } else if (elseFn !== null) {
          return elseFn.c(data, errors, instancePath, schemaPath + '/else', stack, local);
        }
        return true;
      });
      vsteps.push((data, stack, local) => {
        if (ifFn.v(data, stack, local)) {
          if (thenFn !== null) return thenFn.v(data, stack, local);
        } else if (elseFn !== null) {
          return elseFn.v(data, stack, local);
        }
        return true;
      });
    }

    // unevaluated*: run last, against the annotations of everything above.
    if (P.unevaluatedProperties !== undefined) {
      const fn = child(P.unevaluatedProperties);
      steps.push((data, errors, instancePath, schemaPath, stack, local) => {
        if (dataBits(data) !== T_OBJECT) return true;
        let ok = true;
        const keys = Object.keys(data);
        for (let k = 0; k < keys.length; k++) {
          const key = keys[k];
          if (local.props !== null && local.props.has(key)) continue;
          if (!fn.c(data[key], errors, instancePath + '/' + escapePointer(key), schemaPath + '/unevaluatedProperties', stack)) {
            ok = false;
            if (errors === NOERRORS) return false;
          }
          if (local.props === null) local.props = new Set();
          local.props.add(key);
        }
        return ok;
      });
      if (fn === FALSE_PAIR) {
        // Every key must already be evaluated; on success there is nothing
        // new to record.
        vsteps.push((data, stack, local) => {
          if (dataBits(data) !== T_OBJECT) return true;
          const keys = Object.keys(data);
          if (keys.length === 0) return true;
          if (local.props === null) return false;
          for (let k = 0; k < keys.length; k++) if (!local.props.has(keys[k])) return false;
          return true;
        });
      } else {
        vsteps.push((data, stack, local) => {
          if (dataBits(data) !== T_OBJECT) return true;
          const keys = Object.keys(data);
          for (let k = 0; k < keys.length; k++) {
            const key = keys[k];
            if (local.props !== null && local.props.has(key)) continue;
            if (!fn.v(data[key], stack)) return false;
            if (local.props === null) local.props = new Set();
            local.props.add(key);
          }
          return true;
        });
      }
    }
    if (P.unevaluatedItems !== undefined) {
      const fn = child(P.unevaluatedItems);
      steps.push((data, errors, instancePath, schemaPath, stack, local) => {
        if (dataBits(data) !== T_ARRAY) return true;
        let ok = true;
        for (let i = 0; i < data.length; i++) {
          if (local.items !== null && local.items.has(i)) continue;
          if (!fn.c(data[i], errors, instancePath + '/' + i, schemaPath + '/unevaluatedItems', stack)) {
            ok = false;
            if (errors === NOERRORS) return false;
          }
          if (local.items === null) local.items = new Set();
          local.items.add(i);
        }
        return ok;
      });
      if (fn === FALSE_PAIR) {
        vsteps.push((data, stack, local) => {
          if (dataBits(data) !== T_ARRAY) return true;
          if (data.length === 0) return true;
          if (local.items === null) return false;
          for (let i = 0; i < data.length; i++) if (!local.items.has(i)) return false;
          return true;
        });
      } else {
        vsteps.push((data, stack, local) => {
          if (dataBits(data) !== T_ARRAY) return true;
          for (let i = 0; i < data.length; i++) {
            if (local.items !== null && local.items.has(i)) continue;
            if (!fn.v(data[i], stack)) return false;
            if (local.items === null) local.items = new Set();
            local.items.add(i);
          }
          return true;
        });
      }
    }

    let cfn;
    if (steps.length === 0) cfn = TRUE_FN;
    else if (steps.length === 1) cfn = steps[0];
    else {
      const arr = steps;
      cfn = (d, e, ip, sp, st, local) => {
        let ok = true;
        for (let i = 0; i < arr.length; i++) {
          if (!arr[i](d, e, ip, sp, st, local)) {
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
      vfn = (d, st, local) => a(d, st, local) && b(d, st, local);
    } else {
      const arr = vsteps;
      vfn = (d, st, local) => {
        for (let i = 0; i < arr.length; i++) if (!arr[i](d, st, local)) return false;
        return true;
      };
    }
    if (collect) {
      // The node's own annotation record; merged into the caller's sink only
      // on success, and only when a caller reads it.
      const inner = cfn;
      const innerV = vfn;
      if (ann) {
        cfn = (d, e, ip, sp, st, sink) => {
          const local = fresh();
          const ok = inner(d, e, ip, sp, st, local);
          if (ok) mergeAnnotations(sink, local);
          return ok;
        };
        vfn = (d, st, sink) => {
          const local = fresh();
          const ok = innerV(d, st, local);
          if (ok) mergeAnnotations(sink, local);
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
    perKey.set(key, pair);
    return pair;
  }

  // Entry point: every schema the interpreter accepts compiles.
  function compileInterpreter(interp) {
    return compileNode(interp, interp.rootNode, interp.state.rootBase, [interp.state.rootBase], false, new Map());
  }

  return { compileInterpreter };
}

module.exports = { install };
