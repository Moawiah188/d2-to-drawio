// Map the D2 diagram IR (d2target.Diagram) to draw.io pages of cells.
//
// The IR arrives flat: every shape carries a dotted id, a nesting level, and
// ABSOLUTE coordinates. draw.io wants a parent tree with child coordinates
// relative to the parent, so this module rebuilds the tree, converts
// coordinates, and translates styles.

import { createIdAllocator } from './ids.js';
import { resolveColor } from './themes.js';
import { htmlLabel, escHtml } from './emit.js';
import { sqlTableLabel, classLabel, iconUrl } from './special.js';

// D2 shape type -> draw.io style prefix. Values verified against the draw.io
// default stylesheet where possible; visual fidelity is refined per fixture.
const SHAPE_STYLES = {
  rectangle: '',
  square: '',
  page: 'shape=note;',
  parallelogram: 'shape=parallelogram;perimeter=parallelogramPerimeter;',
  document: 'shape=document;',
  cylinder: 'shape=cylinder3;boundedLbl=1;backgroundOutline=1;size=15;',
  queue: 'shape=cylinder3;direction=north;boundedLbl=1;backgroundOutline=1;size=15;',
  package: 'shape=folder;tabWidth=60;tabHeight=20;tabPosition=left;',
  step: 'shape=step;perimeter=stepPerimeter;',
  callout: 'shape=callout;',
  stored_data: 'shape=dataStorage;',
  person: 'shape=actor;',
  'c4-person': 'shape=actor;',
  diamond: 'rhombus;',
  oval: 'ellipse;',
  circle: 'ellipse;',
  hexagon: 'shape=hexagon;perimeter=hexagonPerimeter2;',
  cloud: 'shape=cloud;',
  // Structured shapes render as one vertex with a formatted label.
  sql_table: '',
  class: '',
  // Sequence containers render as a plain frame.
  sequence_diagram: '',
};

// D2 arrowhead -> draw.io startArrow/endArrow value + fill flag.
// The IR vocabulary was probed live: filled variants arrive as
// "filled-diamond", explicit unfilled triangles as "unfilled-triangle".
const ARROWHEADS = {
  none: { arrow: 'none', fill: 0 },
  triangle: { arrow: 'block', fill: 1 },
  'unfilled-triangle': { arrow: 'block', fill: 0 },
  arrow: { arrow: 'classicThin', fill: 1 },
  diamond: { arrow: 'diamond', fill: 0 },
  'filled-diamond': { arrow: 'diamond', fill: 1 },
  circle: { arrow: 'oval', fill: 0 },
  'filled-circle': { arrow: 'oval', fill: 1 },
  box: { arrow: 'box', fill: 0 },
  'filled-box': { arrow: 'box', fill: 1 },
  'cf-one': { arrow: 'ERone', fill: 0 },
  'cf-one-required': { arrow: 'ERmandOne', fill: 0 },
  'cf-many': { arrow: 'ERzeroToMany', fill: 0 },
  'cf-many-required': { arrow: 'ERoneToMany', fill: 0 },
  cross: { arrow: 'cross', fill: 0 },
};

function fontStyleBits(s) {
  let bits = 0;
  if (s.bold) bits |= 1;
  if (s.italic) bits |= 2;
  if (s.underline) bits |= 4;
  return bits;
}

/** Shared text style fragments for both vertices and edges. */
function commonTextStyle(s, themeID, style) {
  if (s.fontSize && s.fontSize !== 12) style.push(`fontSize=${s.fontSize}`);
  if (s.color) style.push(`fontColor=${resolveColor(s.color, themeID)}`);
  if (s.fontFamily === 'mono') style.push('fontFamily=Courier New');
  const bits = fontStyleBits(s);
  if (bits) style.push(`fontStyle=${bits}`);
}

/**
 * Translate the IR labelPosition (e.g. INSIDE_TOP_CENTER, OUTSIDE_BOTTOM_LEFT)
 * into draw.io align keys. The INSIDE_MIDDLE_CENTER default adds nothing.
 */
