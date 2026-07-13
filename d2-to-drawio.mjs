#!/usr/bin/env node
/**
 * d2-to-drawio.mjs
 *
 * Convert a house-dialect D2 file plus its rendered SVG (d2 v0.7.x output)
 * into an editable, uncompressed draw.io file.
 *
 *   node d2-to-drawio.mjs <input.d2> <input.svg> <output.drawio>
 *
 * Structure (shapes, containers, edges, classes, labels) comes from the .d2
 * and its imported template's `classes:` block. Geometry (absolute x/y/w/h)
 * comes from the SVG, whose top-level groups are keyed by base64 of the full
 * d2 key. draw.io re-routes edges itself; no waypoints are emitted.
 *
 * Node >= 18, ESM, zero npm dependencies.
 */

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import process from 'node:process';

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function fail(msg) {
  console.error(`ERROR: ${msg}`);
  process.exit(1);
}

function warn(msg) {
  console.error(`WARN: ${msg}`);
}

/** Escape text destined for an XML attribute value. */
function escAttr(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Escape text destined for HTML content inside a draw.io html=1 label. */
function escHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/** Round to 2 decimals to keep the XML readable. */
function r2(n) {
  return Math.round(n * 100) / 100;
}

/** Unescape the XML entities d2 embeds inside base64-decoded keys. */
function unescapeEntities(s) {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

// ---------------------------------------------------------------------------
// D2 parsing (house dialect, line oriented)
// ---------------------------------------------------------------------------

/**
 * Parse d2 text into a simple tree:
 *   node = { key, label, props: {}, children: [], edges: [] }
 * Handles: spread imports, comments, single-line shapes with `{ class: x }`,
 * multi-line blocks (containers, text shapes, style blocks), edges with
 * optional quoted labels (labels may contain colons/parens/unicode), and
 * plain `key: value` properties.
 */
function parseD2Tree(text) {
  const root = { key: '', label: null, props: {}, children: [], edges: [] };
  const stack = [root];

  // Edge: a.b -> c.d: "label" { class: x }   |   a -> b: { class: x }
  const EDGE =
    /^([\w.-]+)\s*->\s*([\w.-]+)\s*:\s*(?:"((?:[^"\\]|\\.)*)"\s*)?\{\s*class\s*:\s*([\w-]+)\s*;?\s*\}\s*$/;
  // Single-line shape: key: "label" { class: x }  (label may be unquoted)
  const ONELINE =
    /^([\w-]+)\s*:\s*(?:"((?:[^"\\]|\\.)*)"|([^"{}]+?))\s*\{\s*class\s*:\s*([\w-]+)\s*;?\s*\}\s*$/;
  // Block open: key: "label" {   |   key: Label {   |   key: {   |   style: {
  const OPEN = /^([\w-]+)\s*:\s*(?:"((?:[^"\\]|\\.)*)"|([^"{}]+?))?\s*\{\s*$/;
  // Property: key: value  (value may be quoted)
  const PROP = /^([\w-]+)\s*:\s*(?:"((?:[^"\\]|\\.)*)"|(.+?))\s*$/;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    if (line.startsWith('...@')) {
      root.props.__import = line.slice(4).trim();
      continue;
    }
    if (line === '}') {
      if (stack.length > 1) stack.pop();
      continue;
    }
    const cur = stack[stack.length - 1];
    let m;
    if ((m = EDGE.exec(line))) {
      cur.edges.push({ src: m[1], dst: m[2], label: m[3] ?? null, cls: m[4] });
      continue;
    }
    if ((m = ONELINE.exec(line))) {
      cur.children.push({
        key: m[1],
        label: (m[2] ?? m[3] ?? '').trim(),
        props: { class: m[4] },
        children: [],
        edges: [],
      });
      continue;
    }
    if ((m = OPEN.exec(line))) {
      const node = {
        key: m[1],
        label: m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3].trim() : null,
        props: {},
        children: [],
        edges: [],
      };
      cur.children.push(node);
      stack.push(node);
      continue;
    }
    if ((m = PROP.exec(line))) {
      // A QUOTED value outside a style/config block is a label-only shape
      // (legal d2), not a property: house-dialect property values are bare.
      if (m[2] !== undefined && cur.key !== 'style' && cur.key !== 'd2-config') {
        cur.children.push({ key: m[1], label: m[2].trim(), props: {}, children: [], edges: [] });
        continue;
      }
      cur.props[m[1]] = (m[2] ?? m[3] ?? '').trim();
      continue;
    }
    warn(`unparsed d2 line (skipped): ${line}`);
  }
  return root;
}

