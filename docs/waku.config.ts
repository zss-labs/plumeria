import babel from '@rolldown/plugin-babel';
import plumeria from '@plumeria/unplugin';
import react, { reactCompilerPreset } from '@vitejs/plugin-react';
import mdx from 'fumadocs-mdx/vite';
import { defineConfig, type VitePlugin } from 'waku/config';
import { applyRewrites, headersFor } from './scripts/vercel-routes.mjs';
import * as MdxConfig from './source.config';

// Applies the routing rules of vercel.json to the dev server.
const vercelRoutes = (): VitePlugin => ({
  name: 'docs:vercel-routes',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      const { pathname, search } = new URL(req.url ?? '/', 'http://localhost');
      const rewritten = applyRewrites(pathname);
      for (const [key, value] of Object.entries(headersFor(rewritten))) res.setHeader(key, value);
      req.url = rewritten + search;
      // Waku reads the request URL from here in dev.
      (req as { originalUrl?: string }).originalUrl = req.url;
      next();
    });
  },
});

// Server components run without React's memo cache, so only compile the client graph.
const reactCompiler = async (): Promise<VitePlugin> => ({
  ...((await babel({ presets: [reactCompilerPreset()] })) as VitePlugin),
  applyToEnvironment: (environment) => environment.name !== 'rsc',
});

export default defineConfig({
  // Every route is static. Without this, Waku switches to its Vercel adapter on Vercel.
  unstable_adapter: 'waku/adapters/node',
  vite: {
    resolve: {
      tsconfigPaths: true,
      dedupe: ['react', 'react-dom', 'waku'],
    },
    // Loads its fonts and wasm relative to its own files at runtime.
    environments: { rsc: { resolve: { external: ['@vercel/og'] } } },
    plugins: [
      react(),
      reactCompiler(),
      plumeria.vite({ withoutLogicalProperties: true, exclude: /\.mdx?(\?|$)/ }),
      mdx(MdxConfig),
      vercelRoutes(),
    ],
  },
});
