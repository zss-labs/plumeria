'use client';

import * as css from '@plumeria/core';
import { useSearchContext } from 'fumadocs-ui/contexts/search';
import { breakpoints } from 'lib/mediaQuery';
import { homeTheme } from 'lib/theme';

const styles = css.create({
  trigger: {
    display: 'inline-flex',
    gap: 4,
    alignItems: 'center',
    padding: '4px 10px',
    fontSize: 12,
    color: homeTheme.muted,
    cursor: 'pointer',
    background: `color-mix(in oklab, ${homeTheme.accent} 50%, transparent)`,
    borderRadius: 9999,
    transitionDuration: '0.2s',
    ':hover': {
      color: homeTheme.foreground,
      background: homeTheme.accent,
    },
    [breakpoints.md]: {
      display: 'none',
    },
  },
  icon: {
    display: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    marginLeft: 'auto',
    cursor: 'pointer',
    borderRadius: 6,
    ':hover': {
      background: homeTheme.accent,
    },
    [breakpoints.md]: {
      display: 'inline-flex',
    },
  },
});

export const HomeSearchIcon = () => {
  const { setOpenSearch } = useSearchContext();

  return (
    <button type="button" aria-label="Search" classStyle={styles.icon} onClick={() => setOpenSearch(true)}>
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
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
    </button>
  );
};

export const HomeSearchTrigger = () => {
  const { setOpenSearch } = useSearchContext();

  return (
    <button type="button" aria-label="Search" classStyle={styles.trigger} onClick={() => setOpenSearch(true)}>
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
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </svg>
      ⌘K
    </button>
  );
};
