'use strict';

const { color, ANSI, resolveColor, trimCwd, truncateLine, terminalWidth } = require('./render-shared');

function caretLine (col, length, gutter) {
  const pad = ' '.repeat(gutter);
  const lead = ' '.repeat(Math.max(0, col - 1));
  const carets = '^'.repeat(Math.max(1, length || 1));
  return pad + '| ' + lead + carets;
}

function renderOne (err, useColor, opts) {
  const lines = [];
  const cwd = opts.cwd;
  const width = terminalWidth();
  const gutter = 3;

  // Headline
  const headline = `${err.message}`;
  lines.push(color(useColor, ANSI.red + ANSI.bold, `error[${err.code}]: `) + headline);

  // Schema source frame
  if (err.schemaSource) {
    const f = trimCwd(err.schemaSource.file, cwd);
    lines.push(`  --> ${color(useColor, ANSI.cyan, `${f}:${err.schemaSource.line}:${err.schemaSource.col}`)}`);
    lines.push('   |');
    const ln = String(err.schemaSource.line).padStart(2, ' ');
    const srcText = truncateLine(err.schemaSource.text, width - 8);
    lines.push(` ${ln} | ${srcText}`);
    const inlineHint = err.expected ? '  ' + color(useColor, ANSI.dim, `expected ${err.expected}`) : '';
    lines.push(caretLine(err.schemaSource.col, 1, gutter) + inlineHint);
    lines.push('   |');
  }

  // Data frame
  if (err.dataFrame) {
    lines.push(`  --> ${color(useColor, ANSI.dim, `input, byte ${err.dataFrame.byteOffset}`)}`);
    lines.push('   |');
    const ln = String(err.dataFrame.line).padStart(2, ' ');
    const srcText = truncateLine(err.dataFrame.text, width - 8);
    lines.push(` ${ln} | ${srcText}`);
    const got = err.received != null ? '  ' + color(useColor, ANSI.dim, `got ${err.received}`) : '';
    lines.push(caretLine(err.dataFrame.col, err.dataFrame.length, gutter) + got);
    lines.push('   |');
  }

  if (err.suggestion) {
    lines.push('   = ' + color(useColor, ANSI.yellow, 'help: ') + err.suggestion.text);
  }
  if (err.docUrl) {
    lines.push('   = ' + color(useColor, ANSI.dim, 'note: see ') + err.docUrl);
  }
  return lines.join('\n');
}

function renderPretty (errors, opts) {
  if (!Array.isArray(errors) || errors.length === 0) return '';
  opts = opts || {};
  const useColor = resolveColor(opts.color || 'auto');
  const maxErrors = opts.maxErrors != null ? opts.maxErrors : 20;
  const context = opts.context || 'input';

  const blocks = [];
  const limit = maxErrors === 0 ? errors.length : Math.min(maxErrors, errors.length);
  for (let i = 0; i < limit; i++) {
    blocks.push(renderOne(errors[i], useColor, opts));
  }
  let out = blocks.join('\n\n');
  if (limit < errors.length) {
    out += `\n\n... and ${errors.length - limit} more errors (run with --pretty --max-errors=0 to see all)`;
  }
  const n = errors.length;
  out += `\n\n` + color(useColor, ANSI.red + ANSI.bold, `error: `) + `${n} schema violation${n === 1 ? '' : 's'} in ${context}`;
  return out;
}

module.exports = { renderPretty };
