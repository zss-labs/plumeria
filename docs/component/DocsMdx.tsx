import * as css from '@plumeria/core';
import { Link } from 'waku';
import { isValidElement, type ComponentProps, type ReactNode } from 'react';
import type { MDXComponents } from 'mdx/types';
import { CopyCode } from 'component/CopyButton';
import { breakpoints } from 'lib/mediaQuery';
import { homeTheme } from 'lib/theme';

const styles = css.create({
  heading: {
    display: 'flex',
    alignItems: 'center',
    color: homeTheme.foreground,
    scrollMarginTop: 112,
  },
  h2: {
    margin: '42px 0 21px',
    fontSize: 21,
    fontWeight: 600,
    lineHeight: '28px',
  },
  h3: {
    margin: '28px 0 10.5px',
    fontSize: 17.5,
    fontWeight: 600,
    lineHeight: '28px',
  },
  h4: {
    margin: '24px 0 8px',
    fontSize: 14,
    fontWeight: 600,
  },
  anchor: {
    color: 'inherit',
    textDecoration: 'none',
  },
  p: {
    margin: '0 0 17.5px',
    ':last-child': {
      marginBottom: 0,
    },
  },
  a: {
    fontWeight: 500,
    color: homeTheme.foreground,
    textDecorationLine: 'underline',
    textDecorationThickness: 1,
    textDecorationColor: homeTheme.primary,
    textUnderlineOffset: 5,
  },
  strong: {
    fontWeight: 600,
    color: homeTheme.strong,
  },
  code: {
    padding: 3,
    fontFamily: 'var(--mono)',
    fontSize: 12,
    color: homeTheme.foreground,
    background: homeTheme.code,
    borderColor: homeTheme.border,
    borderStyle: 'solid',
    borderWidth: 1,
    borderRadius: 5,
  },
  list: {
    paddingLeft: 22,
    margin: '0 0 17.5px',
    listStyle: 'disc',
  },
  ordered: {
    listStyle: 'decimal',
  },
  li: {
    paddingLeft: 6,
    margin: '7px 0',
    '::marker': {
      color: homeTheme.label,
    },
  },
  blockquote: {
    paddingLeft: 16,
    margin: '0 0 17.5px',
    fontStyle: 'italic',
    borderLeftColor: homeTheme.border,
    borderLeftStyle: 'solid',
    borderLeftWidth: 2,
  },
  hr: {
    margin: '42px 0',
    borderColor: homeTheme.border,
    borderStyle: 'solid',
    borderWidth: '1px 0 0',
  },
  img: {
    maxWidth: '100%',
    height: 'auto',
    borderRadius: 8,
  },
  tableWrap: {
    margin: '24px 0',
    overflowX: 'auto',
    borderColor: homeTheme.border,
    borderStyle: 'solid',
    borderWidth: 1,
    borderRadius: 12,
  },
  table: {
    width: '100%',
    fontSize: 13,
    borderCollapse: 'collapse',
  },
  th: {
    padding: '8px 12px',
    fontWeight: 600,
    color: homeTheme.foreground,
    textAlign: 'left',
    background: homeTheme.code,
    borderBottomColor: homeTheme.border,
    borderBottomStyle: 'solid',
    borderBottomWidth: 1,
  },
  td: {
    padding: '8px 12px',
    borderBottomColor: homeTheme.border,
    borderBottomStyle: 'solid',
    borderBottomWidth: 1,
    ':is(tr:last-child > *)': {
      borderBottomWidth: 0,
    },
  },
  figure: {
    position: 'relative',
    margin: '16px 0',
    overflow: 'hidden',
    fontSize: 14,
    colorScheme: 'dark',
    background: 'rgb(12, 12, 14)',
    borderColor: 'rgba(255, 255, 255, 0.07)',
    borderStyle: 'solid',
    borderWidth: 1,
    borderRadius: 12,
    ':is([role="tabpanel"] > *)': {
      margin: 0,
      borderWidth: 0,
      borderRadius: 0,
    },
  },
  caption: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
    height: 38,
    padding: '0 8px 0 16px',
    color: 'rgba(179, 179, 179, 0.8)',
    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
    borderBottomStyle: 'solid',
    borderBottomWidth: 1,
  },
  captionTitle: {
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  pre: {
    padding: '16px 12px',
    margin: 0,
    overflowX: 'auto',
    fontFamily: 'var(--mono)',
    fontSize: 12,
    lineHeight: 1.75,
    color: '#e0dfe1',
    tabSize: 2,
    [breakpoints.md]: {
      fontSize: 11,
    },
  },
  callout: {
    display: 'flex',
    gap: 12,
    padding: '12px 16px 12px 4px',
    margin: '16px 0',
    fontSize: 14,
    borderColor: homeTheme.border,
    borderStyle: 'solid',
    borderWidth: 1,
    borderRadius: 12,
  },
  bar: {
    flexShrink: 0,
    width: 2,
    background: homeTheme.primary,
    borderRadius: 2,
  },
  warn: {
    background: '#f59e0b',
  },
  calloutBody: {
    display: 'flex',
    flex: 1,
    flexDirection: 'column',
    gap: 8,
    minWidth: 0,
  },
  calloutTitle: {
    margin: 0,
    fontWeight: 500,
    color: homeTheme.foreground,
  },
  cards: {
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
    gap: 12,
    margin: '16px 0',
    [breakpoints.md]: {
      gridTemplateColumns: 'minmax(0, 1fr)',
    },
  },
  card: {
    display: 'block',
    padding: 16,
    fontSize: 14,
    color: homeTheme.muted,
    textDecoration: 'none',
    borderColor: homeTheme.border,
    borderStyle: 'solid',
    borderWidth: 1,
    borderRadius: 12,
    transitionDuration: '0.2s',
    transitionProperty: 'background-color',
    ':hover': {
      background: `color-mix(in oklab, ${homeTheme.accent} 40%, transparent)`,
    },
  },
  cardTitle: {
    margin: '0 0 4px',
    fontWeight: 500,
    color: homeTheme.foreground,
  },
  cardDescription: {
    margin: 0,
  },
});

