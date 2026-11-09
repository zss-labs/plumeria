import { defineDocs, defineConfig } from 'fumadocs-mdx/config';
import { pageSchema } from 'fumadocs-core/source/schema';
import lastModified from 'fumadocs-mdx/plugins/last-modified';
import { z } from 'zod';
import rehypeKatex from 'rehype-katex';
import remarkMath from 'remark-math';

const noTranslate = (n: any) =>
  /^(pre|code)$/.test(n.tagName) ? (n.properties.translate = 'no') : n.children?.forEach(noTranslate);

export const { docs, meta } = defineDocs({
  dir: 'content/docs',
  docs: {
    async: true,
    schema: pageSchema.extend({
      stability: z.enum(['Frozen', 'Stable', 'Candidate']).optional(),
    }),
    postprocess: { includeProcessedMarkdown: true },
  },
});

export const { docs: blogDocs, meta: blogMeta } = defineDocs({
  dir: 'content/blog',
  docs: {
    async: true,
    schema: pageSchema.extend({
      date: z.string(),
    }),
  },
});

export default defineConfig({
  plugins: [lastModified()],
  mdxOptions: {
    remarkPlugins: [remarkMath],
    rehypePlugins: (v) => [rehypeKatex, ...v, () => noTranslate],
    rehypeCodeOptions: {
      inline: 'tailing-curly-colon',
      themes: {
        light: 'laserwave',
        dark: 'laserwave',
      },
    },
  },
});
