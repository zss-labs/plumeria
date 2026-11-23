import * as fs from 'fs';
import { desugar, REACT, styleProp } from './styled';

// Shared by scanning and extraction: invalidating an importer need not reread it.
const sources = new Map<
  string,
  { stamp: string; source: string; styled: boolean }
>();
const LIMIT = 4096;

export function sourceStamp(file: string): string {
  const stat = fs.statSync(file);
  return `${stat.mtimeMs}:${stat.ctimeMs}:${stat.size}`;
}

function load(file: string): { source: string; styled: boolean } {
  let stamp: string;
  try {
    stamp = sourceStamp(file);
  } catch (error) {
    sources.delete(file);
    throw error;
  }
  const cached = sources.get(file);
  if (cached?.stamp === stamp) return cached;
  const source = fs.readFileSync(file, 'utf8');
  if (sources.size >= LIMIT) sources.delete(sources.keys().next().value!);
  const entry = { stamp, source, styled: source.includes(REACT) };
  sources.set(file, entry);
  return entry;
}

export function readRawSource(file: string): string {
  return load(file).source;
}

export function readSource(file: string): string {
  const { source, styled } = load(file);
  if (!styled) return source;
  return desugar(source, file, styleProp()) ?? source;
}
