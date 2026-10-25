import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import 'katex/dist/katex.css';
import type { ReactNode } from 'react';
import { baseOptions } from 'app/layout.config';
import { blog } from 'lib/source';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <DocsLayout tree={blog.pageTree} {...baseOptions}>
      {children}
    </DocsLayout>
  );
}
