'use strict';
// Writes lib/kernels/formats.mjs and lib/kernels/formats/: the current
// engine's generated check for each format (FORMAT_CODEGEN in
// lib/js-compiler.js), one export each, with the helpers they hoist written
// once. Modules written by ata-validator/ir
// import the formats they check from here, so a page with several of them
// carries each check once.
// tests/test_kernels_formats_sync.js fails when the copy and the source differ.
const fs = require('fs');
const path = require('path');
const { FORMAT_CODEGEN } = require('../lib/js-compiler.js')._internal;

// A hoisted helper that runs statements when it loads (the uuid tables are
// filled by loops) goes inside a function marked pure, so a bundle that does
// not check that format drops it. A function or a regular expression literal
// is already free to drop.
function pure (line, rest) {
  if (/^function \w+\(/.test(line) || /^const \w+=\/.*\/[a-z]*$/.test(line)) return { text: line, names: topLevelNames(line) };
  const declared = topLevelNames(line);
  // What the format checks call; the rest stays inside.
  const used = declared.filter((n) => new RegExp('(?<![\\w$])' + n.replace(/\$/g, '\\$') + '(?![\\w$])').test(rest));
  if (!used.length) throw new Error('gen-kernels-formats: nothing outside uses this helper: ' + line.slice(0, 80));
  const init = '_init' + used[0];
  const out = [`let ${init}S`, `const ${init} = () => { ${line}; return { ${used.join(', ')} } }`];
  for (const n of used) out.push(`function ${n} (a, b) { return (${init}S || (${init}S = ${init}())).${n}(a, b) }`);
  return { text: out.join('\n'), names: used };
}

// The names a line declares at its top level: `const a=..,b=..`, `let`,
// `function f(`; a name declared inside a function or a block is skipped.
// Strings and regular expression literals are stepped over so a brace in
// them does not count.
function topLevelNames (line) {
  const names = [];
  let depth = 0; let inDecl = false; let i = 0; let prev = '';
  const ident = /[A-Za-z_$][\w$]*/y;
  while (i < line.length) {
    const c = line[i];
    if (c === "'" || c === '"' || c === '`') { const q = c; i++; while (i < line.length && line[i] !== q) { if (line[i] === '\\') i++; i++ } i++; prev = 'x'; continue }
    if (c === '/' && /[=(,:;!&|?{}]$/.test(prev)) { i++; let cls = false; while (i < line.length && (line[i] !== '/' || cls)) { if (line[i] === '\\') i++; else if (line[i] === '[') cls = true; else if (line[i] === ']') cls = false; i++ } i++; while (/[a-z]/.test(line[i] || '')) i++; prev = 'x'; continue }
    if (c === '{' || c === '(' || c === '[') { depth++; prev = c; i++; continue }
    if (c === '}' || c === ')' || c === ']') { depth--; prev = c; i++; continue }
    if (c === ';' && depth === 0) { inDecl = false; prev = c; i++; continue }
    ident.lastIndex = i; const m = ident.exec(line);
    if (m) {
      const w = m[0];
      if (depth === 0) {
        if (w === 'const' || w === 'let' || w === 'var') { inDecl = true; ident.lastIndex = i + w.length; const sp = /\s+([A-Za-z_$][\w$]*)/y; sp.lastIndex = i + w.length; const n = sp.exec(line); if (n) { names.push(n[1]); i = sp.lastIndex; prev = 'x'; continue } }
        else if (w === 'function') { const sp = /\s+([A-Za-z_$][\w$]*)/y; sp.lastIndex = i + w.length; const n = sp.exec(line); if (n) { names.push(n[1]); i = sp.lastIndex; prev = 'x'; continue } }
        else if (inDecl && prev === ',') names.push(w);
      }
      i += w.length; prev = 'x'; continue;
    }
    if (!/\s/.test(c)) prev = c;
    i++;
  }
  return [...new Set(names)];
}

const exportName = (format) => 'fmt_' + format.replace(/-/g, '_');

// Whether `text` names `name` as an identifier of its own: not part of a
// longer one, and not a property read.
function uses (text, name) {
  const part = /[\w$]/;
  for (let i = text.indexOf(name); i !== -1; i = text.indexOf(name, i + 1)) {
    const before = i === 0 ? '' : text[i - 1]; const after = text[i + name.length] || '';
    if (before !== '.' && !part.test(before) && !part.test(after)) return true;
  }
  return false;
}

// One module a format and one a hoisted helper, under lib/kernels/formats/,
// and lib/kernels/formats.mjs naming each format from its module. A bundler
// keeps or drops a module whole for the build, not for each page: with every
// check in one module, a page of a site carried the checks of every other
// page's formats.
function render () {
  const fctx = { preamble: [] };
  const fns = [];
  for (const name of Object.keys(FORMAT_CODEGEN).sort()) {
    const src = FORMAT_CODEGEN[name]('s', true, fctx);
    fns.push({ name, text: `export function ${exportName(name)} (s) { ${src}; return true }` });
  }
  const all = fns.map((f) => f.text).join('\n');
  const helpers = fctx.preamble.map((l, i, lines) => {
    const { text, names } = pure(l, lines.filter((_, j) => j !== i).join('\n') + all);
    return { text, exported: names, file: '_' + names[0].replace(/^_+/, '') + '.mjs' };
  });
  const imports = (text, self) => helpers.filter((h) => h !== self).map((h) => [h, h.exported.filter((n) => uses(text, n))]).filter(([, n]) => n.length).map(([h, n]) => `import { ${n.join(', ')} } from './${h.file}'\n`).join('');
  const head = '// Generated by scripts/gen-kernels-formats.js from lib/js-compiler.js. Do not edit.\n';
  const files = {};
  // The modules carry no header of their own: the tarball has a byte ceiling.
  for (const h of helpers) files['formats/' + h.file] = `${imports(h.text, h)}${h.text}\nexport { ${h.exported.join(', ')} }\n`;
  for (const f of fns) files[`formats/${f.name}.mjs`] = `${imports(f.text, null)}${f.text}\n`;
  files['formats.mjs'] = head + fns.map((f) => `export { ${exportName(f.name)} } from './formats/${f.name}.mjs'\n`).join('');
  return files;
}

const dir = path.join(__dirname, '..', 'lib', 'kernels');
const file = path.join(dir, 'formats.mjs');
function write () {
  const files = render();
  fs.rmSync(path.join(dir, 'formats'), { recursive: true, force: true });
  fs.mkdirSync(path.join(dir, 'formats'));
  for (const [rel, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, rel), text);
}
if (require.main === module) write();
module.exports = { render, file, dir, exportName };
