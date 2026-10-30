import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import 'katex/dist/katex.css';
import type { ReactNode } from 'react';
import { baseOptions } from 'lib/layout.config';
import { source } from 'lib/source';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout tree={source.pageTree} {...baseOptions}>
      {children}
    </DocsLayout>
  );
}

export const getConfig = async () => {
  return {
    render: 'static',
  } as const;
};