/**
 * parseTemplate: extract the `classes:` block from the template d2 into
 *   { className: { shape, fill, stroke, 'stroke-dash', 'border-radius',
 *                  'stroke-width', 'font-color' } }
 */
function parseTemplate(text) {
  const tree = parseD2Tree(text);
  const classesNode = tree.children.find((c) => c.key === 'classes');
  if (!classesNode) {
    warn('template has no classes: block; falling back to default styles');
    return {};
  }
  const map = {};
  for (const c of classesNode.children) {
    const styleNode = c.children.find((k) => k.key === 'style');
    map[c.key] = {
      shape: c.props.shape || null,
      ...(styleNode ? styleNode.props : {}),
    };
  }
  return map;
}

/**
 * parseD2: interpret the diagram tree into texts, zones, shapes, edges.
 * Shape/edge keys inside a zone are qualified with the zone key ("core.pull").
 */
function parseD2(text) {
  const tree = parseD2Tree(text);
  const texts = [];
  const zones = [];
  const shapes = [];
  const edges = [];

  for (const n of tree.children) {
    const styleNode = n.children.find((c) => c.key === 'style');
    const style = styleNode ? styleNode.props : {};
    if (n.props.shape === 'text') {
      texts.push({
        key: n.key,
        label: n.label ?? n.key,
        fontSize: parseFloat(style['font-size']) || 14,
        fontColor: style['font-color'] || '#000000',
      });
      continue;
    }
    if (n.props.class === 'zone') {
      zones.push({ key: n.key, label: n.label ?? n.key });
      for (const c of n.children) {
        if (c.key === 'style') continue;
        shapes.push({
          key: `${n.key}.${c.key}`,
          label: c.label ?? c.key,
          cls: c.props.class || null,
          zone: n.key,
        });
      }
      for (const e of n.edges) {
        edges.push({
          src: `${n.key}.${e.src}`,
          dst: `${n.key}.${e.dst}`,
          label: e.label,
          cls: e.cls,
        });
      }
      continue;
    }
    // Plain top-level shape (not used by the house dialect today, but legal).
    shapes.push({
      key: n.key,
      label: n.label ?? n.key,
      cls: n.props.class || null,
      zone: null,
    });
  }
  for (const e of tree.edges) {
    edges.push({ src: e.src, dst: e.dst, label: e.label, cls: e.cls });
  }
  return { importPath: tree.props.__import || null, texts, zones, shapes, edges };
}

// ---------------------------------------------------------------------------
// SVG geometry extraction
// ---------------------------------------------------------------------------

/** Find the end of a <g> group's content given the index just past its opening tag. */
function groupContent(s, startIdx) {
  const re = /<\/g>|<g\b/g;
  re.lastIndex = startIdx;
  let depth = 1;
  let m;
  while ((m = re.exec(s))) {
    if (m[0] === '</g>') {
      depth--;
      if (depth === 0) return s.slice(startIdx, m.index);
    } else {
      depth++;
    }
  }
  return s.slice(startIdx); // unbalanced; return the rest
}

