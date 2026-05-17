'use strict';

const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

function resolveColor (opt) {
  if (opt === 'never') return false;
  if (opt === 'always') return true;
  if (process.env.NO_COLOR != null && process.env.NO_COLOR !== '') return false;
  const fc = process.env.FORCE_COLOR;
  if (fc === '1' || fc === '2' || fc === '3' || fc === 'true') return true;
  return !!(process.stdout && process.stdout.isTTY);
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
  const c = cwd || process.cwd();
  if (file.startsWith(c + '/')) return file.slice(c.length + 1);
  return file;
}

function truncateLine (text, maxWidth) {
  if (!text || text.length <= maxWidth) return text;
  return text.slice(0, maxWidth - 1) + '…';
}

function terminalWidth () {
  const w = process.stdout && process.stdout.columns;
  return (typeof w === 'number' && w > 0) ? w : 100;
}

module.exports = { ANSI, resolveColor, color, pathToDotted, trimCwd, truncateLine, terminalWidth };
