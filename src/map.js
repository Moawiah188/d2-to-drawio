// Map the D2 diagram IR (d2target.Diagram) to draw.io pages of cells.
//
// The IR arrives flat: every shape carries a dotted id, a nesting level, and
// ABSOLUTE coordinates. draw.io wants a parent tree with child coordinates
// relative to the parent, so this module rebuilds the tree, converts
// coordinates, and translates styles.

import { createIdAllocator } from './ids.js';
import { resolveColor } from './themes.js';
import { htmlLabel } from './emit.js';

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
};

// D2 arrowhead -> draw.io startArrow/endArrow value + fill flag.
const ARROWHEADS = {
  none: { arrow: 'none', fill: 0 },
  triangle: { arrow: 'block', fill: 1 },
  arrow: { arrow: 'open', fill: 0 },
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

/** Shared style fragments for both vertices and edges. */
function commonTextStyle(s, themeID, style) {
  if (s.fontSize && s.fontSize !== 12) style.push(`fontSize=${s.fontSize}`);
  if (s.color) style.push(`fontColor=${resolveColor(s.color, themeID)}`);
  const bits = fontStyleBits(s);
  if (bits) style.push(`fontStyle=${bits}`);
}

function vertexStyle(shape, themeID, warnings) {
  const style = [];
  const isContainer = shape.level != null && shape.__hasChildren;

  let prefix = SHAPE_STYLES[shape.type];
  if (prefix === undefined) {
    warnings.add(
      `shape-${shape.type}`,
      `shape "${shape.type}" has no draw.io mapping; rendered as a rectangle (first: ${shape.id})`
    );
    prefix = '';
  }
  if (prefix) style.push(prefix.replace(/;$/, ''));
  if (prefix === '' || prefix === undefined) {
    style.push(shape.borderRadius > 0 ? 'rounded=1' : 'rounded=0');
  } else if (shape.borderRadius > 0) {
    style.push('rounded=1');
  }
  style.push('whiteSpace=wrap', 'html=1');

  if (isContainer) style.push('container=1', 'collapsible=0', 'verticalAlign=top');

  if (shape.fill) style.push(`fillColor=${resolveColor(shape.fill, themeID)}`);
  if (shape.stroke) style.push(`strokeColor=${resolveColor(shape.stroke, themeID)}`);
  if (shape.strokeWidth && shape.strokeWidth !== 1) style.push(`strokeWidth=${shape.strokeWidth}`);
  if (shape.strokeDash) {
    style.push('dashed=1', `dashPattern=${shape.strokeDash} ${shape.strokeDash}`);
  }
  if (shape.opacity != null && shape.opacity < 1) {
    style.push(`opacity=${Math.round(shape.opacity * 100)}`);
  }
  if (shape.shadow) style.push('shadow=1');
  commonTextStyle(shape, themeID, style);

  for (const [flag, code] of [
    ['multiple', 'style-multiple'],
    ['3d', 'style-3d'],
    ['double-border', 'style-double-border'],
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
  commonTextStyle(conn, themeID, style);
  return style.join(';') + ';';
}

/**
 * Find a shape's parent id: the longest dotted prefix that names an existing
 * shape one nesting level up. Returns null for top-level shapes.
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

/**
 * Map one board (diagram IR) to a draw.io page.
 *
 * @returns {{name: string, cells: object[]}}
 */
export function mapBoard(diagram, options, warnings) {
  const themeID = options.themeID ?? 0;
  const idFor = createIdAllocator();
  const byId = new Map();
  for (const s of diagram.shapes ?? []) byId.set(s.id, s);

  // Mark containers so vertexStyle can add container=1.
  for (const s of byId.values()) {
    const pid = parentIdOf(s, byId);
    s.__parentId = pid;
    if (pid) byId.get(pid).__hasChildren = true;
  }

  const cells = [];
  const emitted = new Set();

  // Parents first (level ascending), then IR order for stable stacking.
  const shapes = [...byId.values()].sort((a, b) => (a.level ?? 1) - (b.level ?? 1));

  for (const shape of shapes) {
    const parentShape = shape.__parentId ? byId.get(shape.__parentId) : null;
    const x = shape.pos.x - (parentShape ? parentShape.pos.x : 0);
    const y = shape.pos.y - (parentShape ? parentShape.pos.y : 0);
    const isText = shape.type === 'text';

    cells.push({
      id: idFor(shape.id),
      value: htmlLabel(shape.label ?? ''),
      style: isText ? textStyle(shape, themeID) : vertexStyle(shape, themeID, warnings),
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
    if (!emitted.has(conn.src) || !emitted.has(conn.dst)) {
      warnings.add(
        'edge-endpoint-missing',
        `connection ${conn.src} -> ${conn.dst} skipped: endpoint not rendered`
      );
      continue;
    }
    const cell = {
      id: `edge-${edgeN++}`,
      value: htmlLabel(conn.label ?? ''),
      style: edgeStyle(conn, themeID, options, warnings),
      parent: '1',
      edge: true,
      source: idFor(conn.src),
      target: idFor(conn.dst),
      tooltip: conn.tooltip || null,
      link: conn.link || null,
    };
    if (options.waypoints && Array.isArray(conn.route) && conn.route.length > 2) {
      cell.points = conn.route.slice(1, -1);
    }
    cells.push(cell);
  }

  // The board's root pseudo-shape carries the page background fill.
  const background = diagram.root?.fill ? resolveColor(diagram.root.fill, themeID) : null;

  return { name: diagram.name || 'Page-1', cells, background };
}
