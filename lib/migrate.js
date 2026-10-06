'use strict';

// `ata migrate`: what switching a project from ajv to ata-validator/compat
// would change, and what it cannot translate. The report comes first and
// touches nothing; `--write` applies only the two mechanical rewrites (the
// import specifier, and the `addFormats()` call compat refuses on purpose),
// so a site the report flags is never changed behind the reader's back.
//
// Sources are read through a small masker that blanks comments and the
// insides of string and template literals, so a specifier is matched only
// where it is code: `require('ajv')` in a comment or in a longer string is
// not an import. Regular expression literals are not recognised; a pattern
// such as /from 'ajv'/ would be read as code, which only ever adds a line to
// the report, never a rewrite the report did not show.

const fs = require('node:fs');
const path = require('node:path');

const SOURCE_EXT = new Set(['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx']);
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '.nuxt', 'out', '.turbo', '.cache']);

// Module specifiers and what each means for the switch.
const SPECIFIERS = {
  ajv: { kind: 'rewrite', to: 'ata-validator/compat' },
  'ajv/dist/ajv': { kind: 'rewrite', to: 'ata-validator/compat' },
  'ajv/dist/2020': { kind: 'rewrite-note', to: 'ata-validator/compat', note: 'compat reads a schema with no $schema as draft-07, where this import read it as Draft 2020-12: give each such schema a $schema, or keep this import until it has one' },
  'ajv/dist/2019': { kind: 'rewrite-note', to: 'ata-validator/compat', note: 'compat reads a schema with no $schema as draft-07, where this import read it as Draft 2019-09, which ata does not implement: give each such schema a Draft 2020-12 or draft-07 $schema first' },
  'ajv/dist/jtd': { kind: 'refuse', note: 'JSON Type Definition is not JSON Schema; ata has no equivalent' },
  'ajv-formats': { kind: 'delete-import', note: 'the formats this plugin adds are built into ata; the import and the addFormats() call go' },
  'ajv-errors': { kind: 'refuse', note: 'ata reads the errorMessage keyword natively (docs/migration-from-ajv.md, "Error UX"); the plugin call must be removed by hand and the keyword stays as it is' },
  'ajv-keywords': { kind: 'refuse', note: 'not supported; each keyword used needs a definition through addKeyword with validate, compile or macro' },
  'ajv-i18n': { kind: 'refuse', note: 'not supported; messages are English' },
  'ajv-merge-patch': { kind: 'refuse', note: '$merge and $patch are not supported' },
};

// Masks comments and string contents with spaces, keeping every index and
// line break where it was, so matches in the mask map back to the source.
function mask (src) {
  const out = src.split('');
  const n = src.length;
  let i = 0;
  const blank = (from, to) => { for (let k = from; k < to; k++) if (out[k] !== '\n') out[k] = ' '; };
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];
    if (c === '/' && d === '/') {
      let j = i;
      while (j < n && src[j] !== '\n') j++;
      blank(i, j); i = j; continue;
    }
    if (c === '/' && d === '*') {
      let j = src.indexOf('*/', i + 2);
      if (j < 0) j = n; else j += 2;
      blank(i, j); i = j; continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) break;
        if (c !== '`' && src[j] === '\n') break;
        j++;
      }
      blank(i + 1, j); i = j + 1; continue;
    }
    i++;
  }
  return out.join('');
}

function lineOf (src, index) {
  let line = 1;
  for (let i = 0; i < index; i++) if (src.charCodeAt(i) === 10) line++;
  return line;
}

