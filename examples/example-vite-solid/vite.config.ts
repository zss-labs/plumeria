import { defineConfig } from 'vite';
import solid from '@solidjs/vite-plugin';
import plumeria from '@plumeria/unplugin';

export default defineConfig({
  plugins: [solid(), plumeria.vite()],
});
