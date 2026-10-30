import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join } from 'node:path';
import { URL } from 'node:url';
import { applyRewrites, headersFor } from './vercel-routes.mjs';

const root = join(process.cwd(), 'dist', 'public');
const port = Number(process.env.PORT ?? 3000);

const types = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.xml': 'application/xml',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.ttf': 'font/ttf',
  '.wasm': 'application/wasm',
};

const resolveFile = (pathname) => {
  const candidates = [pathname, `${pathname}.html`, join(pathname, 'index.html')];
  for (const candidate of candidates) {
    const file = join(root, candidate);
    if (file.startsWith(root) && existsSync(file) && statSync(file).isFile()) return file;
  }
};

createServer((req, res) => {
  const pathname = applyRewrites(decodeURIComponent(new URL(req.url, 'http://localhost').pathname));
  const extra = headersFor(pathname);

  const file = resolveFile(pathname);
  const status = file ? 200 : 404;
  const body = file ?? join(root, '404.html');
  res.writeHead(status, { ...extra, 'Content-Type': types[extname(body)] ?? 'application/octet-stream' });
  createReadStream(body).pipe(res);
}).listen(port, () => {
  console.log(`Serving dist/public/ on http://localhost:${port}`);
});
