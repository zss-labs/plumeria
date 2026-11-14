import { reactRouter } from '@react-router/dev/vite';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import tsconfigPaths from 'vite-tsconfig-paths';
import plumeria from '@plumeria/unplugin';

export default defineConfig({
  plugins: [tailwindcss(), reactRouter(), tsconfigPaths(), plumeria.vite()],
});
