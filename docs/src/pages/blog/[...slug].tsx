import { unstable_notFound as notFound } from 'waku/router/server';
import { blog } from 'lib/source';
import { JSX } from 'react';
import '@plumeria/core';
import { styles } from './_components/styles';
import { DocsArticle } from 'component/DocsArticle';
import { mdxComponents } from 'component/DocsMdx';
import { Seo } from 'component/Seo';
import { formatDate } from 'lib/formatDate';

export default async function Page({ slug }: { slug?: Array<string> }): Promise<JSX.Element> {
  const page = blog.getPage(slug);
  if (!page) notFound();
  const { body: MDX, toc } = await page.data.load();

  return (
    <DocsArticle
      toc={toc}
      header={
        <>
          <Seo title={page.data.title as string} subtitle={page.data.description} path={page.url} />
          {page.data.title && <h1 sx={styles.title}>{page.data.title}</h1>}
          <p sx={styles.date}>
            <time dateTime={page.data.date}>{formatDate(page.data.date)}</time>
          </p>
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
    staticPaths: blog.getPages().map((page) => page.slugs),
  } as const;
};
