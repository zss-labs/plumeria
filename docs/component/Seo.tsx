import generateSEOData from 'lib/generateSEOData';

type SeoProps = Parameters<typeof generateSEOData>[0];

export const Seo = (props: SeoProps) => {
  const { title, description, metadataBase, alternates, openGraph, twitter } = generateSEOData(props);
  const url = (path: string) => new URL(path, metadataBase).toString();
  const path = alternates.canonical;

  const jsonLd =
    path === '/'
      ? {
          '@context': 'https://schema.org',
          '@graph': [
            {
              '@type': 'WebSite',
              '@id': `${url('/')}#website`,
              url: url('/'),
              name: 'Plumeria',
              description,
              publisher: { '@id': `${url('/')}#organization` },
            },
            {
              '@type': 'Organization',
              '@id': `${url('/')}#organization`,
              name: 'Plumeria',
              url: url('/'),
              sameAs: ['https://github.com/zss-labs/plumeria'],
            },
          ],
        }
      : {
          '@context': 'https://schema.org',
          '@type': 'BreadcrumbList',
          itemListElement: [
            { '@type': 'ListItem', position: 1, name: 'Home', item: url('/') },
            ...path
              .split('/')
              .filter(Boolean)
              .map((segment, i, segments) => ({
                '@type': 'ListItem',
                position: i + 2,
                name: i === segments.length - 1 ? title : segment.charAt(0).toUpperCase() + segment.slice(1),
                item: url(`/${segments.slice(0, i + 1).join('/')}`),
              })),
          ],
        };

  return (
    <>
      <title>{title}</title>
      {description && <meta name="description" content={description} />}
      <link rel="canonical" href={url(alternates.canonical)} />
      <meta property="og:title" content={openGraph.title} />
      {description && <meta property="og:description" content={description} />}
      <meta property="og:url" content={url(openGraph.url)} />
      <meta property="og:type" content={openGraph.type} />
      <meta property="og:image" content={openGraph.images.url} />
      <meta property="og:image:width" content={String(openGraph.images.width)} />
      <meta property="og:image:height" content={String(openGraph.images.height)} />
      <meta name="twitter:card" content={twitter.card} />
      <meta name="twitter:title" content={twitter.title} />
      {description && <meta name="twitter:description" content={description} />}
      <meta name="twitter:image" content={twitter.images.url} />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd).replace(/</g, '\\u003c') }}
      />
    </>
  );
};
