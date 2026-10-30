import { searchSource } from 'lib/source';
import { createFromSource } from 'fumadocs-core/search/server';
import type { Node } from 'fumadocs-core/page-tree';
import { basename, extname } from 'node:path';

const breadcrumbs = new Map<string, string[]>();

const collectBreadcrumbs = (nodes: Node[], parents: string[]) => {
  let section = parents;
  for (const node of nodes) {
    if (node.type === 'separator') section = typeof node.name === 'string' ? [...parents, node.name] : parents;
    if (node.type === 'page') breadcrumbs.set(node.url, section);
    if (node.type === 'folder') {
      if (node.index) breadcrumbs.set(node.index.url, section);
      collectBreadcrumbs(node.children, typeof node.name === 'string' ? [...section, node.name] : section);
    }
  }
};

collectBreadcrumbs(searchSource.pageTree.children, []);

// The tree is walked top to bottom, so insertion order is the sidebar order.
const sidebarOrder = new Map([...breadcrumbs.keys()].map((url, index) => [url, index]));

const tokenize = (raw: string) => [
  ...new Set(
    raw
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean)
      .flatMap((word) => [word, ...word.split(/(?<=\p{Ll})(?=\p{Lu})/u)])
      .map((word) => word.toLowerCase()),
  ),
];

export const { staticGET: GET } = createFromSource(searchSource, {
  tokenizer: { language: 'english', normalizationCache: new Map(), tokenize },
  buildIndex: async (page) => ({
    // Results only carry their id, so it holds the sidebar position for the dialog to sort by.
    id: `${sidebarOrder.get(page.url) ?? sidebarOrder.size}:${page.url}`,
    title: page.data.title ?? basename(page.path, extname(page.path)),
    breadcrumbs: breadcrumbs.get(page.url) ?? [],
    url: page.url,
    structuredData: { headings: (await page.data.load()).structuredData.headings, contents: [] },
  }),
});

export const getConfig = async () => {
  return {
    render: 'static',
  } as const;
};