/**
 * parseSvgGeometry: map d2 key -> normalized geometry.
 * Returns { geo: Map<key, entry>, edgeKeys: Set<string> } where entry is
 *   { kind: 'rect'|'path'|'text', x, y, w, h, fontSize?, cx?, baseline? }
 * All coordinates are normalized to a 0-origin canvas: the inner <svg>
 * viewBox min-x/min-y (which may be negative) is subtracted out.
 */
function parseSvgGeometry(svgText) {
  // Doubly nested <svg> roots: the coordinates live in the INNER viewBox
  // space. Take the last <svg ...> opening tag (base64 font blobs cannot
  // contain '<svg', so matching the whole document is safe).
  const svgTags = [...svgText.matchAll(/<svg\b[^>]*>/g)];
  if (svgTags.length === 0) fail('no <svg> element found in the SVG file');
  const innerTag = svgTags[svgTags.length - 1][0];
  const vbMatch = /viewBox="([-\d.\s]+)"/.exec(innerTag);
  if (!vbMatch) fail('inner <svg> has no viewBox attribute');
  const [minX, minY] = vbMatch[1].trim().split(/\s+/).map(Number);
  const ox = -minX;
  const oy = -minY;

  const geo = new Map();
  const edgeKeys = new Set();

  // Top-level object groups: <g class="BASE64[ d2class]"> with '">' flush
  // (the inner wrapper is '<g class="shape" >' with a stray space, so it
  // never matches). Anchoring on '<g class="' also keeps us out of the
  // embedded base64 font blobs.
  const groupRe = /<g class="([A-Za-z0-9+/=]+)((?: [\w-]+)*)">/g;
  let gm;
  while ((gm = groupRe.exec(svgText))) {
    const token = gm[1];
    if (token === 'shape') continue; // defensive
    let key;
    try {
      key = Buffer.from(token, 'base64').toString('utf8');
    } catch {
      continue;
    }
    if (!key || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(key)) continue; // garbage decode, not a real key
    key = unescapeEntities(key);

    if (key.includes('->')) {
      // Edge group: geometry not needed, draw.io re-routes.
      edgeKeys.add(key);
      continue;
    }

    const content = groupContent(svgText, gm.index + gm[0].length);

    // Shape wrapper (note the stray space before '>').
    const sw = /<g class="shape" >([\s\S]*?)<\/g>/.exec(content);
    const swBody = sw ? sw[1] : '';

    // Label text (position + font-size), used for zones and for the
    // rect-less title/legend groups.
    const tm =
      /<text x="(-?\d+(?:\.\d+)?)" y="(-?\d+(?:\.\d+)?)"[^>]*font-size:(\d+(?:\.\d+)?)px/.exec(
        content
      );

    const rm =
      /<rect x="(-?\d+(?:\.\d+)?)" y="(-?\d+(?:\.\d+)?)" width="(\d+(?:\.\d+)?)" height="(\d+(?:\.\d+)?)"/.exec(
        swBody
      );
    if (rm) {
      geo.set(key, {
        kind: 'rect',
        x: parseFloat(rm[1]) + ox,
        y: parseFloat(rm[2]) + oy,
        w: parseFloat(rm[3]),
        h: parseFloat(rm[4]),
        fontSize: tm ? parseFloat(tm[3]) : null,
      });
      continue;
    }

    const pm = /<path d="([^"]+)"/.exec(swBody);
    if (pm) {
      // Diamond etc.: bounding box over all absolute coordinates in d.
      const nums = pm[1].match(/-?\d+(?:\.\d+)?(?:e[-+]?\d+)?/gi);
      if (nums && nums.length >= 4) {
        let xMin = Infinity,
          xMax = -Infinity,
          yMin = Infinity,
          yMax = -Infinity;
        for (let i = 0; i + 1 < nums.length; i += 2) {
          const x = parseFloat(nums[i]);
          const y = parseFloat(nums[i + 1]);
          if (x < xMin) xMin = x;
          if (x > xMax) xMax = x;
          if (y < yMin) yMin = y;
          if (y > yMax) yMax = y;
        }
        geo.set(key, {
          kind: 'path',
          x: xMin + ox,
          y: yMin + oy,
          w: xMax - xMin,
          h: yMax - yMin,
          fontSize: tm ? parseFloat(tm[3]) : null,
        });
        continue;
      }
    }

    if (tm) {
      // Empty shape wrapper (title/legend): only a positioned <text>.
      // text-anchor is middle, so x is the horizontal CENTER.
      geo.set(key, {
        kind: 'text',
        cx: parseFloat(tm[1]) + ox,
        baseline: parseFloat(tm[2]) + oy,
        fontSize: parseFloat(tm[3]),
      });
      continue;
    }

    warn(`SVG group "${key}" has no extractable geometry; skipped`);
  }

  return { geo, edgeKeys };
}

