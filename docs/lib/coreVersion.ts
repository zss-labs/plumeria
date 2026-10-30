import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const { version } = JSON.parse(readFileSync(join(process.cwd(), 'node_modules/@plumeria/core/package.json'), 'utf8'));

export const coreVersion: string = version.split('.').slice(0, 2).join('.');
