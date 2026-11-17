import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { globFiles } from '../index';

const ROOT = fs.realpathSync(
  fs.mkdtempSync(path.join(os.tmpdir(), 'plumeria-glob-files-')),
);

const write = (file: string) => {
  fs.mkdirSync(path.dirname(path.join(ROOT, file)), { recursive: true });
  fs.writeFileSync(path.join(ROOT, file), '');
};

beforeAll(() => {
  write('src/App.tsx');
  write('src/util.ts');
  write('src/style.css');
  write('dist/App.js');
  write('node_modules/pkg/index.js');
});

afterAll(() => fs.rmSync(ROOT, { recursive: true, force: true }));

it('lists the matching files as sorted absolute paths', () => {
  expect(
    globFiles(
      ['**/*.{js,jsx,ts,tsx}'],
      ['**/node_modules/**', '**/dist/**'],
      ROOT,
    ),
  ).toEqual([path.join(ROOT, 'src/App.tsx'), path.join(ROOT, 'src/util.ts')]);
});
