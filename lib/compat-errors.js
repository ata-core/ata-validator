'use strict';

// Shapes an error list the way the reference validator reports it, for the
// compat entry. Two things differ between what validate() returns and what
// `require('ajv')` users read off `validate.errors`:
//
// Order. The reference does not follow schema declaration order; it runs
// keywords in a fixed order per node (the type check, the type-less
// keywords, then the number, string, array and object groups, each in the
// order in REFERENCE_ORDER), descending into a subschema when it reaches its
// applicator. Consumers that show only the first error see that order.
//
// Wrapper errors. Where a branch or a subschema fails, the reference reports
// the branch's own errors and then one for the keyword that combined them:
// every failing anyOf/oneOf branch, each failing property name under
// propertyNames, each item under contains (allErrors only), and the `if`
// keyword after a failed then/else (allErrors only). validate() reports the
// combining keyword alone. The shaper re-validates the branch or the value
// against the subschema to recover those errors, so nothing here guesses.
//
// With allErrors off the reference stops at the first failing keyword, but
// that keyword's wrapper group is reported whole: the branch errors and the
// anyOf, or the property name's error and the propertyNames. The same
// grouping is applied here after shaping.

const REFERENCE_ORDER = [
  'type',
  '$dynamicAnchor', '$dynamicRef', '$recursiveAnchor', '$recursiveRef', '$comment', 'id', '$ref',
  'nullable', 'const', 'enum', 'not', 'anyOf', 'oneOf', 'allOf', 'if', 'then', 'else',
  'maximum', 'minimum', 'exclusiveMaximum', 'exclusiveMinimum', 'multipleOf',
  'maxLength', 'minLength', 'pattern', 'format',
  'maxItems', 'minItems', 'additionalItems', 'prefixItems', 'items', 'contains', 'uniqueItems', 'maxContains', 'minContains', 'unevaluatedItems',
  'maxProperties', 'minProperties', 'required', 'propertyNames', 'additionalProperties', 'dependencies', 'dependentRequired', 'dependentSchemas', 'properties', 'patternProperties', 'unevaluatedProperties',
];
const REFERENCE_RANK = new Map(REFERENCE_ORDER.map((k, i) => [k, i]));

// Keywords whose next path segment is a user-chosen name or an index rather
// than a keyword.
const NAMED_SEGMENT = new Set(['properties', 'patternProperties', 'dependencies', 'dependentSchemas', 'dependentRequired', '$defs', 'definitions', 'propertyDependencies']);
const INDEXED_SEGMENT = new Set(['allOf', 'anyOf', 'oneOf', 'prefixItems', 'items', 'additionalItems']);

function unescape(seg) {
  return seg.replace(/~1/g, '/').replace(/~0/g, '~');
}

function pointerOf(schemaPath) {
  const hash = schemaPath.indexOf('#');
  return hash >= 0 ? schemaPath.slice(hash + 1) : schemaPath;
}

function segments(pointer) {
  return pointer === '' ? [] : pointer.split('/').slice(1);
}

// Walks a pointer's segments and reports, per position, whether that segment
// is a keyword or a name/index.
function classify(segs) {
  const kinds = new Array(segs.length);
  let skip = false;
  for (let i = 0; i < segs.length; i++) {
    if (skip) { kinds[i] = 'name'; skip = false; continue; }
    kinds[i] = 'kw';
    const s = segs[i];
    if (NAMED_SEGMENT.has(s)) skip = true;
    else if (INDEXED_SEGMENT.has(s) && /^\d+$/.test(segs[i + 1] || '')) skip = true;
  }
  return kinds;
}

function compareReferenceOrder(a, b) {
  const pa = segments(pointerOf(a.schemaPath || ''));
  const pb = segments(pointerOf(b.schemaPath || ''));
  const ka = classify(pa);
  const n = Math.min(pa.length, pb.length);
  for (let i = 0; i < n; i++) {
    if (pa[i] === pb[i]) continue;
    if (ka[i] !== 'kw') return 0;
    const ra = REFERENCE_RANK.get(pa[i]);
    const rb = REFERENCE_RANK.get(pb[i]);
    if (ra === undefined || rb === undefined) return 0;
    return ra - rb;
  }
  return 0;
}

function sortLikeReference(errors) {
  return errors.length < 2 ? errors : errors.slice().sort(compareReferenceOrder);
}

function walkPointer(node, pointer) {
  for (const raw of segments(pointer)) {
    if (node === null || typeof node !== 'object') return undefined;
    const seg = unescape(raw);
    node = Array.isArray(node) ? node[Number(seg)] : node[seg];
  }
  return node;
}

function walkData(data, instancePath) {
  return walkPointer(data, instancePath);
}

