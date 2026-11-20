import type { ReactNode } from 'react';
import { DocsShell } from 'component/DocsShell';
import { localizedSource } from 'lib/source';

export default function Layout({ children }: { children: ReactNode }) {
  return <DocsShell tree={localizedSource.getPageTree('ja')}>{children}</DocsShell>;
}

export const getConfig = async () => {
  return {
    render: 'static',
  } as const;
};
