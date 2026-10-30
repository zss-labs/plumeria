'use client';

import * as css from '@plumeria/core';
import { useTheme } from 'next-themes';
import { useEffect, useState } from 'react';
import { homeTheme } from 'lib/theme';

const styles = css.create({
  toggle: {
    display: 'inline-flex',
    padding: 3,
    borderColor: homeTheme.border,
    borderStyle: 'solid',
    borderWidth: 1,
    borderRadius: 9999,
  },
  option: {
    display: 'flex',
    padding: 6,
    color: homeTheme.muted,
    cursor: 'pointer',
    borderRadius: 9999,
    transitionDuration: '0.2s',
    transitionProperty: 'color, background-color',
    ':hover': {
      color: homeTheme.foreground,
    },
  },
  active: {
    color: homeTheme.foreground,
    background: homeTheme.accent,
  },
});

const options = [
  {
    value: 'light',
    label: 'Light theme',
    icon: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2m-7.07-17.07 1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
      </>
    ),
  },
  {
    value: 'dark',
    label: 'Dark theme',
    icon: <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />,
  },
  {
    value: 'system',
    label: 'System theme',
    icon: (
      <>
        <rect x="2" y="3" width="20" height="14" rx="2" />
        <path d="M8 21h8M12 17v4" />
      </>
    ),
  },
];

export const HomeThemeToggle = () => {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);

  // The stored choice is unknown on the server, so nothing is marked until hydration.
  useEffect(() => {
    setMounted(true);
  }, []);

  return (
    <div role="group" aria-label="Theme" classStyle={styles.toggle}>
      {options.map(({ value, label, icon }) => {
        const active = mounted && theme === value;

        return (
          <button
            key={value}
            type="button"
            aria-label={label}
            aria-pressed={active}
            classStyle={[styles.option, active && styles.active]}
            onClick={() => setTheme(value)}
          >
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
              {icon}
            </svg>
          </button>
        );
      })}
    </div>
  );
};