function labelPositionStyle(pos, style) {
  if (!pos || pos === 'INSIDE_MIDDLE_CENTER' || pos === 'UNLOCKED') return;
  const m = /^(INSIDE|OUTSIDE|BORDER)_(TOP|MIDDLE|BOTTOM)_(LEFT|CENTER|RIGHT)$/.exec(pos);
  if (!m) return;
  const [, region, vert, horiz] = m;
  if (region === 'OUTSIDE' && vert === 'TOP') {
    style.push('verticalLabelPosition=top', 'verticalAlign=bottom');
  } else if (region === 'OUTSIDE' && vert === 'BOTTOM') {
    style.push('verticalLabelPosition=bottom', 'verticalAlign=top');
  } else if (region === 'OUTSIDE' && vert === 'MIDDLE' && horiz === 'LEFT') {
    style.push('labelPosition=left', 'align=right');
    return;
  } else if (region === 'OUTSIDE' && vert === 'MIDDLE' && horiz === 'RIGHT') {
    style.push('labelPosition=right', 'align=left');
    return;
  } else {
    // INSIDE and BORDER variants approximate to inside alignment.
    if (vert === 'TOP') style.push('verticalAlign=top');
    if (vert === 'BOTTOM') style.push('verticalAlign=bottom');
  }
  if (horiz === 'LEFT') style.push('align=left');
  if (horiz === 'RIGHT') style.push('align=right');
}

function vertexStyle(shape, themeID, warnings) {
  const style = [];
  const isContainer = Boolean(shape.__hasChildren);

  let prefix = SHAPE_STYLES[shape.type];
  if (prefix === undefined) {
    warnings.add(
      `shape-${shape.type}`,
      `shape "${shape.type}" has no draw.io mapping; rendered as a rectangle (first: ${shape.id})`
    );
    prefix = '';
  }
  if (prefix) style.push(prefix.replace(/;$/, ''));
  else style.push(shape.borderRadius > 0 ? 'rounded=1' : 'rounded=0');
  if (prefix && shape.borderRadius > 0) style.push('rounded=1');
  style.push('whiteSpace=wrap', 'html=1');

  if (isContainer) {
    style.push('container=1', 'collapsible=0', 'verticalAlign=top');
  } else {
    labelPositionStyle(shape.labelPosition, style);
  }
  const isTable = shape.type === 'sql_table' || shape.type === 'class';
  if (isTable) {
    // D2 table semantics invert the usual keys: fill colors the HEADER
    // band, stroke fills the BODY, color is the header text. A single
    // draw.io shape gets the body fill and a header-colored border; the
    // label builder colors the header text to match.
    style.push('align=left', 'spacingLeft=6', 'spacingRight=6', 'verticalAlign=top');
    if (shape.stroke) style.push(`fillColor=${resolveColor(shape.stroke, themeID)}`);
    if (shape.fill) style.push(`strokeColor=${resolveColor(shape.fill, themeID)}`);
  } else {
    if (shape.fill) style.push(`fillColor=${resolveColor(shape.fill, themeID)}`);
    if (shape.stroke) style.push(`strokeColor=${resolveColor(shape.stroke, themeID)}`);
  }
  if (shape.strokeWidth && shape.strokeWidth !== 1) style.push(`strokeWidth=${shape.strokeWidth}`);
  if (shape.strokeDash) {
    style.push('dashed=1', `dashPattern=${shape.strokeDash} ${shape.strokeDash}`);
  }
  if (shape.opacity != null && shape.opacity < 1) {
    style.push(`opacity=${Math.round(shape.opacity * 100)}`);
  }
  if (shape.shadow) style.push('shadow=1');
  if (isTable) {
    // Body text stays default-dark; shape.color is the header text color
    // and is applied inside the label instead.
    if (shape.fontSize && shape.fontSize !== 12) style.push(`fontSize=${shape.fontSize}`);
  } else {
    commonTextStyle(shape, themeID, style);
  }

  for (const [flag, code] of [
    ['multiple', 'style-multiple'],
    ['3d', 'style-3d'],
    ['double-border', 'style-double-border'],
    ['animated', 'style-animated'],
    ['fillPattern', 'style-fill-pattern'],
  ]) {
    if (shape[flag]) {
      warnings.add(code, `style "${flag}" has no draw.io equivalent; ignored (first: ${shape.id})`);
    }
  }
  return style.join(';') + ';';
}

function textStyle(shape, themeID) {
  const style = ['text', 'html=1', 'align=center', 'verticalAlign=middle'];
  commonTextStyle(shape, themeID, style);
  return style.join(';') + ';';
}

function codeStyle(shape, themeID) {
  const style = [
    'rounded=0',
    'whiteSpace=wrap',
    'html=1',
    'align=left',
    'verticalAlign=middle',
    'spacingLeft=6',
    'fontFamily=Courier New',
  ];
  if (shape.fill) style.push(`fillColor=${resolveColor(shape.fill, themeID)}`);
  if (shape.stroke) style.push(`strokeColor=${resolveColor(shape.stroke, themeID)}`);
  commonTextStyle(shape, themeID, style);
  return style.join(';') + ';';
}

function imageStyle(shape, url) {
  const style = [
    'shape=image',
    'imageAspect=0',
    'verticalLabelPosition=bottom',
    'verticalAlign=top',
    'html=1',
    `image=${url}`,
  ];
  return style.join(';') + ';';
}

