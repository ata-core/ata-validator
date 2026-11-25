'use strict'

// The two walks of lib/js-compiler.js that only a schema compiled with a
// registry needs, read by the first such schema. The generator hands over its
// own crossDocTarget, subtreeHasLocalRef and keyword lists.
let crossDocTarget, subtreeHasLocalRef, SUBSCHEMA_MAPS, SUBSCHEMA_LISTS, SUBSCHEMA_SINGLES

// Whether a reference resolves only against an enclosing base, which neither
// JS path tracks (needsBaseTracking).
function refsAreScopeSensitive(node, schemaMap, seen) {
  if (typeof node !== 'object' || node === null || Array.isArray(node)) return false
  if (seen.has(node)) return false
  seen.add(node)

  const ref = node.$ref
  if (typeof ref === 'string' && !ref.startsWith('#')) {
    const key = ref.split('#')[0]
    // A key the registry holds verbatim needs no base to resolve: this is the
    // flat-registry case ($ref: 'shared#'). Anything else that is not absolute
    // only resolves by walking up from an enclosing base.
    if (!schemaMap.has(key) && !ref.includes('://')) return true
    const target = crossDocTarget(ref, schemaMap)
    if (target && typeof target === 'object') {
      // Registered under a key that differs from the $id it declares, so its
      // own references resolve against a different base than its retrieval URI.
      if (typeof target.$id === 'string' && target.$id !== key) return true
      if (subtreeHasLocalRef(target, new Set()) && refsAreScopeSensitive(target, schemaMap, seen)) return true
    }
  }

  for (const key of SUBSCHEMA_MAPS) {
    const group = node[key]
    if (group && typeof group === 'object' && !Array.isArray(group)) {
      for (const sub of Object.values(group)) if (refsAreScopeSensitive(sub, schemaMap, seen)) return true
    }
  }
  for (const key of SUBSCHEMA_LISTS) {
    if (Array.isArray(node[key])) {
      for (const sub of node[key]) if (refsAreScopeSensitive(sub, schemaMap, seen)) return true
    }
  }
  for (const key of SUBSCHEMA_SINGLES) {
    if (Array.isArray(node[key])) {
      for (const sub of node[key]) if (refsAreScopeSensitive(sub, schemaMap, seen)) return true
    } else if (refsAreScopeSensitive(node[key], schemaMap, seen)) return true
  }
  return false
}

// The generators look a cross-document reference up by string (crossDocTarget):
// an exact registry key, or a key ending in "/" + the reference. The
// interpreted engine resolves it against the base URI of the document that
// holds it. prepareForCodegen turns every reference the interpreter resolves
// into a local one, but gives up on the whole schema when one does not
// resolve, and the references then reach the generators as written. Inside a
// registered document reached through another, a reference the registry
// could not satisfy emitted no check, and one whose file name matched a
// document on another host bound to that document. Both accepted what the
// interpreter rejects.
//
// This walks every schema reachable from the root, following each
// cross-document reference into the part of the target it names, with the
// interpreter's own resolver (indexSchemas and resolveRef) at the base each
// node has there. A reference the interpreter cannot resolve, or one the
// generators would bind to anything else, declines the schema: 'unresolved'
// or 'target', null when every one agrees. Each node is walked once per base,
// so a document referenced from many places costs one walk. Fragment-only
// references are left to hasUnresolvableRef and refsAreScopeSensitive, which
// already decline them inside another document.
let _bindSchema = null, _bindMap = null, _bindSize = -1, _bindResult = null
function refBindingsDiffer(schema, schemaMap) {
  // needsBaseTracking runs in the shared gate and again in each entry point.
  if (schema === _bindSchema && schemaMap === _bindMap && schemaMap.size === _bindSize) return _bindResult
  const result = refBindingsDifferUncached(schema, schemaMap)
  _bindSchema = schema; _bindMap = schemaMap; _bindSize = schemaMap.size; _bindResult = result
  return result
}
function refBindingsDifferUncached(schema, schemaMap) {
  let state = null
  let R = null
  const walked = new Map() // node -> Set of bases it was walked at
  let local = false
  const stack = [[schema, null]]
  while (stack.length) {
    const [node, at] = stack.pop()
    if (typeof node !== 'object' || node === null || Array.isArray(node)) continue
    const ref = node.$ref
    // The interpreter is indexed at the first reference that needs it: most
    // schemas that reach here have none.
    if (state === null && typeof ref === 'string' && !ref.startsWith('#')) {
      R = require('./interpreter')._refInternals
      try { state = R.indexSchemas(schema, schemaMap) } catch { return 'unresolved' }
    }
    const base = state === null ? at : (state.nodeBase.get(node) || at || state.rootBase)
    let bases = walked.get(node)
    if (bases === undefined) walked.set(node, (bases = new Set()))
    if (bases.has(base)) continue
    bases.add(base)
    // A fragment-only reference in another document: the generators read it
    // against the root's definitions. The first hop is declined by
    // hasUnresolvableRef; one two documents away was not, and bound to the
    // root's definition of the same name. Reported as 'local', which only
    // the generators decline: compileToJS compiles each document it reaches
    // as a root of its own, so such a reference reads its own definitions.
    if (typeof ref === 'string' && ref.startsWith('#') && state !== null && base !== state.rootBase) local = true
    if (typeof ref === 'string' && !ref.startsWith('#')) {
      let found
      try { found = R.resolveRef(ref, base, state) } catch { return 'unresolved' }
      if (found.node === undefined || found.node === null) return 'unresolved'
      if (crossDocTarget(ref, schemaMap) !== found.node) return 'target'
      const t = found.node
      if (typeof t === 'object') stack.push([t, state.nodeBase.get(t) || found.base])
    }
    for (const key of SUBSCHEMA_MAPS) {
      const group = node[key]
      if (group && typeof group === 'object' && !Array.isArray(group)) for (const sub of Object.values(group)) stack.push([sub, base])
    }
    for (const key of SUBSCHEMA_LISTS) if (Array.isArray(node[key])) for (const sub of node[key]) stack.push([sub, base])
    for (const key of SUBSCHEMA_SINGLES) {
      const sub = node[key]
      if (Array.isArray(sub)) for (const s of sub) stack.push([s, base])
      else stack.push([sub, base])
    }
    if (node.dependencies && typeof node.dependencies === 'object' && !Array.isArray(node.dependencies)) {
      for (const sub of Object.values(node.dependencies)) if (!Array.isArray(sub)) stack.push([sub, base])
    }
  }
  return local ? 'local' : null
}

function bind (target, localRef, maps, lists, singles) {
  crossDocTarget = target; subtreeHasLocalRef = localRef
  SUBSCHEMA_MAPS = maps; SUBSCHEMA_LISTS = lists; SUBSCHEMA_SINGLES = singles
  return { refBindingsDiffer, refsAreScopeSensitive }
}

module.exports = { bind }
