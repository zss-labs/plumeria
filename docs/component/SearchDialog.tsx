'use client';

import * as css from '@plumeria/core';
import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useDocsSearch } from 'fumadocs-core/search/client';
import type { SortedResult } from 'fumadocs-core/search';
import { Link } from 'waku';
import { OPEN_SEARCH } from 'lib/openSearch';
import { homeTheme } from 'lib/theme';

const styles = css.create({
  dialog: {
    width: 'min(640px, 100vw - 32px)',
    maxHeight: 'min(480px, 100dvh - 96px)',
    padding: 0,
    margin: 'auto',
    overflow: 'hidden',
    color: homeTheme.foreground,
    background: homeTheme.background,
    borderColor: homeTheme.border,
    borderStyle: 'solid',
    borderWidth: 1,
    borderRadius: 16,
    '[open]': {
      display: 'flex',
      flexDirection: 'column',
    },
    '::backdrop': {
      background: 'rgba(0, 0, 0, 0.4)',
      backdropFilter: 'blur(2px)',
    },
  },
  field: {
    display: 'flex',
    gap: 10,
    alignItems: 'center',
    padding: '0 16px',
    color: homeTheme.muted,
    borderBottomColor: homeTheme.border,
    borderBottomStyle: 'solid',
    borderBottomWidth: 1,
  },
  input: {
    flex: 1,
    width: 0,
    height: 52,
    fontFamily: 'inherit',
    fontSize: 15,
    color: homeTheme.foreground,
    outline: 'none',
    background: 'none',
    borderWidth: 0,
    '::placeholder': {
      color: homeTheme.muted,
    },
  },
  list: {
    padding: 8,
    margin: 0,
    overflowY: 'auto',
    listStyle: 'none',
  },
  result: {
    display: 'block',
    padding: '8px 12px',
    fontSize: 14,
    color: homeTheme.muted,
    textDecoration: 'none',
    borderRadius: 8,
    ':is(:hover, :focus-visible)': {
      color: homeTheme.foreground,
      outline: 'none',
      background: homeTheme.accent,
    },
  },
  empty: {
    padding: '24px 12px',
    fontSize: 14,
    color: homeTheme.muted,
    textAlign: 'center',
  },
  breadcrumbs: {
    display: 'flex',
    gap: 2,
    alignItems: 'center',
    fontSize: 12,
    color: homeTheme.muted,
  },
  title: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    minWidth: 0,
    fontSize: 15,
    fontWeight: 500,
  },
  hash: {
    flexShrink: 0,
    color: homeTheme.muted,
  },
  mark: {
    color: homeTheme.primary,
    textDecoration: 'underline',
  },
  code: {
    fontFamily: 'ui-monospace, Menlo, Monaco, Consolas, monospace',
    fontSize: '0.9em',
  },
});

const unescape = (text: string) => text.replace(/\\(.)/g, '$1');

const plainText = (content: string) => unescape(content.replace(/<\/?mark>/g, '').replace(/`/g, ''));

const renderMarks = (text: string): ReactNode[] =>
  text
    .split(/(<mark>.*?<\/mark>)/g)
    .filter(Boolean)
    .map((part, index) =>
      part.startsWith('<mark>') ? (
        <span key={index} sx={styles.mark}>
          {unescape(part.slice('<mark>'.length, -'</mark>'.length))}
        </span>
      ) : (
        <Fragment key={index}>{unescape(part)}</Fragment>
      ),
    );

const renderContent = (content: string): ReactNode[] =>
  content
    .split(/(`[^`]+`)/g)
    .filter(Boolean)
    .map((part, index) =>
      part.startsWith('`') ? (
        <code key={index} sx={styles.code}>
          {renderMarks(part.slice(1, -1))}
        </code>
      ) : (
        <Fragment key={index}>{renderMarks(part)}</Fragment>
      ),
    );

const withPageBreadcrumbs = (items: SortedResult[]) => {
  let page: SortedResult | undefined;
  return items
    .filter((item) => item.type !== 'text')
    .map((item) => {
      if (item.type === 'page') {
        page = item;
        return item;
      }
      return {
        ...item,
        breadcrumbs: page ? [...(page.breadcrumbs ?? []), plainText(page.content as string)] : item.breadcrumbs,
      };
    });
};

const DEFAULT_QUERY = 'css.create';

// Pages whose title holds the query come first, each tier in sidebar order.
const sortBySidebar = (items: SortedResult[], query: string) => {
  const groups: SortedResult[][] = [];
  for (const item of items) {
    if (item.type === 'page' || groups.length === 0) groups.push([]);
    groups.at(-1)!.push(item);
  }

  const rank = ([page]: SortedResult[]) =>
    (plainText(page.content as string)
      .toLowerCase()
      .includes(query.toLowerCase())
      ? 0
      : 1e6) + parseInt(page.id);

  return groups.sort((a, b) => rank(a) - rank(b)).flat();
};

const Chevron = () => (
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
    <path d="m9 18 6-6-6-6" />
  </svg>
);

const Hash = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    sx={styles.hash}
  >
    <path d="M4 9h16M4 15h16M10 3 8 21M16 3l-2 18" />
  </svg>
);

const DIALOG_ID = 'search-dialog';

const SearchIcon = () => (
  <svg
    width="14"
    height="14"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    aria-hidden="true"
  >
    <circle cx="11" cy="11" r="7" />
    <path d="m20 20-3.5-3.5" />
  </svg>
);

export const SearchDialog = () => {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const { search, setSearch, query } = useDocsSearch({ type: 'static' });
  const [input, setInput] = useState('');
  const items = useMemo(
    () => (query.data === 'empty' ? [] : sortBySidebar(withPageBreadcrumbs(query.data ?? []), search)),
    [query.data, search],
  );

  // Mounts on the first request, so it opens right away and then on every later one.
  useEffect(() => {
    const show = () => {
      dialog.current?.showModal();
      setOpen(true);
    };
    show();
    window.addEventListener(OPEN_SEARCH, show);
    return () => window.removeEventListener(OPEN_SEARCH, show);
  }, []);

  // Waits for the dialog to open, as the first query downloads the whole index.
  useEffect(() => {
    if (open) setSearch(input || DEFAULT_QUERY);
  }, [open, input, setSearch]);

  const close = () => dialog.current?.close();

  return (
    <dialog
      ref={dialog}
      id={DIALOG_ID}
      aria-label="Search"
      sx={styles.dialog}
      onClose={() => setOpen(false)}
      onClick={(event) => event.target === event.currentTarget && close()}
    >
      <label sx={styles.field}>
        <SearchIcon />
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="Search documentation"
          autoFocus
          sx={styles.input}
        />
      </label>
      {open && (
        <ul sx={styles.list}>
          {items.map((item) => (
            <li key={item.id}>
              <Link to={item.url} className={css.use(styles.result)} onClick={close}>
                {item.breadcrumbs && item.breadcrumbs.length > 0 && (
                  <div sx={styles.breadcrumbs}>
                    {item.breadcrumbs.map((crumb, index) => (
                      <Fragment key={index}>
                        {index > 0 && <Chevron />}
                        {crumb}
                      </Fragment>
                    ))}
                  </div>
                )}
                <div sx={styles.title}>
                  {item.type === 'heading' && <Hash />}
                  <span>{typeof item.content === 'string' ? renderContent(item.content) : item.content}</span>
                </div>
              </Link>
            </li>
          ))}
          {!query.isLoading && items.length === 0 && <li sx={styles.empty}>No results</li>}
        </ul>
      )}
    </dialog>
  );
};
