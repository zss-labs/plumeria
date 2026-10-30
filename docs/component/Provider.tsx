'use client';

import * as css from '@plumeria/core';
import { type ComponentProps, lazy, type ReactNode } from 'react';
import { RootProvider } from 'fumadocs-ui/provider/waku';
import { Link } from 'waku';

const SearchDialog = lazy(() => import('component/SearchDialog').then((m) => ({ default: m.SearchDialog })));

const styles = css.create({
  hotKey: {
    display: 'inline-flex',
    gap: 3,
    alignItems: 'center',
    height: '100%',
    verticalAlign: 'top',
  },
  key: {
    fontSize: '0.8em',
    lineHeight: 1,
    transform: 'translateY(-0.5px)',
  },
});

const hotKey = [
  {
    key: (event: KeyboardEvent) => (event.metaKey || event.ctrlKey) && event.key === 'k',
    display: (
      <span classStyle={styles.hotKey}>
        <span>⌘</span>
        <span classStyle={styles.key}>K</span>
      </span>
    ),
  },
];

// Fumadocs prefetches its links on hover unless it is given a link of its own.
const PrefetchLink = ({
  href = '#',
  prefetch = true,
  children,
  ...props
}: ComponentProps<'a'> & { prefetch?: boolean }) => (
  <Link to={href} unstable_prefetchOnView={prefetch ? {} : undefined} {...props}>
    {children}
  </Link>
);

export const Provider = ({ children }: { children: ReactNode }) => (
  <RootProvider components={{ Link: PrefetchLink }} search={{ SearchDialog, hotKey, preload: false }}>
    {children}
  </RootProvider>
);
