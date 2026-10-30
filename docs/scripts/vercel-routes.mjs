import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const vercel = JSON.parse(readFileSync(join(process.cwd(), '..', 'vercel.json'), 'utf8'));

const toRegExp = (source) =>
  new RegExp(
    `^${source
      .split('(.*)')
      .map((part) =>
        part
          .replace(/[.+?^${}|[\]\\]/g, '\\$&')
          .replace(/\/:(\w+)\*/g, '(?:/(?<$1>.*))?')
          .replace(/:(\w+)\*/g, '(?<$1>.*)')
          .replace(/:(\w+)/g, '(?<$1>[^/]+)'),
      )
      .join('(.*)')}$`,
  );

const rewrites = vercel.rewrites.map(({ source, destination }) => ({ pattern: toRegExp(source), destination }));
const headers = vercel.headers.map(({ source, headers }) => ({ pattern: toRegExp(source), headers }));

export const applyRewrites = (pathname) => {
  for (const { pattern, destination } of rewrites) {
    const match = pattern.exec(pathname);
    if (match) return destination.replace(/:(\w+)\*?/g, (_, name) => match.groups?.[name] ?? '');
  }
  return pathname;
};

export const headersFor = (pathname) =>
  Object.fromEntries(
    headers
      .filter(({ pattern }) => pattern.test(pathname))
      .flatMap(({ headers }) => headers.map(({ key, value }) => [key, value])),
  );
