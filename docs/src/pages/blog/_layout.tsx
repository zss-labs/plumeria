import type { ReactNode } from 'react';
import { DocsShell } from 'component/DocsShell';
import { blog } from 'lib/source';

export default function Layout({ children }: { children: ReactNode }) {
  return <DocsShell tree={blog.pageTree}>{children}</DocsShell>;
}

export const getConfig = async () => {
  return {
    render: 'static',
  } as const;
};