// Every module specifier in `src`: the string following `from`, inside
// `require(` or `import(`, and in a bare `import '...'`. Returns the span of
// the string contents, so a rewrite replaces only the specifier.
function specifiers (src) {
  const m = mask(src);
  const found = [];
  const re = /(\bfrom\s*|\brequire\s*\(\s*|\bimport\s*\(\s*|\bimport\s+)(['"])/g;
  let x;
  while ((x = re.exec(m)) !== null) {
    const quote = x[2];
    const start = x.index + x[0].length;
    const end = src.indexOf(quote, start);
    if (end < 0) continue;
    found.push({ start, end, value: src.slice(start, end), line: lineOf(src, start) });
  }
  return found;
}

// `addFormats(x)` call statements, with the span to delete when the call is a
// statement on its own.
function addFormatsCalls (src) {
  const m = mask(src);
  const calls = [];
  const re = /\baddFormats\s*\(/g;
  let x;
  while ((x = re.exec(m)) !== null) {
    let depth = 1;
    let j = x.index + x[0].length;
    while (j < m.length && depth > 0) { if (m[j] === '(') depth++; else if (m[j] === ')') depth--; j++; }
    let end = j;
    if (m[end] === ';') end++;
    // A statement of its own: only whitespace between the previous line
    // break and the call, and between the call and the next one.
    let ls = x.index;
    while (ls > 0 && m[ls - 1] !== '\n') ls--;
    let le = end;
    while (le < m.length && m[le] !== '\n') le++;
    const alone = /^\s*$/.test(m.slice(ls, x.index)) && /^\s*$/.test(m.slice(end, le));
    calls.push({ start: x.index, end, lineStart: ls, lineEnd: le < m.length ? le + 1 : le, alone, line: lineOf(src, x.index) });
  }
  return calls;
}

// `$data` as an object key, bare or quoted. Read from the source rather than
// the mask, since a quoted key is a string the mask blanks.
function usesDollarData (src) {
  const re = /(['"])\$data\1\s*:|\$data\s*:/g;
  const lines = [];
  let x;
  while ((x = re.exec(src)) !== null) lines.push(lineOf(src, x.index));
  return [...new Set(lines)];
}

function walk (dir, files) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return files; }
  for (const e of entries) {
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(path.join(dir, e.name), files); continue; }
    if (e.isFile() && SOURCE_EXT.has(path.extname(e.name))) files.push(path.join(dir, e.name));
  }
  return files;
}

// One file. Returns null when the file mentions nothing of ajv. A file that
// already imports ata-validator/compat is read too: what compat refuses
// ($data, a code keyword, addFormats) is still a finding there, so a second
// run after --write, or a CI check, keeps reporting it until it is fixed.
const COMPAT = 'ata-validator/compat';
function inspectFile (file, src) {
  const specs = specifiers(src).filter((s) => s.value === 'ajv' || s.value.startsWith('ajv/') || s.value.startsWith('ajv-') || s.value === COMPAT);
  if (specs.length === 0) return null;
  const findings = [];
  for (const s of specs) {
    if (s.value === COMPAT) continue;
    const rule = SPECIFIERS[s.value];
    if (!rule) {
      findings.push({ line: s.line, kind: 'flag', text: `import of "${s.value}": no translation known; check docs/migration-from-ajv.md` });
      continue;
    }
    if (rule.kind === 'rewrite') findings.push({ line: s.line, kind: 'rewrite', text: `"${s.value}" becomes "${rule.to}"`, span: s, to: rule.to });
    else if (rule.kind === 'rewrite-note') findings.push({ line: s.line, kind: 'rewrite', text: `"${s.value}" becomes "${rule.to}"; ${rule.note}`, span: s, to: rule.to, note: true });
    else if (rule.kind === 'delete-import') findings.push({ line: s.line, kind: 'delete', text: `import of "${s.value}" goes: ${rule.note}`, span: s, deleteImport: true });
    else findings.push({ line: s.line, kind: 'flag', text: `import of "${s.value}": ${rule.note}` });
  }
  const usesAjv = specs.some((s) => s.value === 'ajv' || s.value.startsWith('ajv/') || s.value === COMPAT);
  if (usesAjv) {
    for (const c of addFormatsCalls(src)) {
      if (c.alone) findings.push({ line: c.line, kind: 'delete', text: 'addFormats() call goes: these formats are built in, and compat refuses the call', call: c });
      else findings.push({ line: c.line, kind: 'flag', text: 'addFormats() is part of a larger statement; remove it by hand' });
    }
  }
  if (usesAjv) {
    for (const line of usesDollarData(src)) findings.push({ line, kind: 'flag', text: '$data reference: compat refuses $data; rewrite the constraint without it' });
    const m = mask(src);
    const kw = /\.addKeyword\s*\(/g;
    let x;
    while ((x = kw.exec(m)) !== null) {
      // The definition object follows; a `code:` key in it is the form compat
      // cannot take. Looked for up to the matching parenthesis.
      let depth = 1; let j = x.index + x[0].length;
      while (j < m.length && depth > 0) { if (m[j] === '(') depth++; else if (m[j] === ')') depth--; j++; }
      if (/\bcode\s*[:(]/.test(m.slice(x.index, j))) findings.push({ line: lineOf(src, x.index), kind: 'flag', text: 'addKeyword with a code-generating definition: compat takes validate, compile or macro only' });
    }
  }
  if (findings.length === 0) return null;
  findings.sort((a, b) => a.line - b.line);
  return findings;
}

// The source with the mechanical rewrites applied: specifiers replaced,
// standalone addFormats() statements removed, and the ajv-formats import
// line removed when its binding has no other use.
function rewriteFile (src, findings) {
  const edits = [];
  for (const f of findings) {
    if (f.kind === 'rewrite') edits.push({ start: f.span.start, end: f.span.end, text: f.to });
    else if (f.kind === 'delete' && f.call) edits.push({ start: f.call.lineStart, end: f.call.lineEnd, text: '' });
    else if (f.kind === 'delete' && f.deleteImport) {
      let ls = f.span.start; while (ls > 0 && src[ls - 1] !== '\n') ls--;
      let le = f.span.end; while (le < src.length && src[le] !== '\n') le++;
      if (le < src.length) le++;
      const stmt = src.slice(ls, le);
      // Only a whole import or require statement on its own line.
      if (/^\s*(import\b[^;\n]*from\s*['"]ajv-formats['"]\s*;?\s*\n?|(const|let|var)\s+\w+\s*=\s*require\s*\(\s*['"]ajv-formats['"]\s*\)\s*;?\s*\n?)$/.test(stmt)) edits.push({ start: ls, end: le, text: '' });
    }
  }
  edits.sort((a, b) => b.start - a.start);
  let out = src;
  for (const e of edits) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

function migrate (dir, opts = {}) {
  const root = path.resolve(dir || '.');
  const files = walk(root, []);
  const report = [];
  let flagged = 0;
  let written = 0;
  for (const file of files) {
    let src;
    try { src = fs.readFileSync(file, 'utf8'); } catch { continue; }
    const findings = inspectFile(file, src);
    if (findings === null) continue;
    // Forward slashes on every platform: the path is for people to read and
    // paste, and Windows gave `src\\plain.js` where the report and its test
    // name `src/plain.js`.
    report.push({ file: path.relative(root, file).split(path.sep).join('/'), findings });
    flagged += findings.filter((f) => f.kind === 'flag').length;
    if (opts.write && findings.some((f) => f.kind !== 'flag')) {
      const out = rewriteFile(src, findings);
      if (out !== src) { fs.writeFileSync(file, out); written++; }
    }
  }
  return { root, scanned: files.length, report, flagged, written };
}

function formatReport (result, opts = {}) {
  const lines = [];
  if (result.report.length === 0) {
    lines.push(`no use of ajv found in ${result.scanned} source files under ${result.root}`);
    return lines.join('\n');
  }
  const label = { rewrite: 'rewrite', delete: 'delete ', flag: 'flag   ' };
  for (const r of result.report) {
    lines.push(r.file);
    for (const f of r.findings) lines.push(`  ${label[f.kind]}  line ${String(f.line).padStart(4)}  ${f.text}`);
  }
  const rewrites = result.report.reduce((n, r) => n + r.findings.filter((f) => f.kind !== 'flag').length, 0);
  lines.push('');
  lines.push(`${result.report.length} of ${result.scanned} source files use ajv: ${rewrites} mechanical change${rewrites === 1 ? '' : 's'}, ${result.flagged} site${result.flagged === 1 ? '' : 's'} to look at by hand`);
  if (opts.write) lines.push(`${result.written} file${result.written === 1 ? '' : 's'} written; flagged sites were left as they are`);
  else if (rewrites > 0) lines.push('nothing was changed; run again with --write to apply the mechanical changes');
  if (result.flagged > 0) lines.push('each flagged site is explained in docs/migration-from-ajv.md');
  return lines.join('\n');
}

module.exports = { migrate, formatReport, inspectFile, rewriteFile, mask, specifiers, SPECIFIERS };
