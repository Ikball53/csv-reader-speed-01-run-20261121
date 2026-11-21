// Fast drop-in for csv-reader 1.0.0: run({text, header}) -> {columns, rows, errors}.
// Single left-to-right pass over char codes; unquoted fields are sliced out of the
// source text in one piece, quoted fields are sliced segment by segment, and the
// broken-row policy (BOM, blank lines, stray CR, quote junk, unterminated quote,
// short/long rows, error lines/rows) follows the reference reader exactly.

const COMMA = 0;
const LINE_BREAK = 1;
const END = 2;

/** csv-reader 1.0.0's answer for one case's input, computed faster. */
export function run(input) {
  const text = String(input.text);
  const header = input.header === true;
  const n = text.length;
  const errors = [];
  const rows = [];
  let columns = null;
  let width = -1;

  let pos = 0; // next index to read
  let line = 1; // 1-based line of that index
  if (n > 0 && text.charCodeAt(0) === 0xfeff) pos = 1;

  // The record being read: the line it starts on and its index in rows (null: header).
  let recordLine = 1;
  let recordRow = null;

  // How the last field read ended, and how many characters an unquoted read kept.
  let fEnded = END;
  let fAdded = 0;

  // Reads unquoted characters from `start` onto `prefix`, up to the next comma or
  // line break. A CR not followed by LF is dropped (stray_cr). Sets pos/line/fEnded.
  function readUnquoted(start, prefix) {
    let i = start;
    let stray = false;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 44) { fEnded = COMMA; break; }
      if (c === 10) { fEnded = LINE_BREAK; break; }
      if (c === 13) {
        if (i + 1 < n && text.charCodeAt(i + 1) === 10) { fEnded = LINE_BREAK; break; }
        stray = true;
        i += 1;
        continue;
      }
      i += 1;
    }
    if (i >= n) fEnded = END;

    let value;
    if (!stray) {
      fAdded = i - start;
      value = prefix === '' ? text.slice(start, i) : prefix + text.slice(start, i);
    } else {
      // Rebuild without the lone CRs (every CR in [start, i) is lone: a CRLF
      // would have ended the field at its CR), reporting each one.
      let out = prefix;
      let seg = start;
      let added = 0;
      for (let j = start; j < i; j += 1) {
        if (text.charCodeAt(j) === 13) {
          errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
          if (j > seg) { out += text.slice(seg, j); added += j - seg; }
          seg = j + 1;
        }
      }
      if (i > seg) { out += text.slice(seg, i); added += i - seg; }
      fAdded = added;
      value = out;
    }

    if (fEnded === COMMA) pos = i + 1;
    else if (fEnded === LINE_BREAK) { pos = text.charCodeAt(i) === 10 ? i + 1 : i + 2; line += 1; }
    else pos = n;
    return value;
  }

  // Reads a quoted field whose opening quote is at pos. Sets pos/line/fEnded.
  function readQuoted() {
    const open = pos;
    const openLine = line;
    // No quote anywhere after the opening one: it can never close.
    if (text.indexOf('"', open + 1) === -1) {
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted(open + 1, '"');
    }
    let i = open + 1;
    let seg = i;
    let parts = null;
    let closed = false;
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 34) {
        if (i + 1 < n && text.charCodeAt(i + 1) === 34) {
          if (parts === null) parts = [];
          parts.push(text.slice(seg, i), '"');
          i += 2;
          seg = i;
          continue;
        }
        closed = true;
        break;
      }
      if (c === 13) {
        // CRLF and a lone CR inside quotes are each one LF.
        if (parts === null) parts = [];
        parts.push(text.slice(seg, i), '\n');
        line += 1;
        i += i + 1 < n && text.charCodeAt(i + 1) === 10 ? 2 : 1;
        seg = i;
        continue;
      }
      if (c === 10) line += 1;
      i += 1;
    }
    if (!closed) {
      // The quote never closes: it is a literal character, and the text after
      // it is read again as an unquoted field.
      line = openLine;
      errors.push({ code: 'unterminated_quote', line: recordLine, row: recordRow });
      return readUnquoted(open + 1, '"');
    }
    let value;
    if (parts === null) value = text.slice(seg, i);
    else { parts.push(text.slice(seg, i)); value = parts.join(''); }
    pos = i + 1;
    if (pos >= n) { fEnded = END; return value; }
    const c = text.charCodeAt(pos);
    if (c === 44) { pos += 1; fEnded = COMMA; return value; }
    if (c === 10) { pos += 1; line += 1; fEnded = LINE_BREAK; return value; }
    if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) {
      pos += 2; line += 1; fEnded = LINE_BREAK; return value;
    }
    // What follows the closing quote is appended as it stands, up to the next
    // comma or line break (quote_junk when anything was kept).
    const joined = readUnquoted(pos, value);
    if (fAdded > 0) errors.push({ code: 'quote_junk', line: recordLine, row: recordRow });
    return joined;
  }

  while (true) {
    // Lines with no characters are no records.
    while (pos < n) {
      const c = text.charCodeAt(pos);
      if (c === 10) { pos += 1; line += 1; }
      else if (c === 13 && pos + 1 < n && text.charCodeAt(pos + 1) === 10) { pos += 2; line += 1; }
      else break;
    }
    if (pos >= n) break;

    recordLine = line;
    recordRow = header && columns === null ? null : rows.length;
    const fields = [];
    let lastQuoted = false;
    do {
      if (pos < n && text.charCodeAt(pos) === 34) {
        lastQuoted = true;
        fields.push(readQuoted());
      } else {
        lastQuoted = false;
        // Inline unquoted fast path (empty prefix): scan to the next comma or
        // line break and slice the field out in one piece.
        const start = pos;
        let i = start;
        let stray = false;
        while (i < n) {
          const c = text.charCodeAt(i);
          if (c === 44) { fEnded = COMMA; break; }
          if (c === 10) { fEnded = LINE_BREAK; break; }
          if (c === 13) {
            if (i + 1 < n && text.charCodeAt(i + 1) === 10) { fEnded = LINE_BREAK; break; }
            stray = true;
            i += 1;
            continue;
          }
          i += 1;
        }
        if (i >= n) fEnded = END;
        let value;
        if (!stray) {
          value = text.slice(start, i);
        } else {
          let out = '';
          let seg = start;
          for (let j = start; j < i; j += 1) {
            if (text.charCodeAt(j) === 13) {
              errors.push({ code: 'stray_cr', line: recordLine, row: recordRow });
              if (j > seg) out += text.slice(seg, j);
              seg = j + 1;
            }
          }
          if (i > seg) out += text.slice(seg, i);
          value = out;
        }
        if (fEnded === COMMA) pos = i + 1;
        else if (fEnded === LINE_BREAK) { pos = text.charCodeAt(i) === 10 ? i + 1 : i + 2; line += 1; }
        else pos = n;
        fields.push(value);
      }
    } while (fEnded === COMMA);

    // A line that held only stray CRs is left with no characters: no record
    // (its stray_cr errors stay).
    if (fields.length === 1 && fields[0] === '' && !lastQuoted) continue;

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
