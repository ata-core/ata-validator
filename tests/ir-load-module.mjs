// Compile a schema to a module with lib/ir/emit.mjs and load it, for the tests
// and the differentials: written to a temporary directory, importing the
// kernels by file URL. It lives here and not in emit.mjs so the module writer
// imports nothing from Node and bundles for a browser.
import { writeFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { specialize, functionBody } from '../lib/ir/emit.mjs'
import * as KERNELS from '../lib/kernels/index.mjs'
import { createRequire } from 'node:module'
// The runtime's generated defaults pass, as the build plugin hands it.
const { defaultsSource } = createRequire(import.meta.url)('../lib/aot-build.js')

const kernels = pathToFileURL(fileURLToPath(new URL('../lib/kernels/index.mjs', import.meta.url))).href
let dir = null
let n = 0
export async function compile (schema, opts = {}) {
  if (dir === null) dir = mkdtempSync(join(tmpdir(), 'ata-ir-'))
  const file = join(dir, 'm' + (++n) + '.mjs')
  writeFileSync(file, specialize(schema, { from: kernels, verdict: opts.verdict === true, assertFormat: opts.assertFormat !== false, useDefaults: opts.useDefaults, schemas: opts.schemas, metaschemas: opts.metaschemas, richErrors: opts.richErrors, fillSource: opts.fillSource === false ? undefined : defaultsSource }))
  return import(pathToFileURL(file).href)
}

// The same module as a function of the kernels object (functionBody), the
// form a page that may evaluate code but imports no module from a string uses.
export function compileFunction (schema, opts = {}) {
  const src = specialize(schema, { assertFormat: opts.assertFormat !== false, useDefaults: opts.useDefaults, schemas: opts.schemas, metaschemas: opts.metaschemas, richErrors: opts.richErrors })
  return new Function('K', functionBody(src))(KERNELS)
}
