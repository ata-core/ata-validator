'use strict';

// Locate the optional native engine. Resolution order:
//   1. ATA_NO_NATIVE set        -> null (explicit pure-JS mode)
//   2. @ata-validator/native-*  -> the per-platform optional package
//   3. other libc variant       -> linux only, in case detection misfired
//   4. repo-local dev build     -> contributors working from source
//   5. null                     -> JS codegen covers all core validation
//
// Lives in its own module so the default and browser entries stay free of
// platform probing; browser bundles swap this file for
// `native-load.browser.js` via the package.json `browser` field.

const VERSION = require('./version');

function nativePackageName(platform, arch, isMusl) {
  if (platform === 'darwin') return arch === 'arm64' ? '@ata-validator/native-darwin-arm64' : null;
  if (platform === 'win32') return arch === 'x64' ? '@ata-validator/native-win32-x64' : null;
  if (platform === 'linux') {
    if (arch !== 'x64' && arch !== 'arm64') return null;
    return `@ata-validator/native-linux-${arch}-${isMusl ? 'musl' : 'gnu'}`;
  }
  return null;
}

function detectMusl() {
  // glibc exposes its version in the process report header; musl does not.
  try {
    const report = process.report && process.report.getReport && process.report.getReport();
    return !!report && !!report.header && !report.header.glibcVersionRuntime;
  } catch {
    return false;
  }
}

let warned = false;
function checkVersion(binding, source) {
  if (!binding) return null;
  try {
    const v = typeof binding.version === 'function' ? binding.version() : null;
    if (v && v !== VERSION) {
      if (!warned) {
        warned = true;
        process.emitWarning(
          `ata-validator ${VERSION} found a native engine reporting ${v} (${source}); ` +
          'ignoring it and using the pure-JS engine. Reinstall to realign versions.',
        );
      }
      return null;
    }
  } catch {
    return null;
  }
  return binding;
}

module.exports = function loadNative() {
  if (process.env.ATA_NO_NATIVE) return null;

  const isMusl = process.platform === 'linux' ? detectMusl() : false;
  const candidates = [];
  const primary = nativePackageName(process.platform, process.arch, isMusl);
  if (primary) candidates.push(primary);
  if (process.platform === 'linux') {
    const alt = nativePackageName(process.platform, process.arch, !isMusl);
    if (alt) candidates.push(alt);
  }

  for (const name of candidates) {
    try {
      const binding = checkVersion(require(name), name);
      if (binding) return binding;
    } catch {
      // not installed on this platform; keep going
    }
  }

  // Contributors running from a source checkout.
  try {
    const path = require('path');
    const binding = checkVersion(
      require(path.join(__dirname, '..', 'build', 'Release', 'ata.node')),
      'local build',
    );
    if (binding) return binding;
  } catch {
    // no dev build; fall through
  }

  return null;
};

module.exports.nativePackageName = nativePackageName;
