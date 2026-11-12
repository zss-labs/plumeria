import * as css from '@plumeria/core';
import { Link } from 'waku';
import { unstable_notFound as notFound } from 'waku/router/server';
import { findNeighbour, type Node } from 'fumadocs-core/page-tree';
import { source } from 'lib/source';
import { breakpoints } from 'lib/mediaQuery';
import { homeTheme } from 'lib/theme';
import { CopyPage } from 'component/CopyButton';
import { DocsArticle } from 'component/DocsArticle';
import { mdxComponents } from 'component/DocsMdx';
import { Seo } from 'component/Seo';
import { SiteFooter } from 'component/SiteFooter';

const styles = css.create({
  section: {
    margin: '0 0 10px',
    fontSize: 11,
    fontWeight: 600,
    color: homeTheme.label,
    letterSpacing: '0.06em',
  },
  titleRow: {
    display: 'flex',
    gap: 24,
    alignItems: 'center',
    justifyContent: 'space-between',
    [breakpoints.md]: {
      flexDirection: 'column',
      gap: 16,
      alignItems: 'flex-start',
    },
  },
  titleGroup: {
    display: 'flex',
    gap: 12,
    alignItems: 'center',
    minWidth: 0,
  },
  title: {
    minWidth: 0,
    margin: 0,
    fontSize: 30,
    fontWeight: 500,
    lineHeight: '36px',
    color: homeTheme.foreground,
    letterSpacing: '-0.025em',
    overflowWrap: 'anywhere',
  },
  stability: {
    flexShrink: 0,
    padding: '2px 7px',
    fontSize: 11,
    fontWeight: 500,
    lineHeight: '18px',
    color: homeTheme.muted,
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap',
    borderColor: homeTheme.border,
    borderStyle: 'solid',
    borderWidth: 1,
    borderRadius: 999,
  },
  stars: {
    color: '#e5a000',
  },
  description: {
    margin: '16px 0 0',
    fontSize: 16,
    fontWeight: 320,
    lineHeight: 1.6,
    color: homeTheme.prose,
  },
  edit: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    height: 28,
    marginTop: 32,
    fontSize: 12,
    fontWeight: 500,
    color: homeTheme.foreground,
    textDecoration: 'none',
    background: homeTheme.accent,
    borderColor: homeTheme.border,
    borderStyle: 'solid',
    borderWidth: 1,
    borderRadius: 6,
    transitionDuration: '0.2s',
    ':hover': {
      opacity: 0.8,
    },
  },
  neighbours: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr',
    gap: 16,
    marginTop: 24,
    [breakpoints.md]: {
      gridTemplateColumns: '1fr',
    },
  },
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    minWidth: 0,
    padding: 16,
    fontSize: 14,
    color: homeTheme.foreground,
    textDecoration: 'none',
    borderColor: homeTheme.border,
    borderStyle: 'solid',
    borderWidth: 1,
    borderRadius: 8,
    transitionDuration: '0.2s',
    transitionProperty: 'background-color',
    ':hover': {
      background: `color-mix(in oklab, ${homeTheme.accent} 40%, transparent)`,
    },
  },
  next: {
    gridColumn: 2,
    alignItems: 'flex-end',
    textAlign: 'right',
    [breakpoints.md]: {
      gridColumn: 1,
    },
  },
  cardTitle: {
    display: 'inline-flex',
    gap: 4,
    alignItems: 'center',
    fontWeight: 500,
  },
  cardDescription: {
    maxWidth: '100%',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    color: homeTheme.muted,
    whiteSpace: 'nowrap',
  },
});

const stability = {
  Frozen: ['★★★★★', 'Bug fixes ship continuously. The signature will not change.'],
  Stable: ['★★★★☆', 'Additive only. Existing signatures will not move.'],
  Candidate: ['★★★☆☆', 'Shape is settled. Details may still change.'],
} as const;

const getSection = (nodes: Node[], url: string, section = ''): string | undefined => {
  let current = section;
  for (const node of nodes) {
    if (node.type === 'separator') current = typeof node.name === 'string' ? node.name : section;
    if (node.type === 'page' && node.url === url) return current;
    if (node.type === 'folder') {
      if (node.index?.url === url) return current;
      const found = getSection(node.children, url, current);
      if (found !== undefined) return found;
    }
  }
};

const Chevron = ({ d }: { d: string }) => (
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
    <path d={d} />
  </svg>
);

export default async function Page({ slug }: { slug?: string[] }) {
  const page = source.getPage(slug);
  if (!page) notFound();

  const { body: MDX, toc } = await page.data.load();
  const section = getSection(source.pageTree.children, page.url);
  const stabilityEntry = page.data.stability ? stability[page.data.stability] : undefined;
  const { previous, next } = findNeighbour(source.pageTree, page.url);
  const describe = (url: string) => source.getPages().find((item) => item.url === url)?.data.description;

  return (
    <DocsArticle
      toc={toc}
      header={
        <>
          <Seo title={page.data.title as string} subtitle={page.data.description} path={page.url} />
          {section && <p sx={styles.section}>{section}</p>}
          <div sx={styles.titleRow}>
            <div sx={styles.titleGroup}>
              <h1 sx={styles.title}>{page.data.title}</h1>
              {stabilityEntry && (
                <span title={stabilityEntry[1]} sx={styles.stability}>
                  <span sx={styles.stars}>{stabilityEntry[0]}</span> {page.data.stability}
                </span>
              )}
            </div>
            <CopyPage markdownUrl={`${page.url}.md`} />
          </div>
          {page.data.description && <p sx={styles.description}>{page.data.description}</p>}
        </>
      }
      footer={
        <>
          <a
            href={`https://github.com/zss-labs/plumeria/blob/main/docs/content/docs/${page.path}`}
            target="_blank"
            rel="noreferrer noopener"
            sx={styles.edit}
          >
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
              <path d="M12 20h9M16.38 3.62a2.12 2.12 0 1 1 3 3L7.37 18.64 3 20l1.36-4.37Z" />
            </svg>
            Edit on GitHub
          </a>
          <nav aria-label="Pagination" sx={styles.neighbours}>
            {previous && (
              <Link to={previous.url} className={css.use(styles.card)}>
                <span sx={styles.cardTitle}>
                  <Chevron d="m15 18-6-6 6-6" />
                  {previous.name}
                </span>
                <span sx={styles.cardDescription}>{describe(previous.url)}</span>
              </Link>
            )}
            {next && (
              <Link to={next.url} className={css.use(styles.card, styles.next)}>
                <span sx={styles.cardTitle}>
                  {next.name}
                  <Chevron d="m9 18 6-6-6-6" />
                </span>
                <span sx={styles.cardDescription}>{describe(next.url)}</span>
              </Link>
            )}
          </nav>
          <SiteFooter />
        </>
      }
    >
      <MDX components={mdxComponents} />
    </DocsArticle>
  );
}

export const getConfig = async () => {
  return {
    render: 'static',
    staticPaths: source
      .generateParams()
      .map(({ slug }) => slug)
      .filter((slug) => slug.length > 0),
  } as const;
};
