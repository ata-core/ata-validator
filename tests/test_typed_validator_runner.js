#!/usr/bin/env node
'use strict';

// Runs tsc --noEmit against tests/tsconfig.types.json. Any type error in
// test_typed_validator.ts (including unsatisfied @ts-expect-error markers)
// causes the runner to exit non-zero.

const { spawnSync } = require('child_process');
const path = require('path');

const TSC_JS = require.resolve('typescript/lib/tsc.js');
const TSCONFIG = path.join(__dirname, 'tsconfig.types.json');

const tsc = spawnSync(process.execPath, [TSC_JS, '--project', TSCONFIG], { encoding: 'utf8' });
if (tsc.status !== 0) {
  console.error('FAIL: tsc exited with status', tsc.status);
  if (tsc.stdout) process.stdout.write(tsc.stdout);
  if (tsc.stderr) process.stderr.write(tsc.stderr);
  process.exit(1);
}

console.log('typed Validator types pass');
