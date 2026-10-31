'use strict';

// Validation as the body arrives. A request that carries many documents, a
// JSON array or NDJSON, is today read to the end, parsed as a whole and then
// validated, so a bad third record is reported after the last byte: on a
// 100 MB upload that is half a second and 500 to 800 MB of memory before the
// caller hears "record 2, email". Here each record is validated the moment
// its last byte lands, so the same upload is refused after 100 KB, in
// milliseconds, with memory that does not grow with the body. Measured in
// the commit that added this: 517 ms and 783 MB to 6 ms and 114 MB for an
// early failure; the late failure costs the same time with a third of the
// memory.
//
// The splitting reads the text once and parses nothing it does not have to.
// NDJSON is split at newlines. A JSON array is split by a scan that tracks
// strings and nesting depth and hands out each top-level element; inside a
// string it jumps to the next quote with indexOf and counts the backslashes
// before it, so string bodies, most of a document's bytes, cost no branch
// per character. Each element is then parsed and validated on its own, by
// the validator's own verdict and, when it fails, its own error list.

const PARSE_KEYWORD = '__parse__';

// A record's failure as the stream reports it: the record's index from zero
// and the errors validate() would give for that document, or the parse
// error in the shape validateJSON() uses for a document that is not JSON.
function failure (record, errors) {
  return { valid: false, record, errors };
}
function parseFailure (record, message) {
  return failure(record, [{ keyword: PARSE_KEYWORD, instancePath: '', schemaPath: '', params: {}, message: 'invalid JSON: ' + message }]);
}

// The decoder for byte chunks: a multi-byte character split across two
// chunks is completed by the next one. Strings pass through untouched.
function decoderFor () {
  const d = typeof TextDecoder === 'function' ? new TextDecoder('utf-8') : null;
  return (chunk, last) => {
    if (typeof chunk === 'string') return chunk;
    if (d === null) return Buffer.from(chunk).toString('utf8');
    return d.decode(chunk, { stream: !last });
  };
}

// The end of the string that opens at `from` (the index after the quote), or
// -1 when the chunk ends first. A quote preceded by an odd number of
// backslashes is escaped.
function stringEnd (s, from) {
  let i = from;
  for (;;) {
    const q = s.indexOf('"', i);
    if (q < 0) return -1;
    let bs = 0;
    for (let k = q - 1; k >= from && s.charCodeAt(k) === 92; k--) bs++;
    if ((bs & 1) === 0) return q;
    i = q + 1;
  }
}

function isSpace (c) { return c === 32 || c === 10 || c === 13 || c === 9; }

/**
 * A record stream over one validator. `push(chunk)` takes a string, Buffer or
 * Uint8Array and returns null while every record so far is valid, or the
 * first failure as soon as a record fails (and the stream is then done).
 * `end()` closes the input and returns `{ valid, records, errors }`, where
 * `errors` lists every failure seen (one, unless `stopOnFirst` is false).
 */
class RecordStream {
  constructor (validator, opts) {
    this._v = validator;
    this._format = (opts && opts.format) || 'auto';
    this._stop = !(opts && opts.stopOnFirst === false);
    this._onRecord = (opts && typeof opts.onRecord === 'function') ? opts.onRecord : null;
    this._decode = decoderFor();
    this._buf = '';
    this._pos = 0;        // scan position in _buf
    this._start = -1;     // where the element in progress begins, array form
    this._depth = 0;      // nesting inside the current element, array form
    this._opened = false; // the outer '[' has been read
    this._closed = false; // the outer ']' has been read
    this._expectValue = true; // array form: a value may start here (after '[' or ',')
    this.records = 0;
    this.failures = [];
    this.done = false;
    this.result = null;
  }

  // One record's text: parse, validate, report. Returns the failure or null.
  _record (text) {
    const index = this.records++;
    let doc;
    try { doc = JSON.parse(text); } catch (e) { return this._fail(parseFailure(index, e.message)); }
    if (this._v.isValidObject(doc)) {
      if (this._onRecord !== null) this._onRecord(doc, index);
      return null;
    }
    const r = this._v.validate(doc);
    return this._fail(failure(index, r.valid ? [] : r.errors));
  }

  _fail (f) {
    this.failures.push(f);
    if (this._stop) { this.done = true; this.result = { valid: false, records: this.records, errors: this.failures }; }
    return f;
  }

  push (chunk) {
    if (this.done) return this.failures.length ? this.failures[0] : null;
    const text = this._decode(chunk, false);
    if (text.length === 0) return null;
    this._buf += text;
    if (this._format === 'auto') {
      let i = 0;
      while (i < this._buf.length && isSpace(this._buf.charCodeAt(i))) i++;
      if (i === this._buf.length) return null;
      this._format = this._buf.charCodeAt(i) === 91 ? 'array' : 'ndjson';
    }
    return this._format === 'array' ? this._scanArray() : this._scanLines();
  }

  _scanLines () {
    const s = this._buf;
    let from = 0;
    for (;;) {
      const nl = s.indexOf('\n', from);
      if (nl < 0) break;
      let end = nl;
      if (end > from && s.charCodeAt(end - 1) === 13) end--;
      const line = s.slice(from, end);
      from = nl + 1;
      if (line.trim().length === 0) continue;
      const f = this._record(line);
      if (f !== null && this.done) { this._buf = ''; return f; }
    }
    this._buf = from === 0 ? s : s.slice(from);
    return null;
  }

