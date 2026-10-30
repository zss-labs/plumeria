import { unstable_notFound as notFound } from 'waku/router/server';
import { blog } from 'lib/source';
import { JSX } from 'react';
import { DocsPage, DocsBody } from 'fumadocs-ui/page';
import defaultMdxComponents from 'fumadocs-ui/mdx';
import '@plumeria/core';
import { styles } from './_components/styles';
import { Seo } from 'component/Seo';
import { formatDate } from 'lib/formatDate';

export default async function Page({ slug }: { slug?: Array<string> }): Promise<JSX.Element> {
  const page = blog.getPage(slug);
  if (!page) notFound();
  const { body: MDX, toc } = await page.data.load();

  return (
    <DocsPage
      toc={toc}
      footer={{ enabled: false }}
      tableOfContent={{
        style: 'clerk',
        single: true,
      }}
      tableOfContentPopover={{ enabled: false }}
    >
      <Seo title={page.data.title as string} subtitle={page.data.description} path={page.url} />
      {page.data.title && <h1 classStyle={styles.title}>{page.data.title}</h1>}
      <p classStyle={styles.date}>
        <time dateTime={page.data.date}>{formatDate(page.data.date)}</time>
      </p>
      <DocsBody>
        <MDX components={{ ...defaultMdxComponents }} />
      </DocsBody>
    </DocsPage>
  );
}

export const getConfig = async () => {
  return {
    render: 'static',
    staticPaths: blog.getPages().map((page) => page.slugs),
  } as const;
};
