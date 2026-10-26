'use client';

import { DocsLayout, type DocsLayoutProps } from 'fumadocs-ui/layouts/docs';
import { usePathname } from 'next/navigation';

export function SectionDocsLayout({ links, ...props }: DocsLayoutProps) {
  const inApi = usePathname().startsWith('/docs/api-reference');
  return (
    <DocsLayout
      {...props}
      links={links?.map((link) =>
        inApi && link.type !== 'custom' && link.url === '/docs' ? { ...link, active: 'url' } : link,
      )}
    />
  );
}
