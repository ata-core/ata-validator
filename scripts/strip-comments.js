#!/usr/bin/env node
'use strict';

// Removes comments from the JavaScript the npm package ships, in place. The
// release job runs it on a fresh checkout just before `npm publish`; the
// repository keeps its comments.
//
// Why: V8 scans a function's whole text, comments included, the first time
// the function runs, and the schema compiler's large functions are about a
// third comments. Without them a fresh process reaches its first validated
// document measurably sooner.
//
// Every newline stays, so line and column numbers in stack traces are the
// same as in the repository. TypeScript's parser finds the comments, so text
// inside strings, template literals and regex literals is never touched. Each
// file is then checked: parsed again, the stripped file must give the same
// tokens as the original, so nothing but comments was removed. Any mismatch
// stops the script before it writes anything. TypeScript is pure JavaScript,
// so this runs in the release job, which installs without optional packages.
//
// Usage: node scripts/strip-comments.js [--check]
//   --check  verify and report sizes, write nothing

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.join(__dirname, '..');
const pkg = require(path.join(root, 'package.json'));

// The shipped .js and .mjs files under lib/ and at the top level. bin/ keeps
// its comments: the CLI's start-up time is not on any request path.
function shippedFiles() {
  const out = [];
  const excluded = new Set(pkg.files.filter((f) => f.startsWith('!')).map((f) => f.slice(1)));
  for (const entry of pkg.files) {
    if (entry.startsWith('!') || entry.startsWith('bin')) continue;
    if (entry.endsWith('/')) {
      for (const f of fs.readdirSync(path.join(root, entry))) {
        const rel = entry + f;
        if (/\.(js|mjs)$/.test(f) && !excluded.has(rel)) out.push(rel);
      }
    } else if (/\.(js|mjs)$/.test(entry)) {
      out.push(entry);
    }
  }
  return out;
}

// In a .js file TypeScript also parses JSDoc comments into nodes; those sit
// inside a comment, so neither walk below enters them.
const isJSDoc = (node) => node.kind >= ts.SyntaxKind.FirstJSDocNode && node.kind <= ts.SyntaxKind.LastJSDocNode;

function parse(text, file) {
  return ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
}

function commentRanges(text, file) {
  const sf = parse(text, file);
  const seen = new Map();
  const add = (ranges) => { if (ranges) for (const r of ranges) seen.set(r.pos, r.end); };
  const visit = (node) => {
    add(ts.getLeadingCommentRanges(text, node.pos));
    add(ts.getTrailingCommentRanges(text, node.end));
    // getChildren includes tokens, so the trivia before every token is seen.
    for (const child of node.getChildren(sf)) if (!isJSDoc(child)) visit(child);
  };
  visit(sf);
  return [...seen].sort((a, b) => a[0] - b[0]);
}

// Every token of the file, kind and text, comments excluded.
function tokens(text, file) {
  const sf = parse(text, file);
  const out = [];
  const visit = (node) => {
    const children = node.getChildren(sf).filter((c) => !isJSDoc(c));
    if (children.length === 0) out.push(node.kind + ':' + node.getText(sf));
    else for (const child of children) visit(child);
  };
  visit(sf);
  return out.join('\n');
}

function strip(text, file) {
  let out = '';
  let at = 0;
  for (const [pos, end] of commentRanges(text, file)) {
    if (pos < at) continue;
    out += text.slice(at, pos) + text.slice(pos, end).replace(/[^\n]/g, '');
    at = end;
  }
  out += text.slice(at);
  // Spaces left at the end of a line by a removed trailing comment.
  return out.replace(/[ \t]+$/gm, '');
}

function main() {
  const check = process.argv.includes('--check');
  let before = 0;
  let after = 0;
  const results = [];
  for (const rel of shippedFiles()) {
    const file = path.join(root, rel);
    const text = fs.readFileSync(file, 'utf8');
    const out = strip(text, rel);
    if (tokens(out, rel) !== tokens(text, rel)) {
      console.error(`strip-comments: ${rel} changed beyond its comments; nothing written`);
      process.exit(1);
    }
    before += Buffer.byteLength(text);
    after += Buffer.byteLength(out);
    results.push([file, out, text]);
  }
  if (!check) for (const [file, out, text] of results) if (out !== text) fs.writeFileSync(file, out);
  console.log(`strip-comments: ${results.length} files, ${before} to ${after} bytes${check ? ' (check only)' : ''}`);
}

if (require.main === module) main();
module.exports = { strip, tokens, shippedFiles };
