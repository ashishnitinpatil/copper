import { useCallback, useEffect } from 'react';
import { useQuery } from '@/db/useQuery';
import { listThemes, type CustomTheme } from '@/db/queries/themes';
import { applyCustomTheme, getCustomColors, useTheme } from '@/lib/theme';

/**
 * Keeps this device's custom theme in step with the book: when it's edited on
 * another device, re-paint it here. A restore gives themes new ids, so fall
 * back to finding it by name. A theme deleted elsewhere stays on screen here
 * (from the cached colours) until someone picks another — nothing changes
 * under the person.
 */
export function CustomThemeKeeper() {
  const active = useTheme();
  const themes = useQuery<CustomTheme[]>(useCallback((db) => listThemes(db), []), { deps: ['themes'] });

  useEffect(() => {
    if (!active.startsWith('custom:') || !themes.data) return;
    const cached = getCustomColors();
    const id = active.slice('custom:'.length);
    const t = themes.data.find((x) => x.id === id) ?? themes.data.find((x) => x.name === cached?.name);
    if (!t) return;
    if (t.id !== id || t.name !== cached?.name || t.background !== cached.background || t.accent !== cached.accent) {
      applyCustomTheme(t);
    }
  }, [active, themes.data]);

  return null;
}
