'use strict';
// Validation as the body arrives (lib/stream.js). The record stream must
// give, for any way the bytes are cut into chunks, the same verdict per
// record as validating each record whole, must stop at the first failure
// when asked, must split a JSON array without parsing it (strings with
// brackets and escaped quotes, nested arrays, scalars, whitespace, CRLF,
// blank lines) and must stop reading a source once a record has failed.
const assert = require('assert');
const { Readable } = require('stream');
const { Validator } = require('..');
const { streamValidator, validateStream, PARSE_KEYWORD } = require('../stream');

const schema = {
  type: 'object',
  required: ['id', 'email'],
  properties: {
    id: { type: 'integer', minimum: 1 },
    email: { type: 'string', format: 'email' },
    tags: { type: 'array', items: { type: 'string', maxLength: 10 } },
    note: { type: 'string' },
  },
  additionalProperties: false,
};
const v = new Validator(schema);

const good = [
  { id: 1, email: 'a@b.co' },
  { id: 2, email: 'u@ex.io', tags: ['x', 'y]z', '"q"'], note: 'brackets ] and { braces } and \\"escapes\\" and ü and 日本語 and 😀' },
  { id: 3, email: 'c@d.org', tags: [] },
];
const bad = { id: 0, email: 'nope' };

const texts = (docs) => docs.map((d) => JSON.stringify(d));
const ndjson = (docs) => texts(docs).join('\n') + '\n';
const array = (docs, pretty) => pretty ? '[\n  ' + texts(docs).join(',\n  ') + '\n]\n' : '[' + texts(docs).join(',') + ']';

// Every cut of `text` into two chunks, as strings and as bytes, must agree
// with the whole-text answer.
function everyCut (text, expect, opts) {
  const whole = streamValidator(v, opts); whole.push(text); const w = whole.end();
  expect(w, 'whole');
  const bytes = Buffer.from(text, 'utf8');
  for (let i = 1; i < text.length; i++) {
    const s = streamValidator(v, opts); s.push(text.slice(0, i)); s.push(text.slice(i)); expect(s.end(), `string cut at ${i}`);
  }
  for (let i = 1; i < bytes.length; i++) {
    const s = streamValidator(v, opts); s.push(bytes.subarray(0, i)); s.push(bytes.subarray(i)); expect(s.end(), `byte cut at ${i}`);
  }
  // Byte by byte.
  const s = streamValidator(v, opts); for (let i = 0; i < bytes.length; i++) s.push(bytes.subarray(i, i + 1)); expect(s.end(), 'byte by byte');
}

// Valid inputs, four shapes.
for (const [label, text] of [['ndjson', ndjson(good)], ['ndjson crlf', texts(good).join('\r\n') + '\r\n\r\n'], ['array', array(good)], ['array pretty', array(good, true)]]) {
  everyCut(text, (r, how) => { assert.strictEqual(r.valid, true, `${label}, ${how}: ${JSON.stringify(r.errors)}`); assert.strictEqual(r.records, 3, `${label}, ${how}: records`); });
}

// The bad record third of four: the first failure names record 2 and the
// stream stops there; without stopOnFirst every record is seen.
for (const [label, text] of [['ndjson', ndjson([good[0], good[1], bad, good[2]])], ['array', array([good[0], good[1], bad, good[2]])]]) {
  everyCut(text, (r, how) => {
    assert.strictEqual(r.valid, false, `${label}, ${how}`);
    assert.strictEqual(r.errors.length, 1, `${label}, ${how}: one failure`);
    assert.strictEqual(r.errors[0].record, 2, `${label}, ${how}: record index`);
    assert.strictEqual(r.records, 3, `${label}, ${how}: stopped after the failing record`);
    assert.ok(r.errors[0].errors.some((e) => e.keyword === 'minimum'), `${label}, ${how}: the record's own errors`);
  });
  everyCut(text, (r, how) => {
    assert.strictEqual(r.valid, false); assert.strictEqual(r.records, 4, `${label}, ${how}: all records seen`); assert.strictEqual(r.errors.length, 1);
  }, { stopOnFirst: false });
}

