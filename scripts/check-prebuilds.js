'use strict';

// Refuse to publish a tarball that is missing platform prebuilds.
// Local `npm publish` only carries whatever the publisher's machine built,
// which silently drops every other platform's prebuild from the tarball.
// Publishing must go through the release workflow so all platforms are present.

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const required = [
  'ata-linux-x64',
  'ata-linux-arm64',
  'ata-linux-x64-musl',
  'ata-linux-arm64-musl',
  'ata-darwin-arm64',
  'ata-darwin-x64',
  'ata-win32-x64',
];

const root = path.resolve(__dirname, '..');
const missing = required.filter(
  (dir) => !fs.existsSync(path.join(root, 'prebuilds', dir, 'node-napi-v10.node')),
);

if (missing.length) {
  console.error(
    '\n[ata-validator] Refusing to publish, missing prebuilds:\n' +
      missing.map((d) => '  - ' + d).join('\n') +
      '\n\nPublish through the GitHub release workflow so every platform is built.\n',
  );
  process.exit(1);
}

// When publishing from a Mac, verify the darwin code signatures too. strip
// invalidates the linker signature, and an unsigned arm64 addon is killed on
// load. The release workflow re-signs and verifies, this is the local net.
if (process.platform === 'darwin') {
  for (const dir of required) {
    if (!dir.startsWith('ata-darwin-')) continue;
    const f = path.join(root, 'prebuilds', dir, 'node-napi-v10.node');
    const r = cp.spawnSync('codesign', ['--verify', f], { encoding: 'utf8' });
    if (r.status !== 0) {
      console.error(
        '\n[ata-validator] Refusing to publish, invalid code signature:\n' +
          '  ' + f + '\n' + (r.stderr || '').trim() +
          '\n\nRe-sign with: codesign --force --sign - "' + f + '"\n',
      );
      process.exit(1);
    }
  }
}

console.log('[ata-validator] prebuilds present for all ' + required.length + ' platforms');
