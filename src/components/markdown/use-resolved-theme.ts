import { useSettingsStore } from '@/state/settings';
import { useEffect, useState } from 'react';

/**
 * Resolves the user's `theme` preference ('light' | 'dark' | 'system') into a
 * concrete 'light' | 'dark' value, tracking OS preference changes when set
 * to 'system'. Use anywhere a component needs to pick a theme-aware asset
 * (Shiki theme, image variant, etc.) without re-implementing the matcher.
 */
export function useResolvedTheme(): 'light' | 'dark' {
  const pref = useSettingsStore((s) => s.theme);
  const [systemDark, setSystemDark] = useState(() =>
    typeof window !== 'undefined'
      ? window.matchMedia('(prefers-color-scheme: dark)').matches
      : false,
  );

  useEffect(() => {
    if (pref !== 'system') return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = () => setSystemDark(mql.matches);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, [pref]);

  if (pref === 'dark') return 'dark';
  if (pref === 'light') return 'light';
  return systemDark ? 'dark' : 'light';
}