// The records come out parsed, in order, with their indices.
{
  const seen = [];
  const s = streamValidator(v, { onRecord: (doc, i) => seen.push([i, doc.id]) });
  s.push(array(good)); s.end();
  assert.deepStrictEqual(seen, [[0, 1], [1, 2], [2, 3]]);
}

// A record that is not JSON is reported as such, with the shape validateJSON uses.
{
  const s = streamValidator(v); const f = s.push('{"id":1,"email":"a@b.co"}\n{not json}\n');
  assert.strictEqual(f.record, 1); assert.strictEqual(f.errors[0].keyword, PARSE_KEYWORD);
  assert.strictEqual(s.end().valid, false);
}

// Array syntax the splitter must refuse rather than guess at.
for (const [text, why] of [['[{"id":1,"email":"a@b.co"},]', 'trailing comma'], ['[{"id":1,"email":"a@b.co"},,{"id":2,"email":"b@c.co"}]', 'double comma'], ['[{"id":1,"email":"a@b.co"} {"id":2,"email":"b@c.co"}]', 'missing comma'], ['[{"id":1,"email":"a@b.co"}', 'unclosed'], ['[{"id":1,"email":"a@b.co"}] x', 'trailing text'], ['{"id":1,"email":"a@b.co"}]', 'not an array, taken as ndjson'], ['', 'empty']]) {
  const s = streamValidator(v, { format: text.startsWith('{') ? 'ndjson' : 'array' }); s.push(text); const r = s.end();
  if (why === 'not an array, taken as ndjson') { assert.strictEqual(r.valid, false, why); assert.strictEqual(r.errors[0].errors[0].keyword, PARSE_KEYWORD, why); continue; }
  assert.strictEqual(r.valid, false, why);
  assert.strictEqual(r.errors[r.errors.length - 1].errors[0].keyword, PARSE_KEYWORD, why);
}
// An empty array is valid and has no records.
{ const s = streamValidator(v); s.push(' [ ] '); const r = s.end(); assert.strictEqual(r.valid, true); assert.strictEqual(r.records, 0); }

// Scalars and nested arrays as elements, against a schema that takes them.
{
  const vs = new Validator({ type: ['integer', 'number', 'string', 'array', 'null', 'boolean'], items: { type: ['integer', 'array'] } });
  const text = '[1, -2.5e3 ,"s]{,", [1,[2,3]], null,true,false]';
  const s = streamValidator(vs); const seen = []; s._onRecord = (d) => seen.push(d); s.push(text); const r = s.end();
  assert.strictEqual(r.valid, true, JSON.stringify(r.errors)); assert.strictEqual(r.records, 7);
  assert.deepStrictEqual(seen, [1, -2500, 's]{,', [1, [2, 3]], null, true, false]);
}

// Agreement with whole-array validation on the array schema, for every
// single-record mutation of the good documents.
{
  const whole = new Validator({ type: 'array', items: schema });
  const variants = [];
  for (let i = 0; i < good.length; i++) {
    for (const m of [(d) => ({ ...d, id: 0 }), (d) => ({ ...d, email: 'x' }), (d) => ({ ...d, extra: 1 }), (d) => ({ ...d, tags: ['too-long-a-tag'] }), (d) => { const c = { ...d }; delete c.email; return c; }]) {
      const docs = good.map((d, j) => j === i ? m(d) : d); variants.push(docs);
    }
  }
  for (const docs of variants) {
    const expect = whole.isValidObject(docs);
    const s = streamValidator(v); s.push(array(docs)); const r = s.end();
    assert.strictEqual(r.valid, expect, JSON.stringify(docs));
    if (!expect) assert.strictEqual(r.errors[0].record, docs.findIndex((d) => !v.isValidObject(d)));
  }
}

