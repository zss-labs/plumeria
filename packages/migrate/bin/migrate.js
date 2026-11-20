#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const emitWarning = process.emitWarning;
process.emitWarning = (warning, ...rest) => {
  const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type;
  if (type === 'ExperimentalWarning' && String(warning).includes('WASI'))
    return;
  return emitWarning.call(process, warning, ...rest);
};
const { WASI } = require('node:wasi');

const cwd = process.cwd();
const args = process.argv.slice(2).map((arg) => {
  if (arg.startsWith('-') || !path.isAbsolute(arg)) return arg;
  const relative = path.relative(cwd, arg);
  if (relative.startsWith('..')) {
    console.error(`✖ ${arg} is outside the current directory.`);
    process.exit(1);
  }
  return relative || '.';
});

const wasi = new WASI({
  version: 'preview1',
  args: ['plumeria-migrate', ...args],
  env: {},
  preopens: { '.': cwd },
  returnOnExit: true,
});

const bytes = fs.readFileSync(
  path.join(__dirname, '..', 'dist', 'migrate.wasm'),
);
WebAssembly.instantiate(bytes, wasi.getImportObject()).then(
  ({ instance }) => {
    process.exitCode = wasi.start(instance);
  },
  (error) => {
    console.error(`✖ ${(error && error.message) || error}`);
    process.exitCode = 1;
  },
);
