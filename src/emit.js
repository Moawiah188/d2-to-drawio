// draw.io XML emission.
//
// Input is a list of pages, each holding an ordered list of cells (vertices
// and edges). Output is an uncompressed .drawio mxfile string.
//
// Invariants enforced here, per the draw.io format contract:
//   mxfile > diagram > mxGraphModel > root, root cells "0" and "1",
//   every vertex carries mxGeometry with numeric x/y/width/height,
//   cells with a tooltip or link are wrapped in an <object> element that
//   carries the id and label while the inner mxCell carries neither.
//
// Attribute order is fixed so identical input produces byte-identical output.

/** Escape text for an XML attribute value. */
export function escAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/\r?\n/g, '&#10;');
}

/** Escape text destined for HTML content inside a draw.io html=1 label. */
export function escHtml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Build a draw.io html=1 label from plain text: HTML-escape it and turn
 * newlines into <br>. draw.io re-parses the cell value as HTML, so raw text
 * must be escaped once here (and once more as an XML attribute at emit).
 */
export function htmlLabel(s) {
  return escHtml(s).replace(/\r?\n/g, '<br>');
}

/** Format a coordinate: round to 2 decimals, no trailing zeros. */
export function num(n) {
  return String(Math.round(n * 100) / 100);
}

function vertexXml(cell) {
  const geom = `<mxGeometry x="${num(cell.x)}" y="${num(cell.y)}" width="${num(cell.w)}" height="${num(cell.h)}" as="geometry"/>`;
  const core = (id, value) =>
    `<mxCell${id}${value} style="${escAttr(cell.style)}" vertex="1" parent="${escAttr(cell.parent)}">${geom}</mxCell>`;

  if (cell.tooltip || cell.link) {
    // Metadata wrapper: id and label move to the <object>; the inner mxCell
    // carries neither (draw.io's own codec does the same id hoisting).
    let attrs = ` label="${escAttr(cell.value)}"`;
    if (cell.tooltip) attrs += ` tooltip="${escAttr(cell.tooltip)}"`;
    if (cell.link) attrs += ` link="${escAttr(cell.link)}"`;
    return `<object${attrs} id="${escAttr(cell.id)}">${core('', '')}</object>`;
  }
  return core(` id="${escAttr(cell.id)}"`, ` value="${escAttr(cell.value)}"`);
}

function edgeXml(cell) {
  let geom;
  if (cell.points && cell.points.length > 0) {
    const pts = cell.points.map((p) => `<mxPoint x="${num(p.x)}" y="${num(p.y)}"/>`).join('');
    geom = `<mxGeometry relative="1" as="geometry"><Array as="points">${pts}</Array></mxGeometry>`;
  } else {
    geom = `<mxGeometry relative="1" as="geometry"/>`;
  }
  const core = (id, value) =>
    `<mxCell${id}${value} style="${escAttr(cell.style)}" edge="1" parent="${escAttr(
      cell.parent
    )}" source="${escAttr(cell.source)}" target="${escAttr(cell.target)}">${geom}</mxCell>`;

  if (cell.tooltip || cell.link) {
    let attrs = ` label="${escAttr(cell.value)}"`;
    if (cell.tooltip) attrs += ` tooltip="${escAttr(cell.tooltip)}"`;
    if (cell.link) attrs += ` link="${escAttr(cell.link)}"`;
    return `<object${attrs} id="${escAttr(cell.id)}">${core('', '')}</object>`;
  }
  return core(` id="${escAttr(cell.id)}"`, ` value="${escAttr(cell.value)}"`);
}

/**
 * Emit a complete uncompressed .drawio file.
 *
 * @param {Array<{name: string, cells: Array<object>, background?: string}>} pages
 * @returns {string}
 */
export function emit(pages) {
  const diagrams = pages.map((page, i) => {
    const cells = page.cells
      .map((c) => (c.edge ? edgeXml(c) : vertexXml(c)))
      .join('');
    const background =
      page.background && page.background !== 'none'
        ? ` background="${escAttr(page.background)}"`
        : '';
    return (
      `<diagram id="page-${i + 1}" name="${escAttr(page.name)}">` +
      `<mxGraphModel dx="800" dy="600" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" ` +
      `arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0"${background}>` +
      `<root><mxCell id="0"/><mxCell id="1" parent="0"/>${cells}</root>` +
      `</mxGraphModel></diagram>`
    );
  });
  return `<mxfile host="app.diagrams.net" type="device">${diagrams.join('')}</mxfile>\n`;
}
