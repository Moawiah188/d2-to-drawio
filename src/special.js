// HTML label builders for D2's structured shapes (sql_table, class).
//
// Both render as a single draw.io vertex whose html=1 label reproduces the
// header and rows. Rows are not individually editable cells; the feature
// matrix documents this as partial support.

import { escHtml } from './emit.js';

const VISIBILITY_PREFIX = { public: '+ ', private: '- ', protected: '# ' };

/** Rebuild a URL string from the Go net/url object the IR carries. */
export function iconUrl(icon) {
  if (!icon || typeof icon !== 'object') return null;
  const scheme = icon.Scheme ? `${icon.Scheme}://` : '';
  const path = icon.RawPath || icon.Path || '';
  const query = icon.RawQuery ? `?${icon.RawQuery}` : '';
  const fragment = icon.Fragment ? `#${icon.Fragment}` : '';
  return `${scheme}${icon.Host ?? ''}${path}${query}${fragment}` || null;
}

function header(text, color) {
  const inner = `<b>${escHtml(text)}</b>`;
  return color ? `<font color="${color}">${inner}</font>` : inner;
}

/** sql_table: header + one line per column with type and constraint tags. */
export function sqlTableLabel(shape, headerColor = null) {
  const rows = (shape.columns ?? []).map((col) => {
    const name = escHtml(col.name?.label ?? '');
    const type = escHtml(col.type?.label ?? '');
    const tags = (col.constraint ?? [])
      .map((c) => (c === 'primary_key' ? 'PK' : c === 'foreign_key' ? 'FK' : c === 'unique' ? 'UNQ' : escHtml(c)))
      .join(', ');
    return `${name}: ${type}${tags ? `&nbsp;&nbsp;<i>${tags}</i>` : ''}`;
  });
  return `${header(shape.label ?? '', headerColor)}<hr>${rows.join('<br>')}`;
}

/** class: header + fields block + methods block, UML visibility prefixes. */
export function classLabel(shape, headerColor = null) {
  const fields = (shape.fields ?? []).map((f) => {
    const vis = VISIBILITY_PREFIX[f.visibility] ?? '';
    const line = `${vis}${escHtml(f.name)}: ${escHtml(f.type)}`;
    return f.underline ? `<u>${line}</u>` : line;
  });
  const methods = (shape.methods ?? []).map((m) => {
    const vis = VISIBILITY_PREFIX[m.visibility] ?? '';
    const ret = m.return ? `: ${escHtml(m.return)}` : '';
    const line = `${vis}${escHtml(m.name)}${ret}`;
    return m.underline ? `<u>${line}</u>` : line;
  });
  let label = header(shape.label ?? '', headerColor);
  label += `<hr>${fields.join('<br>')}`;
  if (methods.length > 0) label += `<hr>${methods.join('<br>')}`;
  return label;
}
