import type { DocsLayoutProps } from 'fumadocs-ui/layouts/docs';
import { DocsSubnav, NoNavTitle } from 'component/DocsSubnav';

// The site header owns the logo, links, search and theme switch.
export const baseOptions: Omit<DocsLayoutProps, 'tree' | 'children'> = {
  links: [],
  searchToggle: { enabled: false },
  themeSwitch: { enabled: false },
  sidebar: { collapsible: false },
  slots: { header: DocsSubnav, navTitle: NoNavTitle },
};
