import { source } from 'lib/source';

const markdownSlug = (slugs: string[]) => {
  const path = ['docs', ...slugs];
  return [...path.slice(0, -1), `${path.at(-1)}.md`];
};

export async function GET(_req: Request, { params }: { params: { slug: string[] } }): Promise<Response> {
  const page = source.getPages().find((page) => markdownSlug(page.slugs).join('/') === params.slug.join('/'));
  if (!page) return new Response('Not Found', { status: 404 });

  const url = new URL(page.url, process.env.PROD_URL).toString();
  const processed = await page.data.getText('processed');

  return new Response(`# ${page.data.title}\n\nSource: ${url}\n\n${processed}`, {
    headers: { 'Content-Type': 'text/markdown; charset=utf-8' },
  });
}

export const getConfig = async () => {
  return {
    render: 'static',
    staticPaths: source.getPages().map((page) => markdownSlug(page.slugs)),
  } as const;
};
