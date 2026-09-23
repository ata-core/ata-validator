'use strict';

const assert = require('assert');
const { buildDataPositionMap } = require('../lib/data-positions');

const input = '{ "name": "M", "email": "not-an-email", "age": -3 }';
const map = buildDataPositionMap(input);

assert.strictEqual(map[''].byteOffset, 0);
assert.strictEqual(map['/name'].byteOffset, input.indexOf('"M"'));
assert.strictEqual(map['/name'].length, 3); // "M"
assert.strictEqual(map['/email'].byteOffset, input.indexOf('"not-an-email"'));
assert.strictEqual(map['/email'].length, '"not-an-email"'.length);
assert.strictEqual(map['/age'].byteOffset, input.indexOf('-3'));
assert.strictEqual(map['/age'].length, 2);

// Multi-line input
const multi = '{\n  "x": 1,\n  "y": [10, 20, 30]\n}\n';
const m2 = buildDataPositionMap(multi);
assert.strictEqual(m2['/y/1'].line, 3);
assert.strictEqual(m2['/y/1'].text, '  "y": [10, 20, 30]');

// Buffer input
const buf = Buffer.from(input, 'utf8');
const m3 = buildDataPositionMap(buf);
assert.strictEqual(m3['/email'].byteOffset, map['/email'].byteOffset);

console.log('ok: data-positions unit tests');

// Key spans: an object member records where its key token sits, so an error
// naming a property can point at the property instead of at its container.
{
  const text = '{\n  "alpha": 1,\n  "beta": [10, 20]\n}';
  const map = buildDataPositionMap(text);

  assert.strictEqual(map['/alpha'].keyLine, 2, 'alpha key on line 2');
  assert.strictEqual(map['/alpha'].keyCol, 3, 'alpha key starts at col 3');
  assert.strictEqual(map['/alpha'].keyLength, 7, 'alpha key token is 7 chars including quotes');
  assert.strictEqual(text.slice(map['/alpha'].keyOffset, map['/alpha'].keyOffset + map['/alpha'].keyLength), '"alpha"');

  assert.strictEqual(map['/beta'].keyLine, 3, 'beta key on line 3');
  assert.strictEqual(text.slice(map['/beta'].keyOffset, map['/beta'].keyOffset + map['/beta'].keyLength), '"beta"');

  // Array elements have no key of their own.
  assert.strictEqual(map['/beta/0'].keyOffset, undefined, 'array element has no key span');
  // Neither does the root.
  assert.strictEqual(map[''].keyOffset, undefined, 'root has no key span');

  console.log('ok: key spans recorded for object members');
}

// Escapes. The walker spans string values without decoding them, so a value
// holding a quote, a brace or a pointer character must not move any span or
// invent a pointer. Keys are decoded, because the pointer is built from them.
{
  const text = '{"say":"he said \\"hi\\" }","back":"c:\\\\tmp","brace":"{\\"a\\":1}"}';
  const map = buildDataPositionMap(text);

  assert.deepStrictEqual(Object.keys(map), ['/say', '/back', '/brace', ''], 'one pointer per member, no extras from value contents');
  for (const ptr of ['/say', '/back', '/brace']) {
    const e = map[ptr];
    const span = text.slice(e.byteOffset, e.byteOffset + e.length);
    assert.strictEqual(span[0], '"', ptr + ' span starts at the opening quote');
    assert.strictEqual(span[span.length - 1], '"', ptr + ' span ends at the closing quote');
    assert.strictEqual(JSON.parse(span), JSON.parse(text.slice(e.byteOffset, e.byteOffset + e.length)), ptr + ' span is a whole JSON string');
  }
  assert.strictEqual(JSON.parse(text.slice(map['/say'].byteOffset, map['/say'].byteOffset + map['/say'].length)), 'he said "hi" }');

  console.log('ok: escaped string values are spanned, not decoded');
}

// A key that needs decoding, and a key that needs JSON pointer escaping. These
// are separate concerns: `\u00e9` is JSON escaping, `~` and `/` are pointer
// escaping, and a key can need both.
{
  const text = '{"caf\\u00e9":1,"a/b":2,"c~d":3,"":4,"x\\ty":5}';
  const map = buildDataPositionMap(text);

  assert.deepStrictEqual(
    Object.keys(map),
    ['/café', '/a~1b', '/c~0d', '/', '/x\ty', ''],
    'keys are JSON-decoded then pointer-escaped',
  );
  assert.strictEqual(map['/café'].length, 1, 'value 1 is one char long');
  assert.strictEqual(text.slice(map['/a~1b'].keyOffset, map['/a~1b'].keyOffset + map['/a~1b'].keyLength), '"a/b"');
  assert.strictEqual(map['/'].byteOffset, text.indexOf('4'), 'the empty key is a real pointer');

  console.log('ok: keys decoded and pointer-escaped');
}

