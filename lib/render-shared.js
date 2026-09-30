'use strict';

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

// A browser, a Worker or Deno without the Node globals has no `process`, and
// the renderers ship in the browser entry: reading it bare threw a
// ReferenceError there. Without it there is no terminal, so no colour, a
// default width and no working directory to trim.
const proc = typeof process !== 'undefined' ? process : null;

function resolveColor (opt) {
  if (opt === 'never') return false;
  if (opt === 'always') return true;
  if (proc === null) return false;
  const env = proc.env || {};
  if (env.NO_COLOR != null && env.NO_COLOR !== '') return false;
  const fc = env.FORCE_COLOR;
  if (fc === '1' || fc === '2' || fc === '3' || fc === 'true') return true;
  return !!(proc.stdout && proc.stdout.isTTY);
}

function color (enabled, code, s) {
  return enabled ? code + s + ANSI.reset : s;
}

function pathToDotted (jsonPointer) {
  if (!jsonPointer || jsonPointer === '/') return 'body';
  const parts = jsonPointer.replace(/^\//, '').split('/').map(s => s.replace(/~1/g, '/').replace(/~0/g, '~'));
  let out = 'body';
  for (const p of parts) {
    if (/^[0-9]+$/.test(p)) {
      out += '[' + p + ']';
    } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(p)) {
      out += '.' + p;
    } else {
      out += '[' + JSON.stringify(p) + ']';
    }
  }
  return out;
}

function trimCwd (file, cwd) {
  if (!file) return file;
  const c = cwd || (proc !== null && typeof proc.cwd === 'function' ? proc.cwd() : '');
  if (!c) return file;
  if (file.startsWith(c + '/')) return file.slice(c.length + 1);
  return file;
}

function truncateLine (text, maxWidth) {
  if (!text || text.length <= maxWidth) return text;
  return text.slice(0, maxWidth - 1) + '…';
}

function terminalWidth () {
  const w = proc !== null && proc.stdout && proc.stdout.columns;
  return (typeof w === 'number' && w > 0) ? w : 100;
}

module.exports = { ANSI, resolveColor, color, pathToDotted, trimCwd, truncateLine, terminalWidth };
