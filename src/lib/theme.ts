import { useEffect, useState } from 'react';
import { buildTheme, type ThemeColors } from './customTheme';

// Runtime theme switching. Tokens live in src/index.css under :root / [data-theme].
// The no-flash bootstrap in index.html reads the same localStorage key on load.
export type ThemeId = 'copper' | 'warm' | 'slate' | 'monokai' | 'daylight' | 'classic';

export const THEMES: {
  id: ThemeId;
  label: string;
  desc: string;
  mode: 'Dark' | 'Light';
  swatch: string[];
}[] = [
  {
    id: 'copper',
    label: 'Copper',
    desc: 'Warm paper & copper ink — on brand',
    mode: 'Light',
    swatch: ['#FBF7F2', '#B4682F', '#2F855A', '#B04A2E'],
  },
  {
    id: 'warm',
    label: 'Warm Ledger',
    desc: 'Espresso ink, gold, mint & clay',
    mode: 'Dark',
    swatch: ['#17120F', '#E6A532', '#6FBF9B', '#E08A6B'],
  },
  {
    id: 'slate',
    label: 'Slate',
    desc: 'Cool blue-grey with teal',
    mode: 'Dark',
    swatch: ['#0F172A', '#2D9577', '#34D399', '#F87171'],
  },
  {
    id: 'monokai',
    label: 'Monokai',
    desc: 'Editor classic — flat & vivid',
    mode: 'Dark',
    swatch: ['#272822', '#66D9EF', '#A6E22E', '#F92672'],
  },
  {
    id: 'daylight',
    label: 'Daylight',
    desc: 'Warm cream paper with gold',
    mode: 'Light',
    swatch: ['#F4EEE3', '#C68A2A', '#2F855A', '#B04A2E'],
  },
  {
    id: 'classic',
    label: 'Classic',
    desc: 'Clean white with trusty blue',
    mode: 'Light',
    swatch: ['#FFFFFF', '#2563EB', '#16A34A', '#DC2626'],
  },
];

const KEY = 'et-theme';
// The active custom theme's colours, so index.html can paint it before the
// book (where custom themes live) has opened.
const CUSTOM_KEY = 'et-theme-custom';
const CHANGED = 'copper-theme-changed';
const VALID = new Set<string>(['copper', 'warm', 'slate', 'monokai', 'daylight', 'classic']);

/** What this device shows: a built-in theme id, or `custom:<theme id>`. */
export function getTheme(): string {
  try {
    const t = localStorage.getItem(KEY);
    if (t && (VALID.has(t) || (t.startsWith('custom:') && localStorage.getItem(CUSTOM_KEY)))) return t;
  } catch {
    /* ignore */
  }
  return 'copper';
}

/** The colours the active custom theme was last painted with, if any. */
export function getCustomColors(): (ThemeColors & { name: string }) | null {
  try {
    const c = JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? 'null');
    return c?.colors ? { ...c.colors, name: c.name } : null;
  } catch {
    return null;
  }
}

const CUSTOM_VARS = Object.keys(buildTheme({ background: '#000000', accent: '#000000' }).vars);

function remember(id: string, custom: unknown) {
  try {
    localStorage.setItem(KEY, id);
    if (custom) localStorage.setItem(CUSTOM_KEY, JSON.stringify(custom));
    else localStorage.removeItem(CUSTOM_KEY);
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new Event(CHANGED));
}

export function applyTheme(id: ThemeId) {
  const root = document.documentElement;
  for (const k of CUSTOM_VARS) root.style.removeProperty(k);
  if (id === 'warm') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', id);
  remember(id, null);
}

export function applyCustomTheme(theme: { id: string; name: string } & ThemeColors) {
  const { mode, vars } = buildTheme(theme);
  const root = document.documentElement;
  root.setAttribute('data-theme', `custom-${mode}`);
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  remember(`custom:${theme.id}`, {
    name: theme.name,
    colors: { background: theme.background, accent: theme.accent },
    mode,
    vars,
  });
}

export function useTheme() {
  const [theme, set] = useState(() => getTheme());
  // Follows changes made elsewhere (another Settings card, or the keeper
  // re-painting a theme edited on another device).
  useEffect(() => {
    const sync = () => set(getTheme());
    window.addEventListener(CHANGED, sync);
    return () => window.removeEventListener(CHANGED, sync);
  }, []);
  return theme;
}
