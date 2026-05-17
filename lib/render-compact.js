'use strict';

const { color, ANSI, resolveColor, pathToDotted, trimCwd } = require('./render-shared');

function renderCompact (errors, opts) {
  if (!Array.isArray(errors) || errors.length === 0) return '';
  opts = opts || {};
  const useColor = resolveColor(opts.color || 'auto');
  const cwd = opts.cwd;
  const lines = [];

  for (const err of errors) {
    let prefix = '';
    if (err.schemaSource) {
      const f = trimCwd(err.schemaSource.file, cwd);
      prefix = color(useColor, ANSI.cyan, `${f}:${err.schemaSource.line}:${err.schemaSource.col}`) + ' - ';
    }
    const codeStr = color(useColor, ANSI.red + ANSI.bold, `error ${err.code}`);
    const pathStr = color(useColor, ANSI.cyan, pathToDotted(err.path));
    const got = err.received != null ? `got ${err.received}` : '';
    const sugg = err.suggestion ? color(useColor, ANSI.yellow, `, ${err.suggestion.text}`) : '';
    const tail = got || sugg ? ` (${got}${sugg})` : '';
    lines.push(`${prefix}${codeStr}: ${pathStr} ${err.message}${tail}`);
  }

  const n = errors.length;
  lines.push('');
  lines.push(`Found ${n} error${n === 1 ? '' : 's'} in ${opts.context || 'input'}.`);
  if (!(process.stdout && process.stdout.isTTY)) {
    lines.push('(run with --pretty for source frames)');
  }
  return lines.join('\n');
}

module.exports = { renderCompact };
