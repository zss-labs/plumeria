'use client';

import * as css from '@plumeria/core';
import { Link, useRouter } from 'waku';
import { Fragment } from 'react';
import type { Node, Root } from 'fumadocs-core/page-tree';
import { MenuAutoClose } from 'component/MenuAutoClose';
import { ExternalIcon } from 'component/ExternalIcon';
import { breakpoints } from 'lib/mediaQuery';
import { homeTheme } from 'lib/theme';

const styles = css.create({
  sidebar: {
    position: 'sticky',
    top: 56,
    display: 'flex',
    flexDirection: 'column',
    gridRow: 1,
    gridColumn: 1,
    gap: 2,
    alignSelf: 'start',
    width: 'auto',
    height: 'calc(100dvh - 56px)',
    padding: '32px 16px 16px',
    margin: 0,
    overflowY: 'auto',
    overscrollBehavior: 'contain',
    color: homeTheme.foreground,
    scrollbarWidth: 'none',
    background: homeTheme.background,
    borderColor: homeTheme.border,
    borderStyle: 'solid',
    borderWidth: '0 1px 0 0',
    [breakpoints.md]: {
      position: 'fixed',
      top: 104,
      bottom: 0,
      left: 0,
      display: 'none',
      width: 'min(320px, 85vw)',
      height: 'calc(100dvh - 104px)',
      ':popover-open': {
        display: 'flex',
      },
    },
  },
  separator: {
    padding: '0 8px',
    margin: '56px 0 16px',
    fontSize: 11,
    fontWeight: 500,
    lineHeight: '16px',
    color: homeTheme.label,
    letterSpacing: '0.08em',
    ':first-child': {
      marginTop: 24,
    },
  },
  link: {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 8px',
    fontSize: 14,
    lineHeight: '20px',
    color: homeTheme.muted,
    overflowWrap: 'anywhere',
    textDecoration: 'none',
    borderRadius: 8,
    ':hover': {
      color: homeTheme.primary,
    },
  },
  active: {
    color: homeTheme.primary,
    background: homeTheme.primarySoft,
  },
  nested: {
    paddingLeft: 20,
  },
  label: {
    flex: 1,
    alignSelf: 'stretch',
    padding: '6px 8px',
    margin: '-6px -8px',
    color: 'inherit',
    textDecoration: 'none',
  },
  folder: {
    justifyContent: 'space-between',
    cursor: 'pointer',
    listStyle: 'none',
  },
  external: {
    gap: 4,
  },
  arrow: {
    flexShrink: 0,
    transition: 'transform 0.2s ease',
    ':is([open] > summary > *)': {
      transform: 'rotate(90deg)',
    },
  },
  subnav: {
    position: 'sticky',
    top: 56,
    zIndex: 30,
    display: 'none',
    gap: 16,
    alignItems: 'center',
    height: 48,
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
    padding: 0,
    color: 'inherit',
    cursor: 'pointer',
    background: 'none',
    borderWidth: 0,
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
export const sectionName = (name: string) =>
  name
    .toLowerCase()
    .replace(/\b\w+/g, (word) =>
      word === 'ai' || word === 'api' ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1),
    );

const contains = (nodes: Node[], url: string): boolean =>
  nodes.some((node) =>
    node.type === 'page'
      ? node.url === url
      : node.type === 'folder' && (node.index?.url === url || contains(node.children, url)),
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

function Items({ nodes, path, depth = 0 }: { nodes: Node[]; path: string; depth?: number }) {
  return nodes.map((node, index) => {
    if (node.type === 'separator') {
      return (
        <p key={index} sx={styles.separator}>
          {node.name}
        </p>
      );
    }
    if (node.type === 'folder') {
      return (
        <details key={index} open={node.defaultOpen || node.index?.url === path || contains(node.children, path)}>
          <summary
            sx={[styles.link, styles.folder, depth > 0 && styles.nested, node.index?.url === path && styles.active]}
          >
            {node.index ? (
              <Link to={node.index.url} className={css.use(styles.label)}>
                {node.name}
              </Link>
            ) : (
              node.name
            )}
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
              sx={styles.arrow}
            >
              <path d="m9 18 6-6-6-6" />
            </svg>
          </summary>
          <Items nodes={node.children} path={path} depth={depth + 1} />
        </details>
      );
    }
    if (node.external) {
      return (
        <a
          key={index}
          href={node.url}
          target="_blank"
          rel="noreferrer"
          className={css.use(styles.link, styles.external, depth > 0 && styles.nested)}
        >
          {node.name}
          <ExternalIcon />
        </a>
      );
    }
    const active = path === node.url;
    return (
      <Link
        key={index}
        to={node.url}
        aria-current={active ? 'page' : undefined}
        className={css.use(styles.link, depth > 0 && styles.nested, active && styles.active)}
      >
        {node.name}
      </Link>
    );
  });
}

export function DocsSidebar({ tree }: { tree: Root }) {
  const path = useRouter().path.replace(/\/$/, '') || '/';
  const crumbs = findTrail(tree.children, path) ?? [];

  return (
    <>
      <div sx={styles.subnav}>
        <button type="button" popoverTarget="docs-sidebar" aria-label="Open Sidebar" sx={styles.trigger}>
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
        </button>
        <nav aria-label="Breadcrumb" sx={styles.trail}>
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
                  sx={styles.chevron}
                >
                  <path d="m9 18 6-6-6-6" />
                </svg>
              )}
              <span sx={index === crumbs.length - 1 ? styles.current : styles.parent}>{crumb}</span>
            </Fragment>
          ))}
        </nav>
      </div>
      <aside id="docs-sidebar" popover="auto" aria-label="Docs" sx={styles.sidebar}>
        <MenuAutoClose id="docs-sidebar" />
        <Items nodes={tree.children} path={path} />
      </aside>
    </>
  );
}