  _scanArray () {
    const s = this._buf;
    const n = s.length;
    let pos = this._pos;
    while (pos < n) {
      const c = s.charCodeAt(pos);
      if (!this._opened) {
        if (isSpace(c)) { pos++; continue; }
        if (c !== 91) return this._syntax('a JSON array must start with "["');
        this._opened = true; pos++; continue;
      }
      if (this._closed) {
        if (isSpace(c)) { pos++; continue; }
        return this._syntax('unexpected text after the closing "]"');
      }
      if (this._start < 0) {
        // Between elements: whitespace, a comma, the closing bracket, or the
        // first character of a value.
        if (isSpace(c)) { pos++; continue; }
        if (c === 93) {
          if (this._expectValue && this.records > 0) return this._syntax('a trailing comma before "]"');
          this._closed = true; pos++; continue;
        }
        if (c === 44) {
          if (this._expectValue) return this._syntax('two commas with no value between');
          this._expectValue = true; pos++; continue;
        }
        if (!this._expectValue) return this._syntax('a value with no comma before it');
        this._start = pos;
        if (c === 34) {
          const q = stringEnd(s, pos + 1);
          if (q < 0) break; // the string continues in the next chunk
          pos = q + 1;
          const f = this._emit(s.slice(this._start, pos));
          if (f !== null) return f;
          continue;
        }
        if (c === 123 || c === 91) { this._depth = 1; pos++; continue; }
        pos++; continue; // a scalar: it runs to a delimiter
      }
      if (this._depth === 0) {
        // A scalar in progress ends at whitespace, a comma or the bracket,
        // which the next round reads.
        if (isSpace(c) || c === 44 || c === 93) {
          const f = this._emit(s.slice(this._start, pos));
          if (f !== null) return f;
          continue;
        }
        pos++; continue;
      }
      // Inside an object or array element.
      if (c === 34) {
        const q = stringEnd(s, pos + 1);
        if (q < 0) break;
        pos = q + 1; continue;
      }
      if (c === 123 || c === 91) { this._depth++; pos++; continue; }
      if (c === 125 || c === 93) {
        this._depth--; pos++;
        if (this._depth === 0) {
          const f = this._emit(s.slice(this._start, pos));
          if (f !== null) return f;
        }
        continue;
      }
      pos++;
    }
    // Keep only the element in progress, or nothing.
    if (this._start >= 0) { this._buf = s.slice(this._start); this._pos = pos - this._start; this._start = 0; }
    else { this._buf = ''; this._pos = 0; }
    return null;
  }

  _syntax (message) {
    this._buf = ''; this._pos = 0; this.done = true;
    return this._fail(parseFailure(this.records, message));
  }

  _emit (text) {
    this._start = -1; this._depth = 0; this._expectValue = false;
    const f = this._record(text);
    if (f !== null && this.done) { this._buf = ''; this._pos = 0; return f; }
    return null;
  }

  end () {
    if (!this.done) {
      const tail = this._decode(new Uint8Array(0), true);
      if (tail) this.push(tail);
      if (!this.done) {
        if (this._format === 'ndjson') { if (this._buf.trim().length > 0) this._record(this._buf); }
        else if (this._format === 'array') {
          if (!this._opened) this._fail(parseFailure(this.records, 'no JSON array in the input'));
          else if (this._start >= 0 || !this._closed) this._fail(parseFailure(this.records, 'the array is not closed'));
        }
      }
      this.done = true;
    }
    this._buf = '';
    this.result = { valid: this.failures.length === 0, records: this.records, errors: this.failures };
    return this.result;
  }
}

function streamValidator (validator, opts) { return new RecordStream(validator, opts); }

// A Node http request (http.IncomingMessage) rather than any other Readable.
// Destroying one at the first failure closes the socket under the response
// the caller writes next: Node's fetch then gets `write EPIPE` and Chrome
// "Failed to fetch", never the 400. So reading stops and the rest of the
// body is drained and dropped; memory stays flat and the answer goes out
// (Node's fetch read it after 24 ms and 1 MB of a 100 MB upload).
function isHttpRequest (source) {
  return typeof source.httpVersion === 'string' && typeof source.resume === 'function';
}

// The whole of an async source (a Node Readable, a Web ReadableStream, any
// async iterable of chunks) through a record stream. On the first failure
// the source is stopped: a Node stream is destroyed (a Node http request is
// drained instead, see isHttpRequest), a Web stream's reader cancelled, an
// iterator returned, so a failing upload is not validated to its end.
async function validateStream (validator, source, opts) {
  const rs = new RecordStream(validator, opts);
  if (source && typeof source.getReader === 'function') {
    const reader = source.getReader();
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const f = rs.push(value);
        if (f !== null && rs.done) { await reader.cancel('ata: record ' + f.record + ' is invalid'); return rs.end(); }
      }
    } finally { reader.releaseLock(); }
    return rs.end();
  }
  const request = isHttpRequest(source);
  // A request's iterator must leave the stream alive when returned.
  const it = request && typeof source.iterator === 'function' ? source.iterator({ destroyOnReturn: false })
    : source[Symbol.asyncIterator] ? source[Symbol.asyncIterator]() : source[Symbol.iterator]();
  for (;;) {
    const { value, done } = await it.next();
    if (done) break;
    const f = rs.push(value);
    if (f !== null && rs.done) {
      if (request) { if (typeof it.return === 'function') await it.return(); source.resume(); }
      else if (typeof source.destroy === 'function') source.destroy();
      else if (typeof it.return === 'function') await it.return();
      return rs.end();
    }
  }
  return rs.end();
}

module.exports = { RecordStream, streamValidator, validateStream, PARSE_KEYWORD };
