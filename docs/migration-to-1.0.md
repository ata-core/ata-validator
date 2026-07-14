# Migrating to 1.0

1.0 has two breaking changes. Most projects need no code changes.

## Node.js 20+

`engines.node` is now `>=20.0.0`. Node 18 reached end of life in April 2025.

## Instance AOT methods removed

`Validator.prototype.toStandalone()` and `Validator.prototype.toStandaloneModule()` (deprecated in 0.22.0) are removed. The replacements produce identical output:

Before:

```js
const { Validator } = require('ata-validator');
const v = new Validator(schema);
const src = v.toStandaloneModule({ format: 'esm' });
```

After:

```js
const { toStandaloneModule } = require('ata-validator/build');
const src = toStandaloneModule(schema, { format: 'esm' });
```

`toStandaloneModule()` from `ata-validator/build` accepts either a plain schema or an existing `Validator` instance, so `toStandaloneModule(v, { format: 'esm' })` also works. `bundleStandalone()` and `bundleCompact()` cover the multi-schema cases, and the `ata compile` / `ata build` CLI remains the recommended path for build pipelines.

Everything else, including the error shape, the `richErrors`/`abortEarly` options, the `/t` builder, `/compat`, and the CLI, is unchanged from 0.22.
