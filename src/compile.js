// Wrapper around the official D2 compiler (@terrastruct/d2, WASM).
//
// The engine runs in a worker thread that keeps the Node event loop alive,
// so this module manages a lazy singleton and exposes dispose() to release
// it. Library callers must await dispose() (or exit the process) when done.

import { D2 } from '@terrastruct/d2';

/** Error thrown when the D2 source does not compile. */
export class D2SyntaxError extends Error {
  constructor(message) {
    super(message);
    this.name = 'D2SyntaxError';
    this.code = 'D2_SYNTAX';
  }
}

let instance = null;

function getInstance() {
  if (!instance) instance = new D2();
  return instance;
}

/**
 * The engine reports compile problems as a JSON array of
 * {range, errmsg} objects serialized into the error message. Flatten that
 * into d2's own "file:line:col: description" lines, never a stack trace.
 */
function formatCompileError(err) {
  const raw = String(err && err.message ? err.message : err).trim();
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      const msgs = parsed.map((e) => e.errmsg ?? JSON.stringify(e));
      if (msgs.length > 0) return msgs.join('\n');
    }
  } catch {
    // not JSON: fall through to the raw message
  }
  return raw;
}

/**
 * Compile D2 source to the positioned diagram IR.
 *
 * @param {string} source D2 source text
 * @param {object} [options]
 * @param {'dagre'|'elk'} [options.layout] layout engine (default dagre)
 * @param {number} [options.themeID] D2 theme id (default 0)
 * @param {Record<string, string>} [options.fsMap] virtual filesystem for imports:
 *   relative path -> file content. Required for sources that use @imports.
 * @param {string} [options.inputPath] entry filename inside fsMap (and the name
 *   used in error messages). Defaults to "input.d2".
 * @returns {Promise<object>} the CompileResponse ({ diagram, graph, ... })
 */
export async function compile(source, options = {}) {
  const d2 = getInstance();
  // Only forward explicitly-set options so an in-file `vars.d2-config`
  // block keeps control of anything the caller leaves unset.
  const compileOptions = {};
  if (options.layout !== undefined) compileOptions.layout = options.layout;
  if (options.themeID !== undefined) compileOptions.themeID = options.themeID;
  if (options.sketch !== undefined) compileOptions.sketch = options.sketch;
  if (options.pad !== undefined) compileOptions.pad = options.pad;

  const inputPath = options.inputPath ?? 'input.d2';
  const fs = { ...(options.fsMap ?? {}), [inputPath]: source };

  try {
    return await d2.compile({ fs, inputPath, options: compileOptions });
  } catch (err) {
    throw new D2SyntaxError(formatCompileError(err));
  }
}

/**
 * Release the engine worker so the process can exit naturally.
 * Safe to call multiple times; compile() after dispose() re-creates it.
 */
export async function dispose() {
  if (!instance) return;
  const d2 = instance;
  instance = null;
  // The published API has no terminate method. The worker handle appears on
  // the instance once init completes, so wait for readiness first: a worker
  // still starting up would otherwise leak and keep the process alive.
  try {
    await d2.ready;
  } catch {
    // init failed: there is no worker to stop
  }
  const worker = d2.worker;
  if (worker && typeof worker.terminate === 'function') {
    await worker.terminate();
  }
}