// ---------------------------------------------------------------------------
// draw.io emission
// ---------------------------------------------------------------------------

/** Build a vertex style string from a template class definition. */
function vertexStyle(def) {
  let s = '';
  if ((def.shape || '') === 'diamond') {
    s += 'rhombus;whiteSpace=wrap;html=1;';
  } else {
    s += `${def['border-radius'] ? 'rounded=1' : 'rounded=0'};whiteSpace=wrap;html=1;`;
  }
  if (def.fill) s += `fillColor=${def.fill};`;
  if (def.stroke) s += `strokeColor=${def.stroke};`;
  if (def['stroke-dash']) s += 'dashed=1;';
  const sw = parseFloat(def['stroke-width']);
  if (sw && sw !== 1) s += `strokeWidth=${sw};`;
  if (def['font-color']) s += `fontColor=${def['font-color']};`;
  return s;
}

/** Build an edge style string from a template class definition. */
function edgeStyleFor(def) {
  let s = 'edgeStyle=orthogonalEdgeStyle;rounded=0;html=1;';
  if (def.stroke) {
    s += `strokeColor=${def.stroke};fontColor=${def.stroke};`;
  }
  if (def['stroke-dash']) s += 'dashed=1;';
  const sw = parseFloat(def['stroke-width']);
  if (sw && sw !== 1) s += `strokeWidth=${sw};`;
  return s;
}

/**
 * Shape label -> draw.io HTML value.
 * d2 multi-line labels use literal "\n" inside the quoted string; split on
 * the FIRST one only: line 1 = bold name, remainder = role line(s).
 */
function shapeValue(label) {
  const i = label.indexOf('\\n');
  if (i === -1) return escHtml(label);
  const name = label.slice(0, i);
  const rest = label.slice(i + 2).split('\\n');
  return `<b>${escHtml(name)}</b><br/>${rest.map(escHtml).join('<br/>')}`;
}

/** Multi-line text label (title/legend) -> HTML with <br/>. */
function textValue(label) {
  return label.split('\\n').map(escHtml).join('<br/>');
}

