// deno-fmt-ignore-file
// biome-ignore format: generated types do not need formatting
// prettier-ignore
import type { PathsForPages, GetConfigResponse, SearchCodecsForPages } from 'waku/router';

// prettier-ignore
import type { getConfig as File_DocsDocsSlug_getConfig } from './pages/(docs)/docs/[...slug]';
// prettier-ignore
import type { getConfig as File_DocsDocsIndex_getConfig } from './pages/(docs)/docs/index';
// prettier-ignore
import type { getConfig as File_DocsPlaygroundIndex_getConfig } from './pages/(docs)/playground/index';
// prettier-ignore
import type { getConfig as File_DocsPlaygroundMigrate_getConfig } from './pages/(docs)/playground/migrate';
// prettier-ignore
import type { getConfig as File_404_getConfig } from './pages/404';
// prettier-ignore
import type { getConfig as File_ApiOgpSlug_getConfig } from './pages/_api/ogp/[...slug]';
// prettier-ignore
import type { getConfig as File_Root_getConfig } from './pages/_root';
// prettier-ignore
import type { getConfig as File_BlogSlug_getConfig } from './pages/blog/[...slug]';
// prettier-ignore
import type { getConfig as File_BlogIndex_getConfig } from './pages/blog/index';
// prettier-ignore
import type { getConfig as File_Index_getConfig } from './pages/index';
// prettier-ignore
import type { getConfig as File_JaDocsSlug_getConfig } from './pages/ja/docs/[...slug]';
// prettier-ignore
import type { getConfig as File_JaDocsIndex_getConfig } from './pages/ja/docs/index';
// prettier-ignore
import type { getConfig as File_JaIndex_getConfig } from './pages/ja/index';

// prettier-ignore
type Page =
| ({ path: '/docs/[...slug]' } & GetConfigResponse<typeof File_DocsDocsSlug_getConfig>)
| ({ path: '/docs' } & GetConfigResponse<typeof File_DocsDocsIndex_getConfig>)
| ({ path: '/playground' } & GetConfigResponse<typeof File_DocsPlaygroundIndex_getConfig>)
| ({ path: '/playground/migrate' } & GetConfigResponse<typeof File_DocsPlaygroundMigrate_getConfig>)
| ({ path: '/404' } & GetConfigResponse<typeof File_404_getConfig>)
| ({ path: '/_api/ogp/[...slug]' } & GetConfigResponse<typeof File_ApiOgpSlug_getConfig>)
| ({ path: '/_root' } & GetConfigResponse<typeof File_Root_getConfig>)
| ({ path: '/blog/[...slug]' } & GetConfigResponse<typeof File_BlogSlug_getConfig>)
| ({ path: '/blog' } & GetConfigResponse<typeof File_BlogIndex_getConfig>)
| ({ path: '/' } & GetConfigResponse<typeof File_Index_getConfig>)
| ({ path: '/ja/docs/[...slug]' } & GetConfigResponse<typeof File_JaDocsSlug_getConfig>)
| ({ path: '/ja/docs' } & GetConfigResponse<typeof File_JaDocsIndex_getConfig>)
| ({ path: '/ja' } & GetConfigResponse<typeof File_JaIndex_getConfig>);

// prettier-ignore
type Layout =
| { path: '/' }
| { path: '/blog' }
| { path: '/ja/docs' };

// prettier-ignore
declare module 'waku/router' {
  interface RouteConfig {
    paths: PathsForPages<Page>;
  }
  interface CreatePagesConfig {
    pages: Page;
    layouts: Layout;
  }
  interface SearchCodecsConfig extends SearchCodecsForPages<Page> {}
}
