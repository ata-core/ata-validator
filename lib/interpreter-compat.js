'use strict';

// What compat reads the reference's way while the interpreted engine walks a
// document: coercion where each `type` is checked, and the discriminator in
// place of `oneOf`. compat installs this (lib/interpreter-core.js, setCompat),
// so an application that never imports compat does not bundle it.

function isDiscriminated(schema) {
  const d = schema.discriminator;
  return d !== null && typeof d === 'object' && typeof d.propertyName === 'string';
}

// The reference's coercion: the first type in the list the value converts to,
// after unwrapping a one-element array in 'array' mode, which then converts
// the element.
const NO_COERCION = Symbol('no coercion');
function fitsType(d, t) {
  switch (t) {
    case 'string': return typeof d === 'string';
    case 'number': return typeof d === 'number' && isFinite(d);
    case 'integer': return typeof d === 'number' && Number.isInteger(d);
    case 'boolean': return typeof d === 'boolean';
    case 'null': return d === null;
    case 'array': return Array.isArray(d);
    case 'object': return d !== null && typeof d === 'object' && !Array.isArray(d);
    default: return false;
  }
}
// Whether an unwrapped element is kept as it is. The reference tests a list
// of types here with every type at once, so a list of two or more keeps
// nothing (`number` stands in for `integer` beside it), and the element goes
// on to be converted, as one of a single type does when it does not fit.
function unwrappedFits(d, types) {
  let list = types;
  if (list.length > 1 && list.includes('number')) list = list.filter((t) => t !== 'integer');
  if (list.length > 1 && list.includes('array') && list.includes('object')) return false;
  for (const t of list) if (!fitsType(d, t)) return false;
  return true;
}
function coerceValue(data, types, arrayMode) {
  if (arrayMode && Array.isArray(data) && data.length === 1) {
    data = data[0];
    if (unwrappedFits(data, types)) return data;
  }
  const kind = data === null ? 'null' : typeof data;
  for (const t of types) {
    switch (t) {
      case 'number':
      case 'integer':
        if (kind === 'boolean' || kind === 'null') return +data;
        // eslint-disable-next-line eqeqeq
        if (kind === 'string' && data !== '' && data == +data && (t === 'number' || !(data % 1))) return +data;
        break;
      case 'string':
        if (kind === 'number' || kind === 'boolean') return '' + data;
        if (kind === 'null') return '';
        break;
      case 'boolean':
        if (data === 'false' || data === 0 || data === null) return false;
        if (data === 'true' || data === 1) return true;
        break;
      case 'null':
        if (data === '' || data === 0 || data === false) return null;
        break;
      case 'array':
        if (arrayMode && (kind === 'string' || kind === 'number' || kind === 'boolean' || kind === 'null')) return [data];
        break;
    }
  }
  return NO_COERCION;
}

module.exports = function install({ NOERRORS, DISCARD, err, mergeAnnotations, dataCtx }) {
  // The discriminator in place of oneOf: the branch the tag names is applied,
  // and a tag that is not a string, or names no branch, is the error.
  function discriminate(interp, P, data, base, dynScope, errors, instancePath, schemaPath, stack, local) {
    const d = discrMap(interp, P, base);
    const tag = data[d.tagName];
    if (typeof tag !== 'string') {
      if (errors !== NOERRORS) errors.push(err('discriminator', 'discriminator', instancePath, schemaPath + '/discriminator', { error: 'tag', tag: d.tagName, tagValue: tag }, `tag "${d.tagName}" must be string`));
      return false;
    }
    const i = d.map.get(tag);
    if (i === undefined) {
      if (errors !== NOERRORS) errors.push(err('discriminator', 'discriminator', instancePath, schemaPath + '/discriminator', { error: 'mapping', tag: d.tagName, tagValue: tag }, `value of tag "${d.tagName}" must be in oneOf`));
      return false;
    }
    const sub = local !== DISCARD ? { props: null, items: null } : DISCARD;
    const ok = interp.eval(P.oneOf[i], data, base, dynScope, errors, instancePath, schemaPath + '/oneOf/' + i, stack, sub);
    if (ok && local !== DISCARD) mergeAnnotations(local, sub);
    return ok;
  }

  // Tag value to branch index, read from each branch's `properties`, through
  // a `$ref`, with the reference's rules: a `const` or `enum` of unique
  // strings, and the tag required by the node or by every branch.
  function discrMap(interp, P, base) {
    if (interp._discr === null) interp._discr = new Map();
    let d = interp._discr.get(P);
    if (d !== undefined) return d;
    const tagName = P.schema.discriminator.propertyName;
    if (P.schema.discriminator.mapping !== undefined) throw new Error('discriminator: mapping is not supported');
    const hasRequired = (s) => s !== null && typeof s === 'object' && Array.isArray(s.required) && s.required.includes(tagName);
    let topRequired = hasRequired(P.schema);
    const map = new Map();
    for (let i = 0; i < P.oneOf.length; i++) {
      let node = P.oneOf[i];
      if (node !== null && typeof node === 'object' && node.ref !== null && node.ref !== undefined && (node.schema.properties === undefined)) {
        const r = interp.resolveRefCached(node, base);
        if (r.child === undefined) throw new Error(`discriminator: cannot resolve $ref ${node.ref}`);
        node = r.child;
      }
      const sch = node !== null && typeof node === 'object' ? node.schema : undefined;
      const propSch = sch && sch.properties ? sch.properties[tagName] : undefined;
      if (propSch === null || typeof propSch !== 'object') throw new Error(`discriminator: oneOf subschemas (or referenced schemas) must have "properties/${tagName}"`);
      topRequired = topRequired || hasRequired(sch);
      const values = propSch.const !== undefined ? [propSch.const] : Array.isArray(propSch.enum) ? propSch.enum : null;
      if (values === null) throw new Error(`discriminator: "properties/${tagName}" must have "const" or "enum"`);
      for (const v of values) {
        if (typeof v !== 'string' || map.has(v)) throw new Error(`discriminator: "${tagName}" values must be unique strings`);
        map.set(v, i);
      }
    }
    if (!topRequired) throw new Error(`discriminator: "${tagName}" must be required`);
    d = { tagName, map };
    interp._discr.set(P, d);
    return d;
  }

  // Coerces the value at `instancePath` to the node's type and writes it where
  // it sits; at the root, where it sits nowhere, the walk carries it on.
  function coerceAt(interp, P, data, instancePath) {
    const to = coerceValue(data, P.typeNames, interp.coerce === 'array');
    if (to === NO_COERCION) return data;
    if (instancePath === '') interp._ctxRoot = to;
    else {
      const ctx = dataCtx(instancePath, '', '');
      if (ctx.parentData !== null && typeof ctx.parentData === 'object') ctx.parentData[ctx.parentDataProperty] = to;
    }
    return to;
  }

  return { isDiscriminated, discriminate, coerceAt };
};
