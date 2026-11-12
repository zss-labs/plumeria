import * as css from '@plumeria/core';
import 'katex/dist/katex.css';
import type { ReactNode } from 'react';
import type { Root } from 'fumadocs-core/page-tree';
import { DocsSidebar } from 'component/DocsSidebar';
import { breakpoints } from 'lib/mediaQuery';

const styles = css.create({
  grid: {
    display: 'grid',
    gridTemplateColumns: '268px minmax(0, calc(50% + 80px)) 268px minmax(0, 1fr)',
    minHeight: 'calc(100dvh - 56px)',
    [breakpoints.xl]: {
      gridTemplateColumns: '268px minmax(0, 1fr)',
    },
    [breakpoints.md]: {
      display: 'block',
    },
  },
});

export function DocsShell({ tree, children }: { tree: Root; children: ReactNode }) {
  return (
    <div sx={styles.grid}>
      <DocsSidebar tree={tree} />
      {children}
    </div>
  );
}