// Line and column against CRLF and a leading BOM. Offsets stay absolute
// positions in the string, which is what the caret renderer slices with.
{
  const crlf = '{\r\n  "a": 1,\r\n  "b": [\r\n    22\r\n  ]\r\n}';
  const m = buildDataPositionMap(crlf);
  assert.strictEqual(m['/a'].line, 2, 'a on line 2');
  assert.strictEqual(m['/a'].col, 8, 'a value at col 8');
  assert.strictEqual(m['/b/0'].line, 4, 'first element on line 4');
  assert.strictEqual(crlf.slice(m['/b/0'].byteOffset, m['/b/0'].byteOffset + m['/b/0'].length), '22');
  assert.strictEqual(m['/a'].text, '  "a": 1,\r', 'the frame text keeps the carriage return');

  const bom = '\ufeff{"a":1}';
  const mb = buildDataPositionMap(bom);
  assert.strictEqual(mb[''].byteOffset, 1, 'the BOM is skipped, the root starts after it');
  assert.strictEqual(bom.slice(mb['/a'].byteOffset, mb['/a'].byteOffset + mb['/a'].length), '1');

  console.log('ok: CRLF and BOM');
}

// Multibyte text. Offsets are string indices, so an emoji counts as its two
// UTF-16 code units; the name byteOffset predates that and is kept.
{
  const text = '{"emoji":"🚀","tr":"ğüşiöç","after":7}';
  const map = buildDataPositionMap(text);
  assert.strictEqual(map['/after'].byteOffset, text.indexOf('7'), 'offsets are string indices past a surrogate pair');
  assert.strictEqual(text.slice(map['/emoji'].byteOffset, map['/emoji'].byteOffset + map['/emoji'].length), '"🚀"');
  assert.strictEqual(text.slice(map['/tr'].byteOffset, map['/tr'].byteOffset + map['/tr'].length), '"ğüşiöç"');

  console.log('ok: multibyte offsets');
}

// Nothing here is required to be valid JSON: the map exists to put a caret on a
// syntax error, so a document that stops mid-container is the normal case.
{
  assert.deepStrictEqual(Object.keys(buildDataPositionMap('{"a":1,"b":')), ['/a', ''], 'a truncated member is not recorded');
  assert.deepStrictEqual(Object.keys(buildDataPositionMap('{"a":1,}')), ['/a', ''], 'a trailing comma records nothing extra');
  assert.deepStrictEqual(Object.keys(buildDataPositionMap('[1,},2]')), ['/0', '/1', ''], 'a stray brace ends the array walk');
  assert.deepStrictEqual(Object.keys(buildDataPositionMap('[')), [''], 'one byte terminates');
  assert.deepStrictEqual(Object.keys(buildDataPositionMap('{}')), [''], 'an empty object is just a root');
  assert.deepStrictEqual(Object.keys(buildDataPositionMap('{"a":{},"b":[],"c":[[],{}]}')), ['/a', '/b', '/c/0', '/c/1', '/c', ''], 'empty containers are recorded, post-order');

  console.log('ok: malformed and empty documents');
}

// The line between "map it" and "throw" is load bearing: the caller reads a
// throw as "no positions available" and renders the error without a caret. A
// raw control character and a bad escape are inside a string token, so a walker
// that spans string values without decoding them stops seeing either one, and
// the boundary moves without anything failing. It is pinned here.
{
  const throws = {
    'raw newline in value': '{"a":"x\ny"}',
    'raw tab in value': '{"a":"x\ty"}',
    'raw newline in key': '{"a\nb":1}',
    'bad escape in value': '{"a":"\\q"}',
    'unterminated string': '{"a":"abc}',
    'missing colon': '{"a" 1}',
    // Found by differential fuzzing against the pre-rewrite walker: a key whose
    // opening quote is gone leaves a bare word where the key token should be.
    // Reading it as a string would map `/o` in a document that says `mo`.
    'key missing its opening quote': '{"a":1,mo": false}',
    'bare word key': '{oops: 1}',
    'number where a key belongs': '{12: 1}',
  };
  for (const [name, text] of Object.entries(throws)) {
    assert.throws(() => buildDataPositionMap(text), Error, name + ' must throw');
  }

  // A lone surrogate escape is well-formed JSON syntax and maps fine.
  assert.strictEqual(Object.keys(buildDataPositionMap('{"a":"\\ud800"}')).length, 2, 'a lone surrogate escape is not a syntax error');
  // An escape that decodes is still decoded, in keys and in values.
  const esc = buildDataPositionMap('{"tab\\there":"v\\tv"}');
  assert.deepStrictEqual(Object.keys(esc), ['/tab\there', ''], 'an escaped key decodes to its pointer');

  // A duplicate key keeps the first pointer position and the last value.
  const dup = '{"a":1,"a":22}';
  const dm = buildDataPositionMap(dup);
  assert.deepStrictEqual(Object.keys(dm), ['/a', ''], 'a duplicate key is one pointer');
  assert.strictEqual(dm['/a'].byteOffset, dup.indexOf('22'), 'the last value wins');

  console.log('ok: throw boundary and duplicate keys');
}