function escapePointer(s) {
  return s.replace(/~/g, '~0').replace(/\//g, '~1');
}

// The keywords whose failure the reference reports after the errors of
// what they combine. Custom keywords with a macro behave the same way and
// validate() already reports them so.
const WRAPPERS = new Set(['anyOf', 'oneOf', 'propertyNames', 'contains', 'not', 'if']);

function createShaper({ Validator, rootId, rootDoc, schemas, options, allErrors, macroKeywords }) {
  const branchCache = new Map();
  const branchValidator = (pointer) => {
    let v = branchCache.get(pointer);
    if (!v) {
      v = new Validator({ $ref: rootId + '#' + pointer }, options);
      branchCache.set(pointer, v);
    }
    return v;
  };
  const wrappers = new Set(WRAPPERS);
  for (const k of macroKeywords) wrappers.add(k);

  // Errors whose schemaPath is already absolute (from the root), as opposed
  // to relative to the branch validator that produced them.
  const absolute = new WeakSet();

  // Returns the shaped errors of `value` against the subschema at `pointer`
  // (absolute), with schemaPath made absolute and instancePath rebased onto
  // the caller's.
  function subErrors(pointer, value, schemaPrefix, instancePrefix) {
    const r = branchValidator(pointer).validate(value);
    if (r.valid) return null;
    const shaped = shape(r.errors, value, pointer);
    return shaped.map((e) => {
      const out = {
        ...e,
        schemaPath: absolute.has(e) ? e.schemaPath : schemaPrefix + pointer + pointerOf(e.schemaPath || '#'),
        instancePath: instancePrefix + (e.instancePath || ''),
      };
      absolute.add(out);
      return out;
    });
  }

  function keywordError(keyword, instancePath, schemaPath, params, message) {
    return { instancePath, schemaPath, keyword, params, message };
  }

  // `basePointer` is where `errors` were produced relative to the root
  // document; a branch validator reports paths relative to its branch.
  function shape(errors, data, basePointer) {
    const sorted = sortLikeReference(errors);
    const out = [];
    const consumed = new Set();
    let thenGroup = null; // { prefix, which } for the pending `if` wrapper

    const flushIf = (e) => {
      if (thenGroup === null) return;
      const segs = segments(pointerOf(e ? e.schemaPath : ''));
      const still = e && segs.length > thenGroup.depth && segs[thenGroup.depth] === thenGroup.which &&
        segs.slice(0, thenGroup.depth).join('/') === thenGroup.prefixSegs;
      if (still) return;
      const ip = thenGroup.instancePath;
      out.push(keywordError('if', ip, thenGroup.schemaPrefix + '/if', { failingKeyword: thenGroup.which }, `must match "${thenGroup.which}" schema`));
      thenGroup = null;
    };

    for (let idx = 0; idx < sorted.length; idx++) {
      const e = sorted[idx];
      if (consumed.has(e)) continue;
      const rel = pointerOf(e.schemaPath || '#');
      const abs = basePointer + rel;
      const segs = segments(rel);
      const kinds = classify(segs);
      const schemaPrefix = (e.schemaPath || '#').slice(0, (e.schemaPath || '#').indexOf('#') + 1);

      if (allErrors) flushIf(e);

      // The `if` wrapper: errors from a then/else subschema are followed by
      // one for `if` (allErrors only, the reference returns before it
      // otherwise).
      if (allErrors && thenGroup === null) {
        for (let i = 0; i < segs.length; i++) {
          if (kinds[i] === 'kw' && (segs[i] === 'then' || segs[i] === 'else')) {
            const prefixSegs = segs.slice(0, i);
            thenGroup = {
              depth: i, which: segs[i], prefixSegs: prefixSegs.join('/'),
              schemaPrefix: schemaPrefix + (prefixSegs.length ? '/' + prefixSegs.join('/') : ''),
              instancePath: e.instancePath,
            };
            break;
          }
        }
      }

      const kw = e.keyword;

      // anyOf / oneOf: report each failing branch's errors first.
      if ((kw === 'anyOf' || kw === 'oneOf') && segs[segs.length - 1] === kw) {
        const branches = walkPointer(rootDoc, abs);
        if (Array.isArray(branches)) {
          const value = walkData(data, e.instancePath || '');
          const branchErrors = [];
          const passing = [];
          for (let i = 0; i < branches.length; i++) {
            const errs = subErrors(abs + '/' + i, value, schemaPrefix, e.instancePath || '');
            if (errs === null) passing.push(i);
            else branchErrors.push(allErrors ? errs : errs.slice(0, groupEnd(errs)));
          }
          if (passing.length === 0) {
            for (const errs of branchErrors) out.push(...errs);
            out.push(e);
          } else if (kw === 'oneOf') {
            out.push({ ...e, params: { passingSchemas: passing }, message: 'must match exactly one schema in oneOf' });
          } else {
            out.push(e);
          }
          continue;
        }
      }

      // propertyNames: the inner errors validate() reports carry no property
      // name. Re-check each name so every failing one is reported with its
      // own errors and a propertyNames error, as the reference does.
      const pnIndex = segs.findIndex((s, i) => kinds[i] === 'kw' && s === 'propertyNames');
      if (pnIndex >= 0 && pnIndex < segs.length - 1) {
        const pnPointer = '/' + segs.slice(0, pnIndex + 1).join('/');
        const pnAbs = basePointer + pnPointer;
        const object = walkData(data, e.instancePath || '');
        if (object && typeof object === 'object' && !Array.isArray(object)) {
          // Everything validate() said about this propertyNames node at this
          // instance is replaced by the regenerated sequence.
          for (let j = idx; j < sorted.length; j++) {
            const o = sorted[j];
            if ((o.instancePath || '') === (e.instancePath || '') && pointerOf(o.schemaPath || '#').startsWith(pnPointer + '/')) consumed.add(o);
          }
          const pnSchemaPath = schemaPrefix + pnPointer;
          for (const name of Object.keys(object)) {
            const errs = subErrors(pnAbs, name, schemaPrefix, e.instancePath || '');
            if (errs === null) continue;
            const kept = allErrors ? errs : errs.slice(0, 1);
            for (const k of kept) out.push({ ...k, instancePath: e.instancePath || '', propertyName: name });
            out.push(keywordError('propertyNames', e.instancePath || '', pnSchemaPath, { propertyName: name }, 'property name must be valid'));
            if (!allErrors) break;
          }
          continue;
        }
      }

      // contains (allErrors only): each item's errors, then the keyword's.
      if (kw === 'contains' && allErrors && segs[segs.length - 1] === 'contains') {
        const items = walkData(data, e.instancePath || '');
        if (Array.isArray(items)) {
          for (let i = 0; i < items.length; i++) {
            const errs = subErrors(abs, items[i], schemaPrefix, (e.instancePath || '') + '/' + i);
            if (errs !== null) out.push(...errs);
          }
          out.push(e);
          continue;
        }
      }

      // draft-07 `dependencies`, which validate() reads as dependentRequired
      // and dependentSchemas: the reference names the original keyword.
      const depIndex = segs.findIndex((s, i) => kinds[i] === 'kw' && (s === 'dependentRequired' || s === 'dependentSchemas'));
      if (depIndex >= 0) {
        const nodePointer = basePointer + (depIndex === 0 ? '' : '/' + segs.slice(0, depIndex).join('/'));
        const node = walkPointer(rootDoc, nodePointer);
        if (node && typeof node === 'object' && node.dependencies && typeof node.dependencies === 'object') {
          const rewritten = segs.slice();
          rewritten[depIndex] = 'dependencies';
          const schemaPath = schemaPrefix + '/' + rewritten.join('/');
          if (segs[depIndex] === 'dependentRequired' && kw === 'required') {
            const missing = e.params && e.params.missingProperty;
            const object = walkData(data, e.instancePath || '');
            let property;
            for (const [prop, deps] of Object.entries(node.dependencies)) {
              if (Array.isArray(deps) && deps.includes(missing) && object && Object.hasOwn(object, prop)) { property = prop; break; }
            }
            const deps = property !== undefined ? node.dependencies[property] : [missing];
            out.push({
              ...e,
              keyword: 'dependencies',
              schemaPath,
              params: { property, missingProperty: missing, depsCount: deps.length, deps: deps.join(', ') },
              message: `must have ${deps.length === 1 ? 'property' : 'properties'} ${deps.join(', ')} when property ${property} is present`,
            });
          } else {
            out.push({ ...e, schemaPath });
          }
          continue;
        }
      }

      out.push(e);
    }
    if (allErrors) flushIf(null);
    return out;
  }

  // Index just past the first error's wrapper group: the first error, plus
  // the errors that share the path of the outermost wrapper reported later
  // for it (the sibling branches and the anyOf, the name's errors and the
  // propertyNames, a macro's schema errors and the macro).
  function groupEnd(shaped) {
    if (shaped.length < 2) return shaped.length;
    const first = shaped[0];
    const firstPath = pointerOf(first.schemaPath || '#');
    let end = 1;
    let wrapperPath = null;
    for (let i = 1; i < shaped.length; i++) {
      const e = shaped[i];
      const p = pointerOf(e.schemaPath || '#');
      if (!wrappers.has(e.keyword)) continue;
      if (firstPath === p || firstPath.startsWith(p + '/')) {
        if (wrapperPath === null || p.length < wrapperPath.length) { wrapperPath = p; end = i + 1; }
      }
    }
    if (wrapperPath === null) return 1;
    // Everything up to the wrapper that lives under its path belongs to
    // the group; anything else reported in between is dropped, as the
    // reference never reached it.
    const group = [];
    for (let i = 0; i < end; i++) {
      const e = shaped[i];
      const p = pointerOf(e.schemaPath || '#');
      if (p === wrapperPath || p.startsWith(wrapperPath + '/')) group.push(e);
    }
    shaped.splice(0, shaped.length, ...group, ...shaped.slice(end));
    return group.length;
  }

  return function shapeErrors(errors, data) {
    const shaped = shape(errors, data, '');
    if (allErrors) return shaped;
    const n = groupEnd(shaped);
    return shaped.slice(0, n);
  };
}

module.exports = { createShaper, sortLikeReference, REFERENCE_ORDER };
