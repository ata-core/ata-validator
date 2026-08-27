'use strict';

const { color, ANSI, resolveColor, trimCwd, truncateLine, terminalWidth } = require('./render-shared');
const { toDiagnostics } = require('./diagnose');

const DIAGNOSTIC_SOURCE = Symbol.for('ata.diagnosticSource');

function sourceFor (errors, opts) {
  const carried = errors[DIAGNOSTIC_SOURCE] || {};
  if (opts.data !== undefined) return Object.assign({}, carried, { data: opts.data });
  return carried;
}

// Never wider than the terminal. The old form repeated the caret for the
// full span of the value, which for a root-level error was the whole
// document drawn under a one-character line.
function caretLine (col, length, gutter) {
  const pad = ' '.repeat(gutter);
  const lead = ' '.repeat(Math.max(0, col - 1));
  const carets = '^'.repeat(Math.max(1, Math.min(length || 1, terminalWidth())));
  return pad + '| ' + lead + carets;
}

// What sits beside the caret. For a value error, the value that was found.
// For a missing property there is no value to show, and the useful fact is
// what was expected. For errors about the container's shape or about which
// branch matched, printing the whole container is noise, so nothing.
const NO_SUFFIX = new Set(['additionalProperties', 'unevaluatedProperties', 'unevaluatedItems', 'dependentRequired', 'propertyNames', 'oneOf', 'anyOf', 'allOf', 'not']);
function caretSuffix (d, raw, useColor) {
  if (!raw) return '';
  if (raw.keyword === 'required') {
    return raw.expected ? '  ' + color(useColor, ANSI.dim, `expected ${raw.expected}`) : '';
  }
  // A composition error anchored inside the closest branch has a value there.
  if (d.found != null && (raw.keyword === 'oneOf' || raw.keyword === 'anyOf')) {
    return '  ' + color(useColor, ANSI.dim, `found ${d.found}`);
  }
  if (NO_SUFFIX.has(raw.keyword)) return '';
  return d.found != null ? '  ' + color(useColor, ANSI.dim, `found ${d.found}`) : '';
}

function renderOne (d, useColor, opts) {
  const lines = [];
  const width = terminalWidth();
  const gutter = 3;

  // Headline carries the code when there is one. A code-less error, which the
  // LazyRejection fallback can produce, must not render as "error[undefined]".
  const label = d.code ? `error[${d.code}]: ` : 'error: ';
  lines.push(color(useColor, ANSI.red + ANSI.bold, label) + d.headline);

  // Schema source frame, when the Validator was built with a `source` option.
  // This is the part that makes the output read like a compiler, and it must
  // survive the rewrite: it points at the rule, where the data frame below
  // points at the value.
  const raw = d.mergedFrom[0];
  if (raw && raw.schemaSource) {
    const f = trimCwd(raw.schemaSource.file, opts.cwd);
    lines.push(`  --> ${color(useColor, ANSI.cyan, `${f}:${raw.schemaSource.line}:${raw.schemaSource.col}`)}`);
    lines.push('   |');
    const sln = String(raw.schemaSource.line).padStart(2, ' ');
    lines.push(` ${sln} | ${truncateLine(raw.schemaSource.text, width - 8)}`);
    const inlineHint = raw.expected ? '  ' + color(useColor, ANSI.dim, `expected ${raw.expected}`) : '';
    lines.push(caretLine(raw.schemaSource.col, 1, gutter) + inlineHint);
    lines.push('   |');
  }

  // Data location, always, even without a frame. This is the single most
  // common reason today's output cannot be acted on.
  if (d.frame) {
    const where = `input:${d.frame.line}:${d.frame.col}`;
    lines.push(`  --> ${color(useColor, ANSI.cyan, where)}  ${color(useColor, ANSI.dim, '(' + d.dotted + ')')}`);
    lines.push('   |');
    const ln = String(d.frame.line).padStart(2, ' ');
    lines.push(` ${ln} | ${truncateLine(d.frame.text, width - 8)}`);
    lines.push(caretLine(d.frame.col, d.frame.length, gutter) + caretSuffix(d, raw, useColor));
    lines.push('   |');
  } else {
    lines.push(`  --> ${color(useColor, ANSI.cyan, 'at ' + d.dotted)}`);
  }

  if (d.help) lines.push('   = ' + color(useColor, ANSI.yellow, 'help: ') + d.help);
  if (d.branchErrors && d.branchErrors.length) {
    const variant = (raw && raw.params && raw.params.closestName) || 'closest variant';
    const n = d.branchErrors.length;
    lines.push('   = ' + color(useColor, ANSI.dim, 'note: ') + `closest match was ${variant} with ${n} error${n === 1 ? '' : 's'}:`);
    renderBranchErrors(d.branchErrors, 1, lines, useColor);
  }
  for (const note of d.notes) {
    lines.push('   = ' + color(useColor, ANSI.dim, 'note: ') + note);
  }
  return lines.join('\n');
}

