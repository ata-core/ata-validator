# Contributing to ata-validator

Thanks for your interest. Here's how to get started.

## Setup

```bash
git clone https://github.com/ata-core/ata-validator.git
cd ata-validator
npm install
npm run build
```

## Running Tests

Before submitting a PR, all four of these must pass. CI runs the same ones.

```bash
npm test                     # unit and integration tests
npm run test:suite           # official JSON Schema Test Suite: 2020-12, draft 7 and the v1 dialect
node tests/test_no_eval.js   # the whole suite again with eval and new Function blocked
npm run release:check        # package contents, error-code lock, version sync
```

The suite must stay at zero failures on all three dialects.

## Tests for changes

Every bug fix comes with a test that fails without the fix, and every new
feature comes with tests for it. Add the test file to the `npm test` chain in
`package.json`. A test that only proves something if it actually ran a check
should assert how many checks it ran, so it cannot pass by doing nothing.

## Running Benchmarks

```bash
node benchmark/bench_vs_ajv.js
```

If your change affects performance, include before/after numbers in the PR description. We care about:
- validate(obj) valid/invalid ops/sec
- isValidObject ops/sec
- Constructor and first validation time
- No regressions on any metric

## How We Work

**Profile first, optimize second.** We use Daniel Lemire's approach: measure each part, find the bottleneck, fix it, measure again. Don't guess where the slowness is.

**Test before and after.** Every optimization should have numbers. "I think this is faster" is not enough.

**Keep it simple.** If you can get 80% of the gain with 20% of the complexity, do that. We prefer readable code over clever tricks.

**Don't break the API.** `new Validator(schema)`, `validate()`, `isValidObject()`, `toStandalone()` should keep working exactly as before.

## What We're Looking For

- Performance improvements with benchmark proof
- Spec compliance fixes and cases the official test suite does not cover
- Bug fixes with test cases
- Documentation improvements

## What to Avoid

- Breaking changes to the public API
- Adding dependencies (we keep the dep count minimal)
- Cosmetic refactors without functional improvement
- Benchmark numbers without methodology (always share the code and how you measured)

## Code Style

No strict linter. Just match the existing style. Single quotes in the C++ side, double quotes in JS side are fine.

## PR Process

1. Fork and branch from `master`
2. Make your change
3. Run all tests
4. Run benchmarks if performance-related
5. Open a PR with a clear description of what and why

We review quickly. Small focused PRs are easier to review than large ones.

## Questions?

Open an issue or reach out to [@mecaltin](https://x.com/mecaltin).
