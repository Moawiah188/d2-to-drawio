// D2 theme color resolution.
//
// The IR reports colors either as literal values (hex, css names) or as D2
// theme palette codes (N1-N7 neutrals, B1-B6 base, AA2/AA4/AA5, AB4/AB5).
// Palette data lives in theme-data.js, generated from the official
// terrastruct/d2 theme catalog.

import { THEMES } from './theme-data.js';

const CODE = /^(N[1-7]|B[1-6]|AA[245]|AB[45])$/;

/**
 * Resolve an IR color value to something draw.io accepts.
 * Literal values pass through; theme codes resolve against the palette.
 */
export function resolveColor(value, themeID = 0) {
  if (value == null || value === '') return value;
  if (value === 'transparent') return 'none';
  if (!CODE.test(value)) return value;
  const theme = THEMES[String(themeID)] ?? THEMES['0'];
  return (theme && theme.colors[value]) ?? value;
}

/** Theme ids the palette table knows about. */
export function knownThemeIDs() {
  return Object.keys(THEMES).map(Number).sort((a, b) => a - b);
}