const ShellIcon = () => (
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
    <path d="m4 17 6-6-6-6M12 19h8" />
  </svg>
);

const FileIcon = () => (
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
    <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
    <path d="M14 2v5h6" />
  </svg>
);

const SHELL = /^(sh|bash|shell|zsh|console)$/;

type PreProps = ComponentProps<'pre'> & { title?: string; 'data-language'?: string; icon?: string };

function Pre({ title, children, ...props }: PreProps) {
  const language = props['data-language'] ?? '';
  // Shiki colors each token inline; the inner code element would otherwise take the inline code style.
  const lines = isValidElement<{ children?: ReactNode }>(children) ? children.props.children : children;
  const caption = title ?? (SHELL.test(language) ? 'Terminal' : undefined);

  return (
    <figure sx={styles.figure}>
      {caption ? (
        <figcaption sx={styles.caption}>
          {SHELL.test(language) ? <ShellIcon /> : <FileIcon />}
          <span sx={styles.captionTitle}>{caption}</span>
          <CopyCode />
        </figcaption>
      ) : (
        <CopyCode floating />
      )}
      <pre sx={styles.pre}>
        <code>{lines}</code>
      </pre>
    </figure>
  );
}

const heading = (level: 'h2' | 'h3' | 'h4') =>
  function Heading({ id, children }: { id?: string; children?: ReactNode }) {
    const Tag = level;
    return (
      <Tag id={id} sx={[styles.heading, styles[level]]}>
        {id ? (
          <a href={`#${id}`} sx={styles.anchor}>
            {children}
          </a>
        ) : (
          children
        )}
      </Tag>
    );
  };

function Anchor({ href = '', children }: ComponentProps<'a'>) {
  if (href.startsWith('/') || href.startsWith('#')) {
    return (
      <Link to={href} className={css.use(styles.a)}>
        {children}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" sx={styles.a}>
      {children}
    </a>
  );
}

export function Callout({
  title,
  type,
  children,
}: {
  title?: ReactNode;
  type?: 'info' | 'warn';
  children?: ReactNode;
}) {
  return (
    <div sx={styles.callout}>
      <div role="none" sx={[styles.bar, type === 'warn' && styles.warn]} />
      <div sx={styles.calloutBody}>
        {title && <p sx={styles.calloutTitle}>{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function Cards({ children }: { children?: ReactNode }) {
  return <div sx={styles.cards}>{children}</div>;
}

export function Card({
  href,
  title,
  description,
  children,
}: {
  href?: string;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  const body = (
    <>
      <p sx={styles.cardTitle}>{title}</p>
      {description && <p sx={styles.cardDescription}>{description}</p>}
      {children}
    </>
  );
  if (!href) return <div sx={styles.card}>{body}</div>;
  return (
    <Link to={href} className={css.use(styles.card)}>
      {body}
    </Link>
  );
}

export const mdxComponents: MDXComponents = {
  h2: heading('h2'),
  h3: heading('h3'),
  h4: heading('h4'),
  p: ({ children }) => <p sx={styles.p}>{children}</p>,
  a: Anchor,
  strong: ({ children }) => <strong sx={styles.strong}>{children}</strong>,
  code: ({ children }) => <code sx={styles.code}>{children}</code>,
  pre: Pre,
  img: ({ src, alt }) => <img src={src} alt={alt} loading="lazy" sx={styles.img} />,
  ul: ({ children }) => <ul sx={styles.list}>{children}</ul>,
  ol: ({ children, start }) => (
    <ol start={start} sx={[styles.list, styles.ordered]}>
      {children}
    </ol>
  ),
  li: ({ children }) => <li sx={styles.li}>{children}</li>,
  blockquote: ({ children }) => <blockquote sx={styles.blockquote}>{children}</blockquote>,
  hr: () => <hr sx={styles.hr} />,
  table: ({ children }) => (
    <div sx={styles.tableWrap}>
      <table sx={styles.table}>{children}</table>
    </div>
  ),
  th: ({ children }) => <th sx={styles.th}>{children}</th>,
  td: ({ children }) => <td sx={styles.td}>{children}</td>,
  Callout,
  Cards,
  Card,
};
