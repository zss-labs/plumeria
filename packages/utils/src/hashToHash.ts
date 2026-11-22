import type { CSSProperties } from 'zss-engine';
import { collectStyleRecords } from './create';
import { shortName } from './hashName';
import type { CreateObjectTable, CSSObject, TableEntry } from './types';

const MIN_LENGTH = 5;

export interface StyleSource {
  names: readonly string[];
  files: Iterable<string>;
}

const styleNames = (style: CSSProperties): string[] =>
  collectStyleRecords(style).flatMap((record) => record.hash.split(' '));

export function refreshNameCache(
  createObjectTable: CreateObjectTable,
  cache: Map<string, string[]>,
): void {
  for (const objectHash of cache.keys())
    if (!(objectHash in createObjectTable)) cache.delete(objectHash);
  for (const [objectHash, obj] of Object.entries(createObjectTable)) {
    if (cache.has(objectHash)) continue;
    cache.set(
      objectHash,
      Object.values(obj).flatMap((style) => styleNames(style as CSSProperties)),
    );
  }
}

export function createSources(
  cache: Map<string, string[]>,
  owners: (objectHash: string) => Iterable<string>,
): StyleSource[] {
  const sources: StyleSource[] = [];
  for (const [objectHash, names] of cache)
    sources.push({ names, files: [...owners(objectHash)] });
  return sources;
}

export function propsSources(
  componentPropsTable: Record<string, Record<string, TableEntry[]>>,
): StyleSource[] {
  const sources: StyleSource[] = [];
  for (const props of Object.values(componentPropsTable))
    for (const entries of Object.values(props))
      for (const entry of entries)
        sources.push({
          names: styleNames(entry.styleObj as CSSProperties),
          files: [entry.filePath],
        });
  return sources;
}

export function elementSources(
  elementStyles: Map<string, CSSObject[]>,
): StyleSource[] {
  const sources: StyleSource[] = [];
  for (const [file, styles] of elementStyles)
    for (const style of styles)
      sources.push({
        names: styleNames(style as CSSProperties),
        files: [file],
      });
  return sources;
}

export function filesUsing(
  sources: StyleSource[],
  hashes: Set<string>,
): Set<string> {
  const files = new Set<string>();
  for (const source of sources)
    if (source.names.some((name) => hashes.has(name)))
      for (const file of source.files) files.add(file);
  return files;
}

export function buildHashToHashTable(
  sources: StyleSource[],
): Record<string, string> {
  const hashes = new Set<string>();
  for (const source of sources)
    for (const name of source.names) hashes.add(name);

  const table: Record<string, string> = {};
  let maxLength = 0;
  for (const hash of hashes)
    if (hash.length - 1 > maxLength) maxLength = hash.length - 1;
  let pending = [...hashes];
  for (let k = MIN_LENGTH; k < maxLength && pending.length > 0; k++) {
    const counts = new Map<string, number>();
    for (const hash of hashes) {
      if (hash.length - 1 < k) continue;
      const suffix = hash.slice(-k);
      counts.set(suffix, (counts.get(suffix) ?? 0) + 1);
    }
    pending = pending.filter((hash) => {
      if (hash.length - 1 <= k) return true;
      const suffix = hash.slice(-k);
      if (counts.get(suffix) !== 1) return true;
      table[hash] = 'x' + suffix;
      return false;
    });
  }
  for (const hash of pending) table[hash] = hash;
  return table;
}

export function shortenAtomMap(
  atomMap: Record<string, string>,
  table: Record<string, string> | undefined,
): Record<string, string> {
  if (!table) return atomMap;
  const result: Record<string, string> = {};
  for (const [key, classNames] of Object.entries(atomMap))
    result[key] = classNames
      .split(' ')
      .map((name) => shortName(name, table))
      .join(' ');
  return result;
}
