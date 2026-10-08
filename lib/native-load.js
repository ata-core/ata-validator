'use strict';
const { env } = require('./env');

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
  if (platform === 'darwin') {
    if (arch !== 'x64' && arch !== 'arm64') return null;
    return `@ata-validator/native-darwin-${arch}`;
  }
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

// One literal require per package: a require of a computed name reads as
// dynamic code loading to anyone auditing the package, and bundlers cannot
// see what it resolves to.
function requireNative(name) {
  switch (name) {
    case '@ata-validator/native-darwin-arm64': return require('@ata-validator/native-darwin-arm64');
    case '@ata-validator/native-darwin-x64': return require('@ata-validator/native-darwin-x64');
    case '@ata-validator/native-linux-x64-gnu': return require('@ata-validator/native-linux-x64-gnu');
    case '@ata-validator/native-linux-arm64-gnu': return require('@ata-validator/native-linux-arm64-gnu');
    case '@ata-validator/native-linux-x64-musl': return require('@ata-validator/native-linux-x64-musl');
    case '@ata-validator/native-linux-arm64-musl': return require('@ata-validator/native-linux-arm64-musl');
    case '@ata-validator/native-win32-x64': return require('@ata-validator/native-win32-x64');
    default: return null;
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
  if (env('ATA_NO_NATIVE')) return null;

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
      const binding = checkVersion(requireNative(name), name);
      if (binding) return binding;
    } catch {
      // not installed on this platform; keep going
    }
  }

  // Contributors running from a source checkout.
  try {
    const binding = checkVersion(require('../build/Release/ata.node'), 'local build');
    if (binding) return binding;
  } catch {
    // no dev build; fall through
  }

  return null;
};

module.exports.nativePackageName = nativePackageName;
