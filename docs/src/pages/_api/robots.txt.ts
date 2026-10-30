export function GET(): Response {
  const body = [
    'User-Agent: *',
    'Allow: /',
    'Disallow: /api/search',
    '',
    `Sitemap: ${process.env.PROD_URL}/sitemap.xml`,
    '',
  ].join('\n');

  return new Response(body, {
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}

export const getConfig = async () => {
  return {
    render: 'static',
  } as const;
};
