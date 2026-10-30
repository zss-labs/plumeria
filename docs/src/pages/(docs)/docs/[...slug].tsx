import { source } from 'lib/source';
import { DocsPage, DocsBody, DocsDescription, DocsTitle, EditOnGitHub } from 'fumadocs-ui/page';
import { Footer } from 'fumadocs-ui/layouts/docs/page/slots/footer';
import { unstable_notFound as notFound } from 'waku/router/server';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import { MarkdownActions } from 'component/MarkdownActions';
import { Seo } from 'component/Seo';
import { SiteFooter } from 'component/SiteFooter';
import type { Node } from 'fumadocs-core/page-tree';

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

export default async function Page({ slug }: { slug?: string[] }) {
  const page = source.getPage(slug);
  if (!page) notFound();

  const { body: MDX, toc } = await page.data.load();
  const section = getSection(source.pageTree.children, page.url);

  return (
    <DocsPage
      toc={toc}
      full={page.data.full}
      footer={{ enabled: false }}
      tableOfContent={{
        style: 'clerk',
        single: true,
      }}
      tableOfContentPopover={{ enabled: false }}
    >
      <Seo title={page.data.title as string} subtitle={page.data.description} path={page.url} />
      <header className="docs-article-header">
        {section && <p className="docs-article-section">{section}</p>}
        <div className="docs-article-title-row">
          <DocsTitle>{page.data.title}</DocsTitle>
          <MarkdownActions markdownUrl={`${page.url}.md`} />
        </div>
        {page.data.description && (
          <DocsDescription className="docs-article-description">{page.data.description}</DocsDescription>
        )}
      </header>
      <DocsBody>
        <MDX components={{ ...defaultMdxComponents }} />
      </DocsBody>
      <EditOnGitHub href={`https://github.com/zss-labs/plumeria/blob/main/docs/content/docs/${page.path}`} />
      <Footer />
      <SiteFooter />
    </DocsPage>
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
