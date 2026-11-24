import { WASI } from '@tybys/wasm-util';
import { memfs } from '@napi-rs/wasm-runtime/fs';

export type MigrateRequest = { id: number; source: string; files: Record<string, string> };

export type MigrateResponse =
  | { id: number; code: number; stdout: string; stderr: string; files: Record<string, string> }
  | { id: number; error: string };

const MANIFEST = JSON.stringify({
  dependencies: { '@plumeria/core': '*', '@plumeria/react': '*', '@plumeria/unplugin': '*' },
});

let compiled: Promise<WebAssembly.Module> | undefined;

function compile() {
  compiled ??= WebAssembly.compileStreaming(fetch('/playground/migrate.wasm')).catch((error: unknown) => {
    compiled = undefined;
    throw error;
  });
  return compiled;
}

compile().catch(() => {});

async function run({ id, source, files }: MigrateRequest): Promise<MigrateResponse> {
  const wasm = await compile();
  const input: Record<string, string> = { '/package.json': MANIFEST };
  for (const [path, text] of Object.entries(files)) input[`/${path}`] = text;

  const { fs, vol } = memfs(input);
  let stdout = '';
  let stderr = '';
  const wasi = new WASI({
    version: 'preview1',
    args: ['plumeria-migrate', 'from', source],
    preopens: { '.': '/' },
    fs,
    returnOnExit: true,
    print: (text: string) => {
      stdout += `${text}\n`;
    },
    printErr: (text: string) => {
      stderr += `${text}\n`;
    },
  });
  const instance = await WebAssembly.instantiate(wasm, wasi.getImportObject());
  const code = (wasi.start(instance) as number | undefined) ?? 0;

  const output: Record<string, string> = {};
  for (const [path, text] of Object.entries(vol.toJSON())) {
    if (path === '/package.json' || typeof text !== 'string') continue;
    output[path.slice(1)] = text;
  }
  return { id, code, stdout, stderr, files: output };
}

self.onmessage = (event: MessageEvent<MigrateRequest>) => {
  run(event.data).then(
    (response) => self.postMessage(response),
    (error: unknown) => self.postMessage({ id: event.data.id, error: String(error) }),
  );
};
