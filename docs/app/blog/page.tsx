import type { Metadata } from 'next';
import type { JSX } from 'react';
import { latestBlogUrl } from 'lib/latestBlogUrl';
import Post, { generateMetadata as postMetadata } from './[...slug]/page';

const params = Promise.resolve({ slug: latestBlogUrl.split('/').slice(2) });

export function generateMetadata(): Promise<Metadata> {
  return postMetadata({ params });
}

export default function Page(): Promise<JSX.Element> {
  return Post({ params });
}
