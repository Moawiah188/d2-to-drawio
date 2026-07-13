// Deterministic draw.io cell id allocation.
//
// Ids derive from the D2 key: readable, stable across runs, deduplicated
// with numeric suffixes. "0" and "1" are reserved for the draw.io root cells.

export function createIdAllocator() {
  const used = new Set(['0', '1']);
  const byKey = new Map();

  return function idFor(key) {
    if (byKey.has(key)) return byKey.get(key);
    let base = String(key).replace(/[^A-Za-z0-9_]/g, '_');
    if (!base || /^\d+$/.test(base)) base = `n_${base}`;
    let id = base;
    let n = 2;
    while (used.has(id)) id = `${base}_${n++}`;
    used.add(id);
    byKey.set(key, id);
    return id;
  };
}
