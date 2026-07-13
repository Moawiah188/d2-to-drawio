// Public library API.

import { readFileSync, readdirSync } from 'node:fs';
import { dirname, basename, relative, join, resolve as resolvePath } from 'node:path';
import { compile, dispose, D2SyntaxError } from './compile.js';
import { mapBoard } from './map.js';
import { emit } from './emit.js';

export { dispose, D2SyntaxError };

/** Error thrown in strict mode when input uses features that degrade. */
export class UnsupportedFeatureError extends Error {
  constructor(warnings) {
    super(
      `strict mode: input uses ${warnings.length} unsupported feature(s):\n` +
        warnings.map((w) => `  - ${w.message}`).join('\n')
    );
    this.name = 'UnsupportedFeatureError';
    this.code = 'UNSUPPORTED_STRICT';
    this.warnings = warnings;
  }
}

function createWarnings() {
  const seen = new Set();
  const list = [];
  return {
    list,
    add(code, message) {
      if (seen.has(code)) return;
      seen.add(code);
      list.push({ code, message });
    },
  };
}

/** Collect a board and its nested boards (layers/scenarios/steps) as pages. */
function collectBoards(diagram, prefix, out) {
  out.push({ diagram, name: diagram.name || (out.length === 0 ? 'Page-1' : `page-${out.length + 1}`), prefix });
  for (const kind of ['layers', 'scenarios', 'steps']) {
    for (const child of diagram[kind] ?? []) {
      collectBoards(child, prefix ? `${prefix}/${child.name}` : child.name, out);
    }
  }
  return out;
}

/**
 * Convert D2 source text to an uncompressed draw.io XML string.
 *
 * @param {string} d2Source
 * @param {object} [options]
 * @param {'dagre'|'elk'} [options.layout] layout engine (default dagre)
 * @param {number} [options.themeID] D2 theme id (default 0)
 * @param {boolean} [options.strict] fail on unsupported features instead of degrading
 * @param {boolean} [options.waypoints] preserve D2 edge routes as draw.io waypoints
 * @param {(warning: {code: string, message: string}) => void} [options.onWarning]
 * @returns {Promise<string>}
 */
export async function convert(d2Source, options = {}) {
  // Strip a UTF-8 BOM so a BOM'd file or stream still parses.
  if (d2Source.charCodeAt(0) === 0xfeff) d2Source = d2Source.slice(1);
  const result = await compile(d2Source, options);
  const warnings = createWarnings();

  // The root board's config echoes the effective theme (an in-file
  // vars.d2-config can set it when the caller does not).
  const boardOptions = {
    ...options,
    themeID: result.diagram?.config?.themeID ?? options.themeID ?? 0,
  };

  const boards = collectBoards(result.diagram, '', []);
  const pages = boards.map((b, i) => {
    const page = mapBoard(b.diagram, boardOptions, warnings);
    if (b.prefix) page.name = b.prefix;
    else if (!b.diagram.name) page.name = i === 0 ? 'Page-1' : `page-${i + 1}`;
    return page;
  });

  if (options.strict && warnings.list.length > 0) {
    throw new UnsupportedFeatureError(warnings.list);
  }
  if (options.onWarning) for (const w of warnings.list) options.onWarning(w);

  return emit(pages);
}

/**
 * Build a virtual filesystem map of every .d2 file under rootDir (relative
 * paths, forward slashes) so the compiler can resolve @imports.
 */
export function buildImportFs(rootDir) {
  const fsMap = {};
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
        walk(join(dir, entry.name));
      } else if (entry.name.endsWith('.d2')) {
        const abs = join(dir, entry.name);
        const rel = relative(rootDir, abs).split('\\').join('/');
        fsMap[rel] = readFileSync(abs, 'utf8');
      }
    }
  };
  walk(rootDir);
  return fsMap;
}

/**
 * Convert a .d2 file to draw.io XML. Sibling .d2 files (recursively under
 * the file's directory) are made available to the compiler so relative
 * @imports resolve.
 *
 * @param {string} inputPath path to the .d2 file
 * @param {object} [options] same options as convert()
 * @returns {Promise<string>}
 */
export async function convertFile(inputPath, options = {}) {
  const abs = resolvePath(inputPath);
  const source = readFileSync(abs, 'utf8');
  const rootDir = dirname(abs);
  return convert(source, {
    ...options,
    fsMap: buildImportFs(rootDir),
    inputPath: basename(abs),
  });
}
