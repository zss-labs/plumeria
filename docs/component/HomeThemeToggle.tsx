'use client';

import * as css from '@plumeria/core';
import { useTheme } from 'next-themes';
import { homeTheme } from 'lib/theme';

const styles = css.create({
  toggle: {
    display: 'inline-flex',
    padding: 3,
    cursor: 'pointer',
    borderColor: homeTheme.border,
    borderStyle: 'solid',
    borderWidth: 1,
    borderRadius: 9999,
  },
  icon: {
    display: 'flex',
    padding: 6,
    borderRadius: 9999,
  },
  light: {
    color: homeTheme.themeLightColor,
    background: homeTheme.themeLightBg,
  },
  dark: {
    color: homeTheme.themeDarkColor,
    background: homeTheme.themeDarkBg,
  },
});

export const HomeThemeToggle = () => {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <button
      type="button"
      aria-label="Toggle Theme"
      classStyle={styles.toggle}
      onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
    >
      <span classStyle={[styles.icon, styles.light]}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
        </svg>
      </span>
      <span classStyle={[styles.icon, styles.dark]}>
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
        </svg>
      </span>
    </button>
  );
};