function arrowFor(value, connId, warnings) {
  const hit = ARROWHEADS[value];
  if (hit) return hit;
  warnings.add(
    `arrowhead-${value}`,
    `arrowhead "${value}" has no draw.io mapping; using a filled triangle (first: ${connId})`
  );
  return ARROWHEADS.triangle;
}

function edgeStyle(conn, themeID, options, warnings) {
  const style = ['edgeStyle=orthogonalEdgeStyle', 'rounded=0', 'html=1'];
  if (options.waypoints && conn.isCurve) style.push('curved=1');

  const src = arrowFor(conn.srcArrow ?? 'none', conn.id, warnings);
  const dst = arrowFor(conn.dstArrow ?? 'none', conn.id, warnings);
  style.push(`startArrow=${src.arrow}`, `startFill=${src.fill}`);
  style.push(`endArrow=${dst.arrow}`, `endFill=${dst.fill}`);

  if (conn.stroke) {
    const c = resolveColor(conn.stroke, themeID);
    style.push(`strokeColor=${c}`);
    if (!conn.color) style.push(`fontColor=${c}`);
  }
  if (conn.strokeWidth && conn.strokeWidth !== 1) style.push(`strokeWidth=${conn.strokeWidth}`);
  if (conn.strokeDash) style.push('dashed=1', `dashPattern=${conn.strokeDash} ${conn.strokeDash}`);
  if (conn.opacity != null && conn.opacity < 1) style.push(`opacity=${Math.round(conn.opacity * 100)}`);
  if (conn.animated) {
    warnings.add(
      'style-animated',
      `style "animated" has no draw.io equivalent; ignored (first: ${conn.id})`
    );
  }
  commonTextStyle(conn, themeID, style);
  return style.join(';') + ';';
}

/**
 * Find a shape's parent id: the longest dotted prefix that names an existing
 * shape one nesting level up. Quoted segments (ids may contain '"x.y"') are
 * safe because a prefix cut inside quotes never matches an existing id.
 */
function parentIdOf(shape, byId) {
  if (shape.level == null || shape.level <= 1) return null;
  const id = shape.id;
  for (let i = id.length - 1; i > 0; i--) {
    if (id[i] !== '.') continue;
    const candidate = id.slice(0, i);
    const parent = byId.get(candidate);
    if (parent && parent.level === shape.level - 1) return candidate;
  }
  return null;
}

/** Build the label cell value for a shape, dispatching on its type. */
function shapeValue(shape, warnings, themeID) {
  const headerColor = shape.fill ? resolveColor(shape.fill, themeID) : null;
  if (shape.type === 'sql_table') {
    warnings.add(
      'sql-table-label',
      `sql_table rendered as a single shape with formatted rows, not editable table cells (first: ${shape.id})`
    );
    return sqlTableLabel(shape, headerColor);
  }
  if (shape.type === 'class') {
    warnings.add(
      'class-label',
      `class rendered as a single shape with formatted members, not editable rows (first: ${shape.id})`
    );
    return classLabel(shape, headerColor);
  }
  if (shape.language === 'latex' || shape.language === 'tex') {
    // draw.io renders $$...$$ via MathJax when the page has math=1.
    return `$$${escHtml(shape.label ?? '')}$$`;
  }
  if (shape.type === 'text' && shape.language === 'markdown') {
    warnings.add(
      'text-markdown',
      `markdown text is rendered as plain text; formatting is lost (first: ${shape.id})`
    );
  }
  return htmlLabel(shape.label ?? '');
}

/**
 * Map one board (diagram IR) to a draw.io page.
 *
 * @returns {{name: string, cells: object[], background: string|null, math: boolean}}
 */
