import * as css from '@plumeria/core';
import type { ReactNode } from 'react';
import type { TOCItemType } from 'fumadocs-core/toc';
import { DocsToc } from 'component/DocsToc';
import { breakpoints } from 'lib/mediaQuery';
import { homeTheme } from 'lib/theme';

const styles = css.create({
  article: {
    gridRow: 1,
    gridColumn: 2,
    width: '100%',
    maxWidth: 696,
    padding: '56px 32px 24px',
    marginInline: 'auto 0',
    [breakpoints.xl]: {
      marginInline: 'auto',
    },
    [breakpoints.md]: {
      padding: '32px 16px 24px',
    },
  },
  header: {
    marginBottom: 24,
  },
  body: {
    fontSize: 14,
    fontWeight: 320,
    lineHeight: 1.75,
    color: homeTheme.prose,
  },
});

export function DocsArticle({
  toc,
  header,
  footer,
  children,
}: {
  toc: TOCItemType[];
  header: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
}) {
  return (
    <>
      <article sx={styles.article}>
        <header sx={styles.header}>{header}</header>
        <div sx={styles.body}>{children}</div>
        {footer}
      </article>
      <DocsToc toc={toc} />
    </>
  );
}
