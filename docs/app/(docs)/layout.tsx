import 'katex/dist/katex.css';
import type { ReactNode } from 'react';
import { baseOptions } from 'app/layout.config';
import { source } from 'lib/source';
import { SectionDocsLayout } from './docs-layout';

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <SectionDocsLayout tree={source.pageTree} {...baseOptions}>
      {children}
    </SectionDocsLayout>
  );
}
