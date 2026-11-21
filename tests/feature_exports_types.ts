// Type-checked by tests/test_feature_exports.js: the declarations of
// ata-validator/features and ata-validator/features/<name>.
import { featuresFor, joinFeatures, type FeatureName, type Feature } from 'ata-validator/features'
import { formats } from 'ata-validator/features/formats'
import { uri } from 'ata-validator/features/uri'
import { draft7 } from 'ata-validator/features/draft7'
import { defaults } from 'ata-validator/features/defaults'
import { uniqueItems } from 'ata-validator/features/uniqueItems'
import { branchCollapse } from 'ata-validator/features/branchCollapse'
import { richErrors } from 'ata-validator/features/richErrors'
import { verbose } from 'ata-validator/features/verbose'
import { metaschemas } from 'ata-validator/features/metaschemas'
import { errorMessages } from 'ata-validator/features/errorMessages'
import { coerceTypes } from 'ata-validator/features/coerceTypes'
import { removeAdditional } from 'ata-validator/features/removeAdditional'
import { codegen } from 'ata-validator/features/codegen'
import { formatDateTime } from 'ata-validator/features/formatDateTime'
import { formatUri } from 'ata-validator/features/formatUri'
import { standardSchema } from 'ata-validator/features/standardSchema'
import { patterns } from 'ata-validator/features/patterns'
const names: FeatureName[] = featuresFor({ format: 'date' }, { verbose: true }, [{ $id: 'x' }])
const all: Feature[] = [formats, uri, draft7, defaults, uniqueItems, branchCollapse, richErrors, verbose, metaschemas, errorMessages, coerceTypes, removeAdditional, codegen, formatDateTime, formatUri, standardSchema, patterns]
const pt: Feature<'patterns'> = patterns
const dt: Feature<'formatDateTime'> = formatDateTime
const one: Feature<'formats'> = formats
// @ts-expect-error: not a feature name
const bad: FeatureName = 'nope'
const joined: FeatureName[] = joinFeatures(names, ['formats'], [])
void names; void all; void pt; void one; void bad; void dt; void joined
