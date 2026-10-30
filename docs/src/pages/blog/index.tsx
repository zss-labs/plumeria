import type { JSX } from 'react';
import { latestBlogUrl } from 'lib/latestBlogUrl';
import Post from './[...slug]';

export default function Page(): JSX.Element {
  return <Post slug={latestBlogUrl.split('/').slice(2)} />;
}

export const getConfig = async () => {
  return {
    render: 'static',
  } as const;
};
