import generateSEOData from 'lib/generateSEOData';

type SeoProps = Parameters<typeof generateSEOData>[0];

export const Seo = (props: SeoProps) => {
  const { title, description, metadataBase, alternates, openGraph, twitter } = generateSEOData(props);
  const url = (path: string) => new URL(path, metadataBase).toString();

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
    </>
  );
};
