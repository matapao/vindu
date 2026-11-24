// Delimited text (CSV with commas, TSV with tabs) read into records of fields, as RFC 4180 writes them: a field in
// double quotes may hold the separator, line breaks and quotes (each written twice); records end in CRLF or LF. A UTF-8
// byte order mark is not text, and a line with nothing on it is no record.

/** The records of a delimited text, each its fields as written. Throws when a quoted field is never closed. */
export function parseDelimited(text: string, separator: ',' | '\t'): string[][] {
  const records: string[][] = [];
  let record: string[] = [], field = '', quoted = false, openedAt = 0, line = 1;
  const endField = () => { record.push(field); field = ''; };
  const endRecord = () => {
    endField();
    if (record.length > 1 || record[0] !== '') records.push(record);
    record = [];
  };
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (quoted) {
      if (c === '"' && body[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else { if (c === '\n') line++; field += c; }
    } else if (c === '"' && field === '') { quoted = true; openedAt = line; }
    else if (c === separator) endField();
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && body[i + 1] === '\n') i++;
      line++; endRecord();
    } else field += c;
  }
  if (quoted) throw new Error(`a quoted field that starts on line ${openedAt} is never closed`);
  if (field !== '' || record.length) endRecord();
  return records;
}
