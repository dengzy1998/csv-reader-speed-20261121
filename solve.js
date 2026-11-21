// Fast drop-in for csv-reader 1.0.0 (make.fun's own CSV reader): run(input) returns
// exactly what csv-reader returns for {text, header} -> {columns, rows, errors}.
//
// The reference reads one character at a time and builds every field a character at
// a time. This version keeps the same left-to-right reading and the same broken-row
// policy, but extracts fields by slicing: unquoted fields are scanned with a tight
// charCodeAt loop that only records where the field ends, and quoted fields jump
// from quote to quote with indexOf. A field is therefore (almost always) one slice
// of the input instead of a chain of one-character appends. The field readers
// return the string itself and report how the field ended through shared state, so
// no object is allocated per field, and the common unquoted-field path is inlined
// in the record loop.
//
// Semantics, copied from the reference (vendor/csv-reader/index.js of the kit):
//  - a U+FEFF at the very start of the text is dropped;
//  - a record ends at LF or CRLF, and a line left with no characters is no record;
//  - outside quotes a CR not followed by LF is dropped (stray_cr);
//  - a field that opens with a quote runs to the next quote that is not doubled,
//    "" inside it is one quote and each CRLF or lone CR inside it is read as LF;
//    what follows its closing quote, up to the next comma or line break, is
//    appended as it stands (quote_junk, when the field ends); a quote that never
//    closes is a literal character, and the text after it is read again as
//    unquoted (unterminated_quote);
//  - a quote inside an unquoted field is a literal character;
//  - fields stay strings, never trimmed or converted;
//  - columns is the first record when header is true, else null; rows holds the
//    records after it (every record when header is false), each padded with ""
//    (short_row, with fields: its field count) or cut (long_row, with extra: the
//    cut fields) to the first record's width;
//  - each error is {code, line, row}, in the order met, a record's short_row or
//    long_row when it ends: line the 1-based line its record starts on, counting
//    every LF, CRLF and lone CR inside quotes, and row its record's index in rows,
//    null for the header.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  const len = text.length;
  let pos = 0; // the next character to read
  let line = 1; // the line that character is on
  if (len > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and the index in rows it takes (null: the header).
  let recordLine = 1;
  let recordRow = null;

  // How the last field read ended (COMMA, LINE_BREAK or END), and how many
  // characters the last readUnquoted call kept (the junk path's quote_junk test).
  let ended = END;
  let added = 0;

  function error(code) {
    errors.push({ code, line: recordLine, row: recordRow });
  }

  // Reads unquoted characters from pos up to the next comma or line break: a CR not
  // followed by LF is dropped (stray_cr). Only used where a field already holds a
  // value: re-reading after an unterminated quote (value '"') and the junk after a
  // closing quote. Returns the field string and sets `ended` and `added` (the
  // characters this call kept; the initial value is not counted, so the junk path
  // can tell whether anything was appended). Fresh fields take the inlined path in
  // the record loop below.
  function readUnquoted(value) {
    added = 0;
    let parts = null; // segments kept across dropped CRs; null while the field is one slice
    let segStart = pos;
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 44) { // ','
        added += pos - segStart;
        const field = parts === null
          ? (value === '' ? text.slice(segStart, pos) : value + text.slice(segStart, pos))
          : parts.join('') + text.slice(segStart, pos);
        pos += 1;
        ended = COMMA;
        return field;
      }
      if (c === 10) { // '\n'
        added += pos - segStart;
        const field = parts === null
          ? (value === '' ? text.slice(segStart, pos) : value + text.slice(segStart, pos))
          : parts.join('') + text.slice(segStart, pos);
        pos += 1;
        line += 1;
        ended = LINE_BREAK;
        return field;
      }
      if (c === 13) { // '\r'
        if (text.charCodeAt(pos + 1) === 10) {
          added += pos - segStart;
          const field = parts === null
            ? (value === '' ? text.slice(segStart, pos) : value + text.slice(segStart, pos))
            : parts.join('') + text.slice(segStart, pos);
          pos += 2;
          line += 1;
          ended = LINE_BREAK;
          return field;
        }
        error('stray_cr');
        added += pos - segStart;
        if (parts === null) {
          parts = value === '' ? [] : [value];
          value = '';
        }
        parts.push(text.slice(segStart, pos));
        pos += 1;
        segStart = pos;
        continue;
      }
      pos += 1;
    }
    added += pos - segStart;
    const field = parts === null
      ? (value === '' ? text.slice(segStart, pos) : value + text.slice(segStart, pos))
      : parts.join('') + text.slice(segStart, pos);
    ended = END;
    return field;
  }

  // Appends text[a..b) to `value`, reading each CRLF or lone CR inside it as one
  // LF and counting the lines it spans. Fast path: no line break in the span, so
  // it is one slice.
  function appendSpan(value, a, b) {
    const n = text.indexOf('\n', a);
    if (n === -1 || n >= b) {
      const r = text.indexOf('\r', a);
      if (r === -1 || r >= b) return value === '' ? text.slice(a, b) : value + text.slice(a, b);
    }
    const parts = value === '' ? [] : [value];
    let i = a;
    while (i < b) {
      let nn = text.indexOf('\n', i);
      if (nn === -1 || nn >= b) nn = b;
      let rr = text.indexOf('\r', i);
      if (rr === -1 || rr >= b) rr = b;
      const m = nn < rr ? nn : rr;
      parts.push(text.slice(i, m));
      if (m === b) break;
      parts.push('\n');
      line += 1;
      i = m === nn ? m + 1 : (text.charCodeAt(m + 1) === 10 ? m + 2 : m + 1);
    }
    return parts.join('');
  }

  // Reads a quoted field whose opening quote is at pos. Returns the field string
  // and sets `ended`.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    let value = '';
    let segStart = pos + 1;
    let cur = pos + 1;
    while (true) {
      const q = text.indexOf('"', cur);
      if (q === -1) {
        // The quote never closes: it is a literal character, and the text after it
        // is read again as unquoted.
        pos = open + 1;
        line = openLine;
        error('unterminated_quote');
        return readUnquoted('"');
      }
      if (text.charCodeAt(q + 1) === 34) {
        // A doubled quote: one quote, and the field goes on.
        value = appendSpan(value, segStart, q) + '"';
        cur = q + 2;
        segStart = q + 2;
        continue;
      }
      value = appendSpan(value, segStart, q);
      pos = q + 1;
      if (pos >= len) {
        ended = END;
        return value;
      }
      const c = text.charCodeAt(pos);
      if (c === 44) { // ','
        pos += 1;
        ended = COMMA;
        return value;
      }
      if (c === 10) { // '\n'
        pos += 1;
        line += 1;
        ended = LINE_BREAK;
        return value;
      }
      if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
        ended = LINE_BREAK;
        return value;
      }
      // What follows the closing quote is appended as it stands, up to the next
      // comma or line break.
      const junk = readUnquoted(value);
      if (added > 0) error('quote_junk');
      return junk;
    }
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < len) {
      const c = text.charCodeAt(pos);
      if (c === 10) {
        pos += 1;
        line += 1;
      } else if (c === 13 && text.charCodeAt(pos + 1) === 10) {
        pos += 2;
        line += 1;
      } else {
        break;
      }
    }
    if (pos >= len) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let quoted = false;
    while (true) {
      if (text.charCodeAt(pos) === 34) {
        quoted = true;
        fields.push(readQuoted());
      } else {
        // Fresh unquoted field, inlined: scan to the next comma or line break
        // and take one slice. A CR not followed by LF is dropped (stray_cr)
        // and the field goes on across it.
        quoted = false;
        let segStart = pos;
        let parts = null;
        ended = END;
        while (pos < len) {
          const c = text.charCodeAt(pos);
          if (c === 44) { // ','
            fields.push(parts === null ? text.slice(segStart, pos) : parts.join('') + text.slice(segStart, pos));
            pos += 1;
            ended = COMMA;
            break;
          }
          if (c === 10) { // '\n'
            fields.push(parts === null ? text.slice(segStart, pos) : parts.join('') + text.slice(segStart, pos));
            pos += 1;
            line += 1;
            ended = LINE_BREAK;
            break;
          }
          if (c === 13) { // '\r'
            if (text.charCodeAt(pos + 1) === 10) {
              fields.push(parts === null ? text.slice(segStart, pos) : parts.join('') + text.slice(segStart, pos));
              pos += 2;
              line += 1;
              ended = LINE_BREAK;
              break;
            }
            error('stray_cr');
            if (parts === null) parts = [];
            parts.push(text.slice(segStart, pos));
            pos += 1;
            segStart = pos;
            continue;
          }
          pos += 1;
        }
        if (ended === END) {
          fields.push(parts === null ? text.slice(segStart, pos) : parts.join('') + text.slice(segStart, pos));
        }
      }
      if (ended !== COMMA) break;
    }

    // A line that held only stray CRs is left with no characters: no record (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !quoted) continue;

    if (width < 0) width = fields.length;
    if (header && columns === null) {
      columns = fields;
      continue;
    }
    if (fields.length < width) {
      errors.push({ code: 'short_row', line: recordLine, row: recordRow, fields: fields.length });
      while (fields.length < width) fields.push('');
    } else if (fields.length > width) {
      errors.push({ code: 'long_row', line: recordLine, row: recordRow, extra: fields.splice(width) });
    }
    rows.push(fields);
  }
  return { columns: header ? (columns ?? []) : null, rows, errors };
}
