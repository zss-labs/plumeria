import { DocPage } from '../../(docs)/docs/[...slug]';

export default function Page() {
  return <DocPage lang="ja" />;
}

export const getConfig = async () => {
  return {
    render: 'static',
  } as const;
};
