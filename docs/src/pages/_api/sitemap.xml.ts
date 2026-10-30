import { source, blog } from 'lib/source';

type Entry = { path: string; changeFrequency: string; priority: number };

export function GET(): Response {
  const url = (path: string): string => new URL(path, process.env.PROD_URL).toString();

  const entries: Entry[] = [
    { path: '/', changeFrequency: 'monthly', priority: 1 },
    { path: '/blog', changeFrequency: 'weekly', priority: 0.5 },
    ...source.getPages().map((page) => ({ path: page.url, changeFrequency: 'weekly', priority: 0.5 })),
    ...blog.getPages().map((page) => ({ path: page.url, changeFrequency: 'weekly', priority: 0.5 })),
  ];

  const body = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ...entries.map(
      ({ path, changeFrequency, priority }) =>
        `<url>\n<loc>${url(path)}</loc>\n<changefreq>${changeFrequency}</changefreq>\n<priority>${priority}</priority>\n</url>`,
    ),
    '</urlset>',
    '',
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml' },
  });
}

export const getConfig = async () => {
  return {
    render: 'static',
  } as const;
};