// validateStream stops reading its source at the first failure.
(async () => {
  const chunks = texts([good[0], bad, good[1], good[2], good[0], good[1]]).map((t) => t + '\n');
  let pulled = 0;
  const src = Readable.from((function * () { for (const c of chunks) { pulled++; yield c; } })());
  const r = await validateStream(v, src);
  assert.strictEqual(r.valid, false); assert.strictEqual(r.errors[0].record, 1);
  assert.ok(pulled <= 3, `source read ${pulled} chunks of ${chunks.length} after the failure at the second`);
  // A Web ReadableStream, cancelled the same way.
  let webPulled = 0; let cancelled = false;
  const web = new ReadableStream({ pull (c) { if (webPulled < chunks.length) c.enqueue(new TextEncoder().encode(chunks[webPulled++])); else c.close(); }, cancel () { cancelled = true; } });
  const r2 = await validateStream(v, web);
  assert.strictEqual(r2.valid, false); assert.strictEqual(r2.errors[0].record, 1); assert.ok(cancelled, 'the web stream was cancelled');
  assert.ok(webPulled <= 3, `web source read ${webPulled} chunks`);
  // A valid source reads to the end.
  const r3 = await validateStream(v, Readable.from(texts(good).map((t) => Buffer.from(t + '\n'))));
  assert.strictEqual(r3.valid, true); assert.strictEqual(r3.records, 3);
  // The method on the validator.
  const s = v.stream(); s.push(ndjson(good)); assert.strictEqual(s.end().valid, true);

  // A Node http request is not destroyed at the failure: the response must
  // still reach the client, which a closed socket would turn into a network
  // error. Reading stops, the rest of the body drains, the client gets the 400.
  const http = require('http');
  let seenAtAnswer = null; let drained = false; let destroyedAtAnswer = null;
  const server = http.createServer(async (req, res) => {
    let seen = 0; req.on('data', (c) => { seen += c.length; });
    req.on('end', () => { drained = true; });
    const r = await validateStream(v, req);
    seenAtAnswer = seen; destroyedAtAnswer = req.destroyed;
    res.writeHead(r.valid ? 200 : 400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ record: r.errors[0].record, errors: r.errors[0].errors.length }));
  });
  await new Promise((resolve) => server.listen(0, resolve));
  const port = server.address().port;
  // A body of a few MB, the bad record second, handed over as it is produced.
  const total = 4 * 1024 * 1024; let sent = 0; let n = 0;
  const body = new ReadableStream({ pull (c) { if (sent >= total) { c.close(); return; } const lines = []; for (let k = 0; k < 500; k++, n++) lines.push(JSON.stringify(n === 1 ? bad : { ...good[0], id: n + 1 })); const chunk = Buffer.from(lines.join('\n') + '\n'); sent += chunk.length; c.enqueue(chunk); } });
  const res = await fetch(`http://127.0.0.1:${port}/import`, { method: 'POST', body, duplex: 'half', headers: { 'content-type': 'application/x-ndjson' } });
  const answer = await res.json();
  assert.strictEqual(res.status, 400, 'the client reads the 400 while it is still uploading');
  assert.strictEqual(answer.record, 1); assert.ok(answer.errors > 0);
  assert.strictEqual(destroyedAtAnswer, false, 'the request was not destroyed at the failure');
  assert.ok(seenAtAnswer < total / 4, `the handler answered after ${seenAtAnswer} of ${total} bytes`);
  await new Promise((resolve) => server.close(resolve));
  assert.ok(drained || sent < total, 'the rest of the body drained, or the client stopped sending');
  // A Readable that is not a request is still destroyed.
  const file = Readable.from(texts([good[0], bad, good[1]]).map((t) => t + '\n'));
  await validateStream(v, file);
  assert.strictEqual(file.destroyed, true, 'a plain Readable is destroyed at the failure');
  console.log('ok: record streams agree with whole validation under every chunk cut, stop at the first failure, stop their source, and leave an http request alive for its response');
})().catch((e) => { console.error(e); process.exit(1); });
