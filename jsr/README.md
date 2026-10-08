# @ata/validator

The JSON Schema validator `ata-validator`, published to JSR for Deno projects. This package re-exports the npm package of the same version; the engine, the types and the tests are there, and the [npm README](https://www.npmjs.com/package/ata-validator) is the documentation.

```ts
import { Validator } from "jsr:@ata/validator";

const user = new Validator({
  type: "object",
  required: ["email"],
  properties: { email: { type: "string", format: "email" } },
});
const result = user.validate(JSON.parse(body));
if (!result.valid) console.log(result.errors[0].message);
```

Where dynamic code is refused, on Deno Deploy for one, the validator notices and runs its interpreted engine, so the same import works there without a flag. The ahead-of-time compiler is `jsr:@ata/validator/build`.

A version of this package is published after the npm version it points to, so a freshly released version can lag the npm one by a few minutes. Deno's minimum dependency age applies to the npm package underneath: on a release day, `--min-dep-age 0` or `minimumDependencyAge` in `deno.json` is needed to take the newest version.
