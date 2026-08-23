'use strict';

// Compiles interpreter Plans into a tree of specialized closures. No source
// generation, no `new Function`: this is plain closure composition, so it
// runs wherever the interpreter runs, CSP included. The payoff over eval()
// is that every keyword branch is decided once at compile time and every
// child call is a direct monomorphic call, which is the same advantage the
// code generator has, minus the codegen.
//
// Scope, deliberately narrow:
//   - single schema resource only (no embedded `$id`, no external documents),
//     so the base URI and the dynamic scope are compile-time constants and
//     `$ref` / `$dynamicRef` targets resolve once, here;
//   - no `unevaluatedProperties` / `unevaluatedItems` anywhere (annotation
//     flow stays eval()'s job).
// Anything outside that gate keeps the generic evaluator. Error output must
// be byte-for-byte what eval() produces; tests/test_plan_compiler.js diffs
// the two over the official suite.
//
// Compiled signature: fn(data, errors, instancePath, schemaPath, stack) ->
// boolean. `errors` may be the NOERRORS sentinel for verdict-only runs, in
// which case a failed step returns immediately; when collecting, every step
// runs, exactly like eval().

function install(deps) {
  const { Plan, NOERRORS, err, evalLeaf, evalLeafV, deepEqual, dataBits, escapePointer,
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

  // Whether the whole tree reachable from `node` fits the compiler's scope.
  // `base` is the base URI in effect, updated at compile time exactly the way
  // eval() updates it at run time: the schema path is static, so it can be.
  function compilable(interp, node, base, seen) {
    if (node === true || node === false) return true;
    if (!(node instanceof Plan)) return true;
    const P = node;
    if (P.nodeBase !== null && P.nodeBase !== base) base = P.nodeBase;
    const key = P;
    const prev = seen.get(key);
    if (prev !== undefined) { if (prev === base || prev === true) return true; return false; }
    seen.set(key, base);
    if (P.hasUnevaluated) return false;
    if (P.ref !== null) {
      const t = resolveRef(P.ref, base, interp.state);
      if (t.node === undefined || !compilable(interp, interp.node(t.node), t.base, seen)) return false;
    }
    if (P.dynamicRef !== null) {
      // $dynamicRef stays compiled only in a single-resource schema, where
      // the dynamic scope is a constant. Anything larger keeps eval().
      if (interp.state.resources.size !== 1) return false;
      const t = dynTarget(interp, P.dynamicRef);
      if (t === undefined || !compilable(interp, interp.node(t), base, seen)) return false;
    }
    const kids = [];
    if (P.properties !== null) for (const v of P.properties.values()) kids.push(v.node);
    if (P.patternProperties !== null) for (const e of P.patternProperties) kids.push(e.node);
    if (P.additionalProperties !== undefined) kids.push(P.additionalProperties);
    if (P.propertyNames !== undefined) kids.push(P.propertyNames);
    if (P.dependentSchemas !== null) for (const [, v] of P.dependentSchemas) kids.push(v);
    if (P.propertyDependencies !== null) for (const [, m] of P.propertyDependencies) for (const v of m.values()) kids.push(v);
    if (P.prefixItems !== null) for (const v of P.prefixItems) kids.push(v);
    if (P.items !== undefined) kids.push(P.items);
    if (P.contains !== undefined) kids.push(P.contains);
    if (P.allOf !== null) for (const v of P.allOf) kids.push(v);
    if (P.anyOf !== null) for (const v of P.anyOf) kids.push(v);
    if (P.oneOf !== null) for (const v of P.oneOf) kids.push(v);
    if (P.not !== undefined) kids.push(P.not);
    if (P.if !== undefined) kids.push(P.if);
    if (P.then !== undefined) kids.push(P.then);
    if (P.else !== undefined) kids.push(P.else);
    for (const k of kids) if (!compilable(interp, k, base, seen)) return false;
    return true;
  }

  // Static $dynamicRef target: with a single resource the dynamic scope is
  // always [rootBase], so the outermost-scope search collapses to a lookup.
  function dynTarget(interp, ref) {
    const base = interp.state.rootBase;
    let { node } = resolveRef(ref, base, interp.state);
    const [, fragment] = splitFragment(resolveUri(base, ref));
    if (fragment && !fragment.startsWith('/')) {
      const dyn = interp.state.dynamicAnchors.get(base);
      const bookended = node !== undefined && dyn && dyn.get(fragment) === node;
      if (bookended || !interp.bookending) {
        if (dyn && dyn.has(fragment)) node = dyn.get(fragment);
      }
    }
    return node;
  }

  function compileNode(interp, node, base, memo) {
    if (node === true) return TRUE_PAIR;
    if (node === false) return FALSE_PAIR;
    if (!(node instanceof Plan)) return TRUE_PAIR;
    const P = node;
    if (P.nodeBase !== null && P.nodeBase !== base) base = P.nodeBase;
    // A plan reached under two bases compiles once per base; nearly every
    // plan only ever has one.
    let perBase = memo.get(P);
    if (perBase === undefined) { perBase = new Map(); memo.set(P, perBase); }
    const cached = perBase.get(base);
    if (cached !== undefined) return cached;
    // Cycles: register trampolines before compiling children.
    const box = { v: null, c: null };
    const pair = {
      v: (d, st) => box.v(d, st),
      c: (d, e, ip, sp, st) => box.c(d, e, ip, sp, st),
    };
    perBase.set(base, pair);

    const steps = [];   // collect variant: (data, errors, ip, sp, stack)
    const vsteps = [];  // verdict variant: (data, stack), no strings at all

    // $ref / $dynamicRef, resolved at compile time. The cycle guard mirrors
    // eval(): a (schema, data) pair already on the stack is a fixed point.
    if (P.ref !== null) {
      const t = resolveRef(P.ref, base, interp.state);
      const target = compileNode(interp, interp.node(t.node), t.base, memo);
      const schema = P.schema;
      steps.push((data, errors, instancePath, schemaPath, stack) => {
        for (let i = stack.length - 2; i >= 0; i -= 2) {
          if (stack[i] === schema && stack[i + 1] === data) return true;
        }
        stack.push(schema, data);
        const ok = target.c(data, errors, instancePath, schemaPath + '/$ref', stack);
        stack.length -= 2;
        return ok;
      });
      vsteps.push((data, stack) => {
        for (let i = stack.length - 2; i >= 0; i -= 2) {
          if (stack[i] === schema && stack[i + 1] === data) return true;
        }
        stack.push(schema, data);
        const ok = target.v(data, stack);
        stack.length -= 2;
        return ok;
      });
    }
    if (P.dynamicRef !== null) {
      const target = compileNode(interp, interp.node(dynTarget(interp, P.dynamicRef)), base, memo);
      const schema = P.schema;
      steps.push((data, errors, instancePath, schemaPath, stack) => {
        for (let i = stack.length - 2; i >= 0; i -= 2) {
          if (stack[i] === schema && stack[i + 1] === data) return true;
        }
        stack.push(schema, data);
        const ok = target.c(data, errors, instancePath, schemaPath + '/$dynamicRef', stack);
        stack.length -= 2;
        return ok;
      });
      vsteps.push((data, stack) => {
        for (let i = stack.length - 2; i >= 0; i -= 2) {
          if (stack[i] === schema && stack[i + 1] === data) return true;
        }
        stack.push(schema, data);
        const ok = target.v(data, stack);
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
      const fns = P.prefixItems.map((v) => compileNode(interp, v, base, memo));
      steps.push((data, errors, instancePath, schemaPath, stack) => {
        if (dataBits(data) !== T_ARRAY) return true;
        let ok = true;
        const n = Math.min(fns.length, data.length);
        for (let i = 0; i < n; i++) {
          if (!fns[i].c(data[i], errors, instancePath + '/' + i, schemaPath + '/prefixItems/' + i, stack)) {
            ok = false;
            if (errors === NOERRORS) return false;
          }
        }
        return ok;
      });
      vsteps.push((data, stack) => {
        if (dataBits(data) !== T_ARRAY) return true;
        const n = Math.min(fns.length, data.length);
        for (let i = 0; i < n; i++) if (!fns[i].v(data[i], stack)) return false;
        return true;
      });
    }
    if (P.items !== undefined) {
      const fn = compileNode(interp, P.items, base, memo);
      const start = P.prefixItems !== null ? P.prefixItems.length : 0;
      steps.push((data, errors, instancePath, schemaPath, stack) => {
        if (dataBits(data) !== T_ARRAY) return true;
        let ok = true;
        for (let i = start; i < data.length; i++) {
          if (!fn.c(data[i], errors, instancePath + '/' + i, schemaPath + '/items', stack)) {
            ok = false;
            if (errors === NOERRORS) return false;
          }
        }
        return ok;
      });
      const fv = fn.v;
      vsteps.push((data, stack) => {
        if (dataBits(data) !== T_ARRAY) return true;
        for (let i = start; i < data.length; i++) if (!fv(data[i], stack)) return false;
        return true;
      });
    }
    if (P.contains !== undefined) {
      const fn = compileNode(interp, P.contains, base, memo);
      const minC = P.minContains !== undefined ? P.minContains : 1;
      const maxC = P.maxContains;
      steps.push((data, errors, instancePath, schemaPath, stack) => {
        if (dataBits(data) !== T_ARRAY) return true;
        let matched = 0;
        for (let i = 0; i < data.length; i++) {
          if (fn.v(data[i], stack)) matched++;
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
      vsteps.push((data, stack) => {
        if (dataBits(data) !== T_ARRAY) return true;
        let matched = 0;
        for (let i = 0; i < data.length; i++) {
          if (fn.v(data[i], stack)) { matched++; if (maxC === undefined && matched >= minC) return true; }
        }
        return matched >= minC && (maxC === undefined || matched <= maxC);
      });
    }

    // Objects
    if (P.properties !== null || P.patternProperties !== null || P.additionalProperties !== undefined || P.propertyNames !== undefined) {
      const props = P.properties;
      const propFns = props !== null ? new Map() : null;
      if (props !== null) {
        for (const [key, entry] of props) propFns.set(key, { fn: compileNode(interp, entry.node, base, memo), seg: entry.seg, schemaSeg: entry.schemaSeg });
      }
      const patterns = P.patternProperties !== null
        ? P.patternProperties.map((e) => ({ re: e.re, src: e.src, fn: compileNode(interp, e.node, base, memo) }))
        : null;
      const apFn = P.additionalProperties !== undefined ? compileNode(interp, P.additionalProperties, base, memo) : null;
      const pnFn = P.propertyNames !== undefined ? compileNode(interp, P.propertyNames, base, memo) : null;
      steps.push((data, errors, instancePath, schemaPath, stack) => {
        if (dataBits(data) !== T_OBJECT) return true;
        let ok = true;
        const keys = Object.keys(data);
        if (pnFn !== null) {
          for (const key of keys) {
            if (!pnFn.c(key, errors, instancePath + '/' + escapePointer(key), schemaPath + '/propertyNames', stack)) {
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
          }
        }
        return ok;
      });
      vsteps.push((data, stack) => {
        if (dataBits(data) !== T_OBJECT) return true;
        const keys = Object.keys(data);
        if (pnFn !== null) {
          for (const key of keys) if (!pnFn.v(key, stack)) return false;
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
          }
        }
        return true;
      });
    }
    if (P.dependentSchemas !== null) {
      const entries = P.dependentSchemas.map(([key, v]) => [key, compileNode(interp, v, base, memo), escapePointer(key)]);
      steps.push((data, errors, instancePath, schemaPath, stack) => {
        if (dataBits(data) !== T_OBJECT) return true;
        let ok = true;
        for (const [key, fn, ek] of entries) {
          if (Object.hasOwn(data, key)) {
            if (!fn.c(data, errors, instancePath, schemaPath + '/dependentSchemas/' + ek, stack)) {
              ok = false;
              if (errors === NOERRORS) return false;
            }
          }
        }
        return ok;
      });
      vsteps.push((data, stack) => {
        if (dataBits(data) !== T_OBJECT) return true;
        for (const [key, fn] of entries) {
          if (Object.hasOwn(data, key) && !fn.v(data, stack)) return false;
        }
        return true;
      });
    }
    if (P.propertyDependencies !== null) {
      const entries = P.propertyDependencies.map(([key, choices]) => {
        const m = new Map();
        for (const [value, v] of choices) m.set(value, compileNode(interp, v, base, memo));
        return [key, m];
      });
      steps.push((data, errors, instancePath, schemaPath, stack) => {
        if (dataBits(data) !== T_OBJECT) return true;
        let ok = true;
        for (const [key, choices] of entries) {
          if (!Object.hasOwn(data, key)) continue;
          const value = data[key];
          if (typeof value !== 'string') continue;
          const fn = choices.get(value);
          if (fn === undefined) continue;
          const branchPath = schemaPath + '/propertyDependencies/' + escapePointer(key) + '/' + escapePointer(value);
          if (!fn.c(data, errors, instancePath, branchPath, stack)) {
            ok = false;
            if (errors === NOERRORS) return false;
          }
        }
        return ok;
      });
      vsteps.push((data, stack) => {
        if (dataBits(data) !== T_OBJECT) return true;
        for (const [key, choices] of entries) {
          if (!Object.hasOwn(data, key)) continue;
          const value = data[key];
          if (typeof value !== 'string') continue;
          const fn = choices.get(value);
          if (fn !== undefined && !fn.v(data, stack)) return false;
        }
        return true;
      });
    }

    // In-place applicators
    if (P.allOf !== null) {
      const fns = P.allOf.map((v) => compileNode(interp, v, base, memo));
      steps.push((data, errors, instancePath, schemaPath, stack) => {
        let ok = true;
        for (let i = 0; i < fns.length; i++) {
          if (!fns[i].c(data, errors, instancePath, schemaPath + '/allOf/' + i, stack)) {
            ok = false;
            if (errors === NOERRORS) return false;
          }
        }
        return ok;
      });
      vsteps.push((data, stack) => {
        for (let i = 0; i < fns.length; i++) if (!fns[i].v(data, stack)) return false;
        return true;
      });
    }
    if (P.anyOf !== null) {
      const fns = P.anyOf.map((v) => compileNode(interp, v, base, memo));
      steps.push((data, errors, instancePath, schemaPath, stack) => {
        const scratch = errors === NOERRORS ? NOERRORS : [];
        let any = false;
        for (let i = 0; i < fns.length; i++) {
          if (fns[i].c(data, scratch, instancePath, schemaPath + '/anyOf/' + i, stack)) any = true;
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
      vsteps.push((data, stack) => {
        for (let i = 0; i < fns.length; i++) if (fns[i].v(data, stack)) return true;
        return false;
      });
    }
    if (P.oneOf !== null) {
      const fns = P.oneOf.map((v) => compileNode(interp, v, base, memo));
      steps.push((data, errors, instancePath, schemaPath, stack) => {
        const scratch = errors === NOERRORS ? NOERRORS : [];
        let count = 0;
        for (let i = 0; i < fns.length; i++) {
          if (fns[i].c(data, scratch, instancePath, schemaPath + '/oneOf/' + i, stack)) count++;
        }
        if (count !== 1) {
          if (errors !== NOERRORS) {
            if (count === 0) for (const e of scratch) errors.push(e);
            errors.push(err('oneOf', 'oneOf', instancePath, schemaPath + '/oneOf', { passingSchemas: count }, 'must match exactly one schema in oneOf'));
          }
          return false;
        }
        return true;
      });
      vsteps.push((data, stack) => {
        let count = 0;
        for (let i = 0; i < fns.length; i++) {
          if (fns[i].v(data, stack)) { count++; if (count > 1) return false; }
        }
        return count === 1;
      });
    }
    if (P.not !== undefined) {
      const fn = compileNode(interp, P.not, base, memo);
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
      const ifFn = compileNode(interp, P.if, base, memo);
      const thenFn = P.then !== undefined ? compileNode(interp, P.then, base, memo) : null;
      const elseFn = P.else !== undefined ? compileNode(interp, P.else, base, memo) : null;
      steps.push((data, errors, instancePath, schemaPath, stack) => {
        if (ifFn.v(data, stack)) {
          if (thenFn !== null) return thenFn.c(data, errors, instancePath, schemaPath + '/then', stack);
        } else if (elseFn !== null) {
          return elseFn.c(data, errors, instancePath, schemaPath + '/else', stack);
        }
        return true;
      });
      vsteps.push((data, stack) => {
        if (ifFn.v(data, stack)) {
          if (thenFn !== null) return thenFn.v(data, stack);
        } else if (elseFn !== null) {
          return elseFn.v(data, stack);
        }
        return true;
      });
    }

    let cfn;
    if (steps.length === 0) cfn = TRUE_FN;
    else if (steps.length === 1) cfn = steps[0];
    else {
      const arr = steps;
      cfn = (d, e, ip, sp, st) => {
        let ok = true;
        for (let i = 0; i < arr.length; i++) {
          if (!arr[i](d, e, ip, sp, st)) {
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
      vfn = (d, st) => a(d, st) && b(d, st);
    } else {
      const arr = vsteps;
      vfn = (d, st) => {
        for (let i = 0; i < arr.length; i++) if (!arr[i](d, st)) return false;
        return true;
      };
    }
    box.c = cfn;
    box.v = vfn;
    pair.c = cfn;
    pair.v = vfn;
    perBase.set(base, pair);
    return pair;
  }

  // Entry point: returns a compiled root function or null when the schema is
  // outside the compiler's scope.
  function compileInterpreter(interp) {
    if (!compilable(interp, interp.rootNode, interp.state.rootBase, new Map())) return null;
    return compileNode(interp, interp.rootNode, interp.state.rootBase, new Map());
  }

  return { compileInterpreter };
}

module.exports = { install };