export function mapBoard(diagram, options, warnings) {
  const themeID = options.themeID ?? 0;
  const idFor = createIdAllocator();
  const byId = new Map();
  for (const s of diagram.shapes ?? []) byId.set(s.id, s);

  // Mark containers and remember sequence-diagram subtrees: their inner
  // edges carry positions along lifelines that anchor-based routing loses.
  const seqPrefixes = [];
  for (const s of byId.values()) {
    const pid = parentIdOf(s, byId);
    s.__parentId = pid;
    if (pid) byId.get(pid).__hasChildren = true;
    if (s.type === 'sequence_diagram') seqPrefixes.push(s.id + '.');
  }
  const inSequence = (id) => seqPrefixes.some((p) => String(id).startsWith(p));

  const cells = [];
  const emitted = new Set();
  let pageMath = false;

  // Parents first (level ascending), then z-index, then IR order.
  const order = new Map([...byId.keys()].map((k, i) => [k, i]));
  const shapes = [...byId.values()].sort(
    (a, b) =>
      (a.level ?? 1) - (b.level ?? 1) ||
      (a.zIndex ?? 0) - (b.zIndex ?? 0) ||
      order.get(a.id) - order.get(b.id)
  );

  for (const shape of shapes) {
    const parentShape = shape.__parentId ? byId.get(shape.__parentId) : null;
    const x = shape.pos.x - (parentShape ? parentShape.pos.x : 0);
    const y = shape.pos.y - (parentShape ? parentShape.pos.y : 0);

    let style;
    let value;
    const url = iconUrl(shape.icon);
    if (shape.language === 'latex' || shape.language === 'tex') pageMath = true;
    if (shape.type === 'text') {
      value = shapeValue(shape, warnings, themeID);
      style = textStyle(shape, themeID);
    } else if (shape.type === 'code') {
      value = htmlLabel(shape.label ?? '');
      style = codeStyle(shape, themeID);
    } else if (shape.type === 'image' && url) {
      value = htmlLabel(shape.label ?? '');
      style = imageStyle(shape, url);
    } else {
      if (url) {
        warnings.add(
          'icon-on-shape',
          `icons on regular shapes are not mapped; icon dropped (first: ${shape.id})`
        );
      }
      value = shapeValue(shape, warnings, themeID);
      style = vertexStyle(shape, themeID, warnings);
    }

    if (shape.link && /^(layers|scenarios|steps|root|_)(\.|$)/.test(shape.link)) {
      warnings.add(
        'board-link',
        `links to boards (${shape.link}) are kept as literal text and will not navigate in draw.io (first: ${shape.id})`
      );
    }
    cells.push({
      id: idFor(shape.id),
      value,
      style,
      parent: parentShape ? idFor(parentShape.id) : '1',
      x,
      y,
      w: shape.width,
      h: shape.height,
      tooltip: shape.tooltip || null,
      link: shape.link || null,
    });
    emitted.add(shape.id);
  }

  let edgeN = 0;
  for (const conn of diagram.connections ?? []) {
    const route = Array.isArray(conn.route) ? conn.route : [];
    const srcOk = emitted.has(conn.src);
    const dstOk = emitted.has(conn.dst);
    const sequence = inSequence(conn.src) || inSequence(conn.dst);

    // Fixed-geometry edges: sequence content (messages, lifelines, and any
    // connection with a phantom endpoint) keeps d2's computed route.
    const fixed = (sequence || !srcOk || !dstOk) && route.length >= 2;
    if ((!srcOk || !dstOk) && !fixed) {
      warnings.add(
        'edge-endpoint-missing',
        `connection ${conn.src} -> ${conn.dst} skipped: endpoint not rendered`
      );
      continue;
    }
    if (sequence) {
      warnings.add(
        'sequence-fixed',
        'sequence diagram messages and lifelines use fixed geometry; they do not re-route when shapes move'
      );
    }

    const cell = {
      id: `edge-${edgeN++}`,
      value: htmlLabel(conn.label ?? ''),
      style: edgeStyle(conn, themeID, options, warnings),
      parent: '1',
      edge: true,
      tooltip: conn.tooltip || null,
      link: conn.link || null,
    };
    if (fixed) {
      cell.sourcePoint = route[0];
      cell.targetPoint = route[route.length - 1];
      if (route.length > 2) cell.points = route.slice(1, -1);
      // Straight segments, not orthogonal re-routing, for fixed geometry.
      cell.style = cell.style.replace('edgeStyle=orthogonalEdgeStyle;', 'edgeStyle=none;');
    } else {
      cell.source = idFor(conn.src);
      cell.target = idFor(conn.dst);
      if (options.waypoints && route.length > 2) {
        cell.points = route.slice(1, -1);
      }
    }
    cells.push(cell);

    // Arrowhead labels ride the edge as standard draw.io edge-label
    // children positioned near their end.
    for (const [end, rx] of [
      ['srcLabel', -0.75],
      ['dstLabel', 0.75],
    ]) {
      const l = conn[end];
      if (l && l.label) {
        cells.push({
          id: `${cell.id}-${end === 'srcLabel' ? 'src' : 'dst'}-label`,
          value: htmlLabel(l.label),
          style: 'edgeLabel;html=1;align=center;verticalAlign=middle;resizable=0;',
          parent: cell.id,
          edgeLabel: true,
          rx,
        });
      }
    }
  }

  // The board's root pseudo-shape carries the page background fill.
  const background = diagram.root?.fill ? resolveColor(diagram.root.fill, themeID) : null;

  return { name: diagram.name || 'Page-1', cells, background, math: pageMath };
}
