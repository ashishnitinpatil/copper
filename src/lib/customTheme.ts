// A custom theme is just two colours someone picks — the page background and
// an accent. Everything else the app's tokens need (the neutral ramp for
// cards, borders and text; the accent ramp; money and status colours) is
// worked out here, the same shape as the built-in themes in index.css.

export type Mode = 'light' | 'dark';
type RGB = [number, number, number];

export interface ThemeColors {
  background: string;
  accent: string;
}

export interface BuiltTheme {
  mode: Mode;
  vars: Record<string, string>;
}

const HEX = /^#([0-9a-f]{6})$/i;

export function isHexColor(s: string): boolean {
  return HEX.test(s);
}

function rgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [0, 1, 2].map((i) => Math.round(a[i] + (b[i] - a[i]) * t)) as RGB;
}

const triplet = (c: RGB) => c.join(' ');
const WHITE: RGB = [255, 255, 255];
const BLACK: RGB = [0, 0, 0];

function luminance([r, g, b]: RGB): number {
  const lin = (v: number) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two hex colours (1 to 21). */
export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(rgb(a)), luminance(rgb(b))].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

/** Light or dark follows the background, so nobody has to choose it. */
export function modeOf(background: string): Mode {
  return luminance(rgb(background)) > 0.35 ? 'light' : 'dark';
}

// How far each neutral step sits from the background (0) toward the text
// colour (1), read off the built-in Warm Ledger (dark) and Copper (light)
// ramps. On light themes cards (900) are lighter than the page instead.
const NEUTRAL_STEPS: Record<Mode, Record<number, number>> = {
  dark: { 950: 0, 900: 0.035, 800: 0.085, 700: 0.15, 600: 0.27, 500: 0.45, 400: 0.61, 300: 0.76, 200: 0.89, 100: 0.96, 50: 1 },
  light: { 950: 0, 800: 0.066, 700: 0.14, 600: 0.38, 500: 0.59, 400: 0.69, 300: 0.8, 200: 0.89, 100: 0.95, 50: 1 },
};

// The accent ramp: lighter steps toward white, darker toward black.
const ACCENT_STEPS: Record<number, [RGB, number]> = {
  50: [WHITE, 0.9], 100: [WHITE, 0.78], 200: [WHITE, 0.55], 300: [WHITE, 0.35], 400: [WHITE, 0.18],
  500: [WHITE, 0], 600: [BLACK, 0.2], 700: [BLACK, 0.38], 800: [BLACK, 0.52], 900: [BLACK, 0.62],
};

// Money and status colours tuned per canvas, as in the built-in themes.
const FIXED: Record<Mode, Record<string, string>> = {
  dark: {
    '--mint-300': '143 208 178', '--mint-400': '111 191 155', '--mint-500': '79 168 132',
    '--clay-300': '232 164 137', '--clay-400': '224 138 107', '--clay-500': '208 111 77',
    '--ok': '110 231 183', '--warn': '252 211 77', '--danger': '252 165 165', '--info': '125 211 252',
  },
  light: {
    '--mint-300': '95 176 136', '--mint-400': '47 133 90', '--mint-500': '33 105 70',
    '--clay-300': '200 116 90', '--clay-400': '176 74 46', '--clay-500': '146 58 35',
    '--ok': '21 105 70', '--warn': '146 64 14', '--danger': '159 35 26', '--info': '30 80 160',
  },
};

export function buildTheme({ background, accent }: ThemeColors): BuiltTheme {
  const mode = modeOf(background);
  const bg = rgb(background);
  // Text: near-white or near-black, tinted with the background's hue.
  const ink = mode === 'dark' ? mix(bg, WHITE, 0.94) : mix(bg, BLACK, 0.86);
  const vars: Record<string, string> = {};
  for (const [step, t] of Object.entries(NEUTRAL_STEPS[mode])) vars[`--s-${step}`] = triplet(mix(bg, ink, t));
  if (mode === 'light') vars['--s-900'] = triplet(mix(bg, WHITE, 0.7));
  const a = rgb(accent);
  for (const [step, [toward, t]] of Object.entries(ACCENT_STEPS)) vars[`--b-${step}`] = triplet(mix(a, toward, t));
  Object.assign(vars, FIXED[mode]);
  return { mode, vars };
}

/** Plain-words warning when the accent won't read well on the background. */
export function accentWarning({ background, accent }: ThemeColors): string | null {
  return contrast(background, accent) < 2.5 ? 'The accent is hard to see on this background.' : null;
}
