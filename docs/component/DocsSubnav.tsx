'use client';

import * as css from '@plumeria/core';
import { Fragment } from 'react';
import { useRouter } from 'waku';
import { useTreeContext } from 'fumadocs-ui/contexts/tree';
import { SidebarTrigger } from 'fumadocs-ui/layouts/docs/slots/sidebar';
import type { Node } from 'fumadocs-core/page-tree';
import { breakpoints } from 'lib/mediaQuery';
import { homeTheme } from 'lib/theme';

const styles = css.create({
  subnav: {
    position: 'sticky',
    top: 'var(--fd-docs-row-1)',
    zIndex: 30,
    display: 'none',
    gridArea: 'header',
    gap: 16,
    alignItems: 'center',
    height: 'var(--fd-header-height)',
    paddingInline: 16,
    color: homeTheme.foreground,
    background: homeTheme.background,
    borderBottomColor: homeTheme.border,
    borderBottomStyle: 'solid',
    borderBottomWidth: 1,
    [breakpoints.md]: {
      display: 'flex',
    },
  },
  trigger: {
    display: 'inline-flex',
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    width: 20,
    height: 28,
    cursor: 'pointer',
  },
  trail: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    minWidth: 0,
    fontSize: 14,
    whiteSpace: 'nowrap',
  },
  parent: {
    color: homeTheme.muted,
  },
  current: {
    overflow: 'hidden',
    textOverflow: 'ellipsis',
  },
  chevron: {
    flexShrink: 0,
    color: homeTheme.muted,
  },
});

// Separators are written in capitals in meta.json.
const sectionName = (name: string) =>
  name
    .toLowerCase()
    .replace(/\b\w+/g, (word) =>
      word === 'ai' || word === 'api' ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1),
    );

const findTrail = (nodes: Node[], url: string, parents: string[] = []): string[] | undefined => {
  let current = parents;
  for (const node of nodes) {
    if (node.type === 'separator' && typeof node.name === 'string') current = [...parents, sectionName(node.name)];
    if (node.type === 'page' && node.url === url) return [...current, String(node.name)];
    if (node.type === 'folder') {
      const folder = [...current, String(node.name)];
      if (node.index?.url === url) return folder;
      const found = findTrail(node.children, url, folder);
      if (found) return found;
    }
  }
};

const useCrumbs = () => {
  const { path } = useRouter();
  const { full } = useTreeContext();
  const trail = findTrail(full.children, path) ?? [];

  if (path === '/playground') return ['Playground'];
  if (path.startsWith('/blog')) return ['Blog', ...trail];
  return trail;
};

export const NoNavTitle = () => null;

export const DocsSubnav = () => {
  const crumbs = useCrumbs();

  return (
    <div classStyle={styles.subnav}>
      <SidebarTrigger aria-label="Open Sidebar" classStyle={styles.trigger}>
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M4 9h16M4 15h16" />
        </svg>
      </SidebarTrigger>
      <nav aria-label="Breadcrumb" classStyle={styles.trail}>
        {crumbs.map((crumb, index) => (
          <Fragment key={index}>
            {index > 0 && (
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                classStyle={styles.chevron}
              >
                <path d="m9 18 6-6-6-6" />
              </svg>
            )}
            <span classStyle={[index === crumbs.length - 1 ? styles.current : styles.parent]}>{crumb}</span>
          </Fragment>
        ))}
      </nav>
    </div>
  );
};
