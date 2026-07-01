import { useState } from 'react';

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
const VALID = new Set<string>(['copper', 'warm', 'slate', 'monokai', 'daylight', 'classic']);

export function getTheme(): ThemeId {
  try {
    const t = localStorage.getItem(KEY);
    if (t && VALID.has(t)) return t as ThemeId;
  } catch {
    /* ignore */
  }
  return 'copper';
}

export function applyTheme(id: ThemeId) {
  const root = document.documentElement;
  if (id === 'warm') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', id);
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
}

export function useTheme() {
  const [theme, set] = useState<ThemeId>(() => getTheme());
  const setTheme = (id: ThemeId) => {
    applyTheme(id);
    set(id);
  };
  return [theme, setTheme] as const;
}
