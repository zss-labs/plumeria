import { HomePage } from '../index';

export default function Page() {
  return <HomePage lang="ja" />;
}

export const getConfig = async () => ({ render: 'static' }) as const;