function emitMxfile(diagram, classMap, geo) {
  const cells = [];
  const usedIds = new Set(['0', '1']);
  const idByKey = new Map();

  function idFor(key) {
    if (idByKey.has(key)) return idByKey.get(key);
    let base = key.replace(/[^A-Za-z0-9_]/g, '_');
    if (!base) base = 'n';
    let id = base;
    let n = 2;
    while (usedIds.has(id)) id = `${base}_${n++}`;
    usedIds.add(id);
    idByKey.set(key, id);
    return id;
  }

  const emittedVertices = new Set(); // d2 keys that got a vertex cell
  let matched = 0;

  function classDef(cls, what) {
    if (cls && classMap[cls]) return classMap[cls];
    if (cls) warn(`class "${cls}" (on ${what}) not found in template; using defaults`);
    return {};
  }

  // --- Zones (containers) and their children -------------------------------
  const zoneGeoByKey = new Map();
  for (const zone of diagram.zones) {
    const g = geo.get(zone.key);
    const def = classDef('zone', `zone ${zone.key}`);
    if (!g || g.kind === 'text') {
      warn(`zone "${zone.key}" has no rect geometry in the SVG; children will be placed absolutely`);
      continue;
    }
    zoneGeoByKey.set(zone.key, g);
    const id = idFor(zone.key);
    let style = `rounded=1;whiteSpace=wrap;html=1;container=1;collapsible=0;verticalAlign=top;`;
    if (def['font-color']) style += `fontColor=${def['font-color']};`;
    if (def.fill) style += `fillColor=${def.fill};`;
    if (def.stroke) style += `strokeColor=${def.stroke};`;
    if (g.fontSize) style += `fontSize=${g.fontSize};`;
    cells.push(
      `<mxCell id="${escAttr(id)}" value="${escAttr(escHtml(zone.label))}" style="${escAttr(
        style
      )}" vertex="1" parent="1"><mxGeometry x="${r2(g.x)}" y="${r2(g.y)}" width="${r2(
        g.w
      )}" height="${r2(g.h)}" as="geometry"/></mxCell>`
    );
    emittedVertices.add(zone.key);
    matched++;
  }

  // --- Child / plain shapes -------------------------------------------------
  for (const shape of diagram.shapes) {
    const g = geo.get(shape.key);
    if (!g || g.kind === 'text') {
      warn(`shape "${shape.key}" (in d2) has no geometry in the SVG; skipped`);
      continue;
    }
    const def = classDef(shape.cls, `shape ${shape.key}`);
    const id = idFor(shape.key);
    const zoneG = shape.zone ? zoneGeoByKey.get(shape.zone) : null;
    const parentId = zoneG ? idFor(shape.zone) : '1';
    // Children of a container use coordinates RELATIVE to the container.
    const x = zoneG ? g.x - zoneG.x : g.x;
    const y = zoneG ? g.y - zoneG.y : g.y;
    let style = vertexStyle(def);
    if (g.fontSize) style += `fontSize=${g.fontSize};`;
    cells.push(
      `<mxCell id="${escAttr(id)}" value="${escAttr(shapeValue(shape.label))}" style="${escAttr(
        style
      )}" vertex="1" parent="${escAttr(parentId)}"><mxGeometry x="${r2(x)}" y="${r2(
        y
      )}" width="${r2(g.w)}" height="${r2(g.h)}" as="geometry"/></mxCell>`
    );
    emittedVertices.add(shape.key);
    matched++;
  }

  // --- Title / legend text vertices ----------------------------------------
  for (const t of diagram.texts) {
    const g = geo.get(t.key);
    if (!g) {
      warn(`text "${t.key}" (in d2) not found in the SVG; skipped`);
      continue;
    }
    const fontSize = t.fontSize || g.fontSize || 14;
    const lines = t.label.split('\\n');
    const maxLen = Math.max(...lines.map((l) => l.length));
    // The SVG carries no metrics for these; estimate from font size.
    const w = Math.ceil(maxLen * fontSize * 0.6);
    const h = Math.ceil(lines.length * fontSize * 1.4);
    let x, y;
    if (g.kind === 'text') {
      // text-anchor:middle -> x is the CENTER; y is the first-line baseline.
      x = g.cx - w / 2;
      y = g.baseline - fontSize;
    } else {
      x = g.x;
      y = g.y;
    }
    const id = idFor(t.key);
    // align=center keeps the text centered on the SVG's middle anchor even
    // when the estimated width is off; align=left would shift it by the error.
    const style = `text;html=1;align=center;verticalAlign=top;fontSize=${fontSize};fontColor=${
      t.fontColor
    };`;
    cells.push(
      `<mxCell id="${escAttr(id)}" value="${escAttr(textValue(t.label))}" style="${escAttr(
        style
      )}" vertex="1" parent="1"><mxGeometry x="${r2(x)}" y="${r2(y)}" width="${w}" height="${h}" as="geometry"/></mxCell>`
    );
    emittedVertices.add(t.key);
    matched++;
  }

  // --- Warn about SVG shapes the d2 parse never claimed ---------------------
  const d2Keys = new Set([
    ...diagram.zones.map((z) => z.key),
    ...diagram.shapes.map((s) => s.key),
    ...diagram.texts.map((t) => t.key),
  ]);
  for (const key of geo.keys()) {
    if (!d2Keys.has(key)) warn(`SVG shape "${key}" has no matching d2 declaration`);
  }

  // --- Edges -----------------------------------------------------------------
  let edgeN = 0;
  for (const e of diagram.edges) {
    if (!emittedVertices.has(e.src) || !emittedVertices.has(e.dst)) {
      warn(`edge ${e.src} -> ${e.dst} skipped (missing endpoint vertex)`);
      continue;
    }
    const def = classDef(e.cls, `edge ${e.src} -> ${e.dst}`);
    let id = `edge_${edgeN++}`;
    while (usedIds.has(id)) id = `edge_${edgeN++}`;
    usedIds.add(id);
    const value = e.label ? escAttr(escHtml(e.label)) : '';
    cells.push(
      `<mxCell id="${id}" value="${value}" style="${escAttr(
        edgeStyleFor(def)
      )}" edge="1" parent="1" source="${escAttr(idFor(e.src))}" target="${escAttr(
        idFor(e.dst)
      )}"><mxGeometry relative="1" as="geometry"/></mxCell>`
    );
  }

  if (matched === 0) fail('zero shapes matched between the d2 file and the SVG');

  return (
    `<mxfile host="app.diagrams.net"><diagram id="d1" name="Page-1">` +
    `<mxGraphModel dx="800" dy="600" grid="0" gridSize="10" guides="1" tooltips="1" connect="1" ` +
    `arrows="1" fold="1" page="0" pageScale="1" math="0" shadow="0" background="#FFFFFF"><root>` +
    `<mxCell id="0"/><mxCell id="1" parent="0"/>` +
    cells.join('') +
    `</root></mxGraphModel></diagram></mxfile>`
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  if (args.length !== 3) {
    console.error('Usage: node d2-to-drawio.mjs <input.d2> <input.svg> <output.drawio>');
    process.exit(2);
  }
  const [d2Path, svgPath, outPath] = args;

  let d2Text, svgText;
  try {
    d2Text = readFileSync(d2Path, 'utf8'); // explicit UTF-8: labels contain U+00B7 etc.
  } catch (err) {
    fail(`cannot read d2 file "${d2Path}": ${err.message}`);
  }
  try {
    svgText = readFileSync(svgPath, 'utf8');
  } catch (err) {
    fail(`cannot read SVG file "${svgPath}": ${err.message}`);
  }

  const diagram = parseD2(d2Text);

  let classMap = {};
  if (diagram.importPath) {
    const templatePath = resolve(dirname(resolve(d2Path)), `${diagram.importPath}.d2`);
    try {
      classMap = parseTemplate(readFileSync(templatePath, 'utf8'));
    } catch (err) {
      fail(`cannot read template "${templatePath}" (imported by the d2 file): ${err.message}`);
    }
  } else {
    warn('d2 file has no template import; all classes fall back to defaults');
  }

  const { geo } = parseSvgGeometry(svgText);

  const xml = emitMxfile(diagram, classMap, geo);

  try {
    mkdirSync(dirname(resolve(outPath)), { recursive: true });
    writeFileSync(outPath, xml, 'utf8'); // Node writes UTF-8 without BOM
  } catch (err) {
    fail(`cannot write output "${outPath}": ${err.message}`);
  }

  const vertexCount = (xml.match(/vertex="1"/g) || []).length;
  const edgeCount = (xml.match(/edge="1"/g) || []).length;
  console.log(
    `OK: wrote ${outPath} (${Buffer.byteLength(xml, 'utf8')} bytes, ${vertexCount} vertices, ${edgeCount} edges)`
  );
}

main();
