'use strict';

const { color, ANSI, resolveColor, trimCwd } = require('./render-shared');
const { toDiagnostics } = require('./diagnose');

const DIAGNOSTIC_SOURCE = Symbol.for('ata.diagnosticSource');

function renderCompact (errors, opts) {
  if (!Array.isArray(errors) || errors.length === 0) return '';
  opts = opts || {};
  const useColor = resolveColor(opts.color || 'auto');
  const cwd = opts.cwd;
  const carried = errors[DIAGNOSTIC_SOURCE] || {};
  const source = opts.data !== undefined ? Object.assign({}, carried, { data: opts.data }) : carried;
  const diags = toDiagnostics(errors, source);
  const lines = [];

  for (const d of diags) {
    let prefix = '';
    const raw = d.mergedFrom[0];
    if (raw && raw.schemaSource) {
      const f = trimCwd(raw.schemaSource.file, cwd);
      prefix = color(useColor, ANSI.cyan, `${f}:${raw.schemaSource.line}:${raw.schemaSource.col}`) + ' - ';
    }
    const codeStr = color(useColor, ANSI.red + ANSI.bold, d.code ? `error ${d.code}` : 'error');
    const pathStr = color(useColor, ANSI.cyan, d.dotted);
    const got = raw && raw.received != null ? `got ${raw.received}` : '';
    const sugg = d.help ? color(useColor, ANSI.yellow, `, ${d.help}`) : '';
    const tail = got || sugg ? ` (${got}${sugg})` : '';
    lines.push(`${prefix}${codeStr}: ${pathStr} ${d.headline}${tail}`);
  }

  const n = errors.length;
  const shown = diags.length;
  lines.push('');
  let summary = `Found ${n} error${n === 1 ? '' : 's'} in ${opts.context || 'input'}`;
  if (shown !== n) summary += `, shown as ${shown} diagnostic${shown === 1 ? '' : 's'}`;
  lines.push(summary + '.');
  if (!(process.stdout && process.stdout.isTTY)) {
    lines.push('(run with --pretty for source frames)');
  }
  return lines.join('\n');
}

module.exports = { renderCompact };
