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

const wasi = new WASI({
  version: 'preview1',
  args: ['plumeria-migrate', ...process.argv.slice(2)],
  env: {},
  preopens: { '.': process.cwd() },
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
