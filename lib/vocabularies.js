'use strict';

// `$vocabulary`, as far as evaluation is concerned.
//
// A dialect is a set of vocabularies, and a vocabulary is a set of keywords.
// When a schema names a custom meta-schema in `$schema`, that meta-schema's
// `$vocabulary` says which vocabularies the dialect has. A keyword whose
// vocabulary is not there is not part of the dialect at all, so it is an
// unknown keyword, and an unknown keyword is ignored. Deleting it is exactly
// that reading, and it means every engine gets this for free rather than each
// of them growing a notion of vocabularies.
//
// The keyword lists are not written out here. Each official vocabulary has a
// meta-schema whose `properties` are precisely that vocabulary's keywords,
// and those documents are already vendored in `metaschemas.js`, so the lists
// come from the specification rather than from someone keeping a copy in
// step with it.
//
// What this deliberately does not do: refuse a schema whose meta-schema
// requires a vocabulary ata does not know. The specification says an
// implementation must refuse there, and ata does not, because until now it
// ignored `$vocabulary` entirely and turning that into a hard failure would
// break schemas which work today. Such a schema is left exactly as it was,
// evaluated with every keyword applied. See `docs/` for the limitation.

const { METASCHEMAS } = require('./metaschemas')

const CORE_VOCABULARY = 'https://json-schema.org/draft/2020-12/vocab/core'

// vocabulary URI -> Set of the keywords it defines, built once on first use.
let KEYWORDS_BY_VOCABULARY = null

function keywordsByVocabulary() {
  if (KEYWORDS_BY_VOCABULARY) return KEYWORDS_BY_VOCABULARY
  const byVocabulary = new Map()
  for (const name of [
    'core',
    'applicator',
    'unevaluated',
    'validation',
    'meta-data',
    'format-annotation',
    'content',
  ]) {
    const meta = METASCHEMAS.get(
      `https://json-schema.org/draft/2020-12/meta/${name}`,
    )
    if (!meta || !meta.properties) continue
    byVocabulary.set(
      `https://json-schema.org/draft/2020-12/vocab/${name}`,
      new Set(Object.keys(meta.properties)),
    )
  }
  // The one vocabulary with no document to read. `format-assertion` is an
  // alternative to `format-annotation` rather than part of the standard
  // dialect, so its meta-schema is not among the vendored ones. It defines
  // the single keyword `format`, which is what the other one defines, and a
  // vocabulary's keyword set does not change once it is published. Without
  // this a meta-schema asking for format assertion, which is the standard
  // way to ask, would be a vocabulary ata does not know and no filtering
  // would happen at all.
  byVocabulary.set(
    'https://json-schema.org/draft/2020-12/vocab/format-assertion',
    new Set(['format']),
  )

  KEYWORDS_BY_VOCABULARY = byVocabulary
  return byVocabulary
}

// Every keyword ata can attribute to a vocabulary. A keyword outside this set
// belongs to no vocabulary ata knows, so `$vocabulary` says nothing about it
// and it is left alone.
function allVocabularyKeywords() {
  const all = new Set()
  for (const keywords of keywordsByVocabulary().values()) {
    for (const keyword of keywords) all.add(keyword)
  }
  return all
}

// Given a meta-schema, the keywords a schema written against it may use, or
// `null` when the question does not arise or cannot be answered:
//
//   - the document declares no `$vocabulary`, so it does not describe a
//     dialect in these terms and every keyword stands
//   - it requires a vocabulary ata does not know, so ata cannot say which
//     keywords the dialect has and does not guess
function enabledKeywords(metaschema) {
  if (!metaschema || typeof metaschema !== 'object') return null
  const vocabularies = metaschema.$vocabulary
  if (!vocabularies || typeof vocabularies !== 'object') return null

  const known = keywordsByVocabulary()
  const enabled = new Set()
  for (const [uri, required] of Object.entries(vocabularies)) {
    const keywords = known.get(uri)
    if (keywords) {
      for (const keyword of keywords) enabled.add(keyword)
    } else if (required === true) {
      return null // a required vocabulary ata cannot account for
    }
  }

  // Core is what makes a document a schema at all: `$ref`, `$defs`, `$id`.
  // A meta-schema which omits it is not describing something ata could
  // evaluate, so treat core as present rather than stripping the plumbing.
  for (const keyword of known.get(CORE_VOCABULARY) || []) enabled.add(keyword)

  // The usual case is a meta-schema which has every vocabulary, and then
  // there is nothing to answer. Saying so here keeps the caller from copying
  // a schema it would not have changed.
  for (const keyword of allVocabularyKeywords()) {
    if (!enabled.has(keyword)) return enabled
  }
  return null
}

// Delete every keyword which belongs to a vocabulary the dialect does not
// have. Mutates, so callers pass a copy.
function stripDisabledKeywords(schema, enabled) {
  const removable = allVocabularyKeywords()
  const disabled = new Set()
  for (const keyword of removable) {
    if (!enabled.has(keyword)) disabled.add(keyword)
  }
  if (disabled.size === 0) return schema
  _strip(schema, disabled, new Set(), true)
  return schema
}

function _strip(schema, disabled, seen, isRoot) {
  if (typeof schema !== 'object' || schema === null) return
  if (Array.isArray(schema)) {
    for (const each of schema) _strip(each, disabled, seen, false)
    return
  }
  if (seen.has(schema)) return
  seen.add(schema)

  // A subschema which names its own `$schema` is its own resource under its
  // own dialect, so this dialect's vocabularies say nothing about it. The
  // root names one by definition, which is how this dialect was chosen.
  if (!isRoot && typeof schema.$schema === 'string') return

  for (const keyword of disabled) {
    if (keyword in schema) delete schema[keyword]
  }

  // Walk what is left. A disabled applicator has already been deleted, so
  // this only descends through subschemas which still apply.
  const objSubs = [
    'properties',
    'patternProperties',
    '$defs',
    'definitions',
    'dependentSchemas',
  ]
  for (const key of objSubs) {
    const box = schema[key]
    if (box && typeof box === 'object' && !Array.isArray(box)) {
      for (const each of Object.values(box)) _strip(each, disabled, seen, false)
    }
  }
  const arrSubs = ['allOf', 'anyOf', 'oneOf', 'prefixItems']
  for (const key of arrSubs) {
    if (Array.isArray(schema[key])) {
      for (const each of schema[key]) _strip(each, disabled, seen, false)
    }
  }
  const singleSubs = [
    'items',
    'additionalItems',
    'contains',
    'not',
    'if',
    'then',
    'else',
    'additionalProperties',
    'propertyNames',
    'unevaluatedItems',
    'unevaluatedProperties',
    'contentSchema',
  ]
  for (const key of singleSubs) {
    const sub = schema[key]
    if (Array.isArray(sub)) {
      for (const each of sub) _strip(each, disabled, seen, false)
    } else {
      _strip(sub, disabled, seen, false)
    }
  }
}

module.exports = {
  enabledKeywords,
  stripDisabledKeywords,
  keywordsByVocabulary,
}