// Render nested branchErrors with a depth cap. Stops recursing past depth 3
// and emits a placeholder. Keeps pretty output bounded for deeply nested
// oneOf chains while preserving the structured payload for JSON consumers.
function renderBranchErrors (subs, depth, lines, useColor) {
  if (depth >= 3) {
    lines.push('       ' + color(useColor, ANSI.dim, '... deeper branch errors omitted, see structured output'));
    return;
  }
  const max = 3;
  const shown = subs.slice(0, max);
  for (const sub of shown) {
    // Observation first when the branch error carries one; the rule otherwise.
    let text = sub.message || '';
    if (sub.expected !== undefined) {
      text = `expected ${sub.expected}` + (sub.received !== undefined ? `, found ${sub.received}` : '');
    }
    lines.push('       ' + color(useColor, ANSI.dim, `${sub.keyword}: ${text}`));
    if (sub.branchErrors && sub.branchErrors.length) renderBranchErrors(sub.branchErrors, depth + 1, lines, useColor);
  }
  if (subs.length > max) {
    lines.push('       ' + color(useColor, ANSI.dim, `... and ${subs.length - max} more`));
  }
}

function renderPretty (errors, opts) {
  if (!Array.isArray(errors) || errors.length === 0) return '';
  opts = opts || {};
  const useColor = resolveColor(opts.color || 'auto');
  const maxErrors = opts.maxErrors != null ? opts.maxErrors : 20;
  const context = opts.context || 'input';

  const diags = toDiagnostics(errors, sourceFor(errors, opts));

  const blocks = [];
  const limit = maxErrors === 0 ? diags.length : Math.min(maxErrors, diags.length);
  for (let i = 0; i < limit; i++) blocks.push(renderOne(diags[i], useColor, opts));

  let out = blocks.join('\n\n');
  if (limit < diags.length) {
    out += `\n\n... and ${diags.length - limit} more errors (run with --pretty --max-errors=0 to see all)`;
  }
  // The count never drifts from errors.length. When correlation collapsed a
  // pair the second clause says so, so the reader can reconcile the two.
  const n = errors.length;
  const shown = diags.length;
  let summary = `${n} schema violation${n === 1 ? '' : 's'} in ${context}`;
  if (shown !== n) summary += `, shown as ${shown} diagnostic${shown === 1 ? '' : 's'}`;
  out += '\n\n' + color(useColor, ANSI.red + ANSI.bold, 'error: ') + summary;
  // Said once, not under every block. The reader needs to know their line
  // numbers will not match a file, and needs to be told one time.
  if (diags.some((d) => d.frame && d.frame.synthesized)) {
    out += '\n' + color(useColor, ANSI.dim, 'note: frames were reconstructed from the value, not from your input text; line numbers refer to that reconstruction');
  }
  return out;
}

module.exports = { renderPretty };
