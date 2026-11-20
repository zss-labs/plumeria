'use client';

import * as css from '@plumeria/core';
import { Link, useRouter } from 'waku';
import { homeTheme } from 'lib/theme';

const styles = css.create({
  link: {
    display: 'inline-flex',
    padding: 6,
    color: homeTheme.muted,
    borderRadius: 6,
    transitionDuration: '0.2s',
    ':hover': {
      color: homeTheme.foreground,
      background: homeTheme.accent,
    },
  },
});

export const LanguageToggle = () => {
  const { path } = useRouter();
  const isJa = path === '/ja' || path.startsWith('/ja/');
  const base = isJa ? path.slice(3) || '/' : path;
  if (base !== '/docs' && !base.startsWith('/docs/')) return null;

  return (
    <Link
      to={isJa ? base : `/ja${base}`}
      hrefLang={isJa ? 'en' : 'ja'}
      aria-label={isJa ? 'English' : '日本語'}
      translate="no"
      sx={styles.link}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
      >
        <path d="m5 8 6 6M4 14l6-6 2-3M2 5h12M7 2h1M22 22l-5-10-5 10M14 18h6" />
      </svg>
    </Link>
  );
};
