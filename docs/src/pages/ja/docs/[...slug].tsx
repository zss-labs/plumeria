import { DocPage } from '../../(docs)/docs/[...slug]';
import { localizedSource } from 'lib/source';

export default function Page({ slug }: { slug?: string[] }) {
  return <DocPage slug={slug} lang="ja" />;
}

export const getConfig = async () => {
  return {
    render: 'static',
    staticPaths: localizedSource
      .generateParams()
      .filter(({ lang, slug }) => lang === 'ja' && slug.length > 0)
      .map(({ slug }) => slug),
  } as const;
};
