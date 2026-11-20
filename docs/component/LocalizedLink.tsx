'use client';

import * as css from '@plumeria/core';
import type { ReactNode } from 'react';
import { Link, useRouter } from 'waku';

export const LocalizedLink = ({ to, sx, children }: { to: '/' | '/docs'; sx?: css.Style; children: ReactNode }) => {
  const { path } = useRouter();
  const ja = path === '/ja' || path.startsWith('/ja/');

  return (
    <Link to={ja ? (to === '/' ? '/ja' : `/ja${to}`) : to} unstable_prefetchOnView={{}} sx={sx}>
      {children}
    </Link>
  );
};
