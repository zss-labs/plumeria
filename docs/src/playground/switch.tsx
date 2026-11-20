import * as css from '@plumeria/core';
import { theme } from 'lib/theme';

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
    padding: 3,
    background: theme.iconBg,
    borderRadius: 8,
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
});

export function PageSwitch({ current }: { current: Page }) {
  return (
    <nav sx={styles.group} aria-label="Playground pages">
      {PAGES.map((page) => (
        <a
          key={page.value}
          href={page.href}
          aria-current={current === page.value ? 'page' : undefined}
          sx={[styles.page, current === page.value && styles.pageActive]}
        >
          {page.label}
        </a>
      ))}
    </nav>
  );
}
