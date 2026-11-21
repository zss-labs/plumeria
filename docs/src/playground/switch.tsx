import { Fragment } from 'react';
import * as css from '@plumeria/core';
import { theme } from 'lib/theme';
import { breakpoints } from 'lib/mediaQuery';

type Page = 'compile' | 'migrate';

const PAGES: { value: Page; label: string; href: string }[] = [
  { value: 'compile', label: 'Compile', href: '/playground' },
  { value: 'migrate', label: 'Migrate', href: '/playground/migrate' },
];

const styles = css.create({
  group: {
    display: 'flex',
    flexShrink: 0,
    gap: 4,
    width: 'fit-content',
    padding: 3,
    background: theme.iconBg,
    borderRadius: 8,
  },
  inPage: {
    [breakpoints.md]: {
      display: 'none',
    },
  },
  page: {
    padding: '4px 12px',
    fontSize: 12,
    fontWeight: 500,
    color: theme.textSecondary,
    textDecoration: 'none',
    borderRadius: 6,
    ':hover': {
      color: theme.textPrimary,
    },
  },
  pageActive: {
    color: theme.textPrimary,
    background: theme.dropdownBg,
  },
  divider: {
    alignSelf: 'center',
    width: 1,
    height: 14,
    background: theme.cardBorder,
  },
});

export function PageSwitch({ current, subnav = false }: { current: Page; subnav?: boolean }) {
  return (
    <nav sx={[styles.group, !subnav && styles.inPage]} aria-label="Playground pages">
      {PAGES.map((page, index) => (
        <Fragment key={page.value}>
          {index > 0 && <span sx={styles.divider} aria-hidden="true" />}
          <a
            href={page.href}
            aria-current={current === page.value ? 'page' : undefined}
            sx={[styles.page, current === page.value && styles.pageActive]}
          >
            {page.label}
          </a>
        </Fragment>
      ))}
    </nav>
  );
}
