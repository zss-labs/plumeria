export const FULL_HASH_LENGTH = 14;
const FALLBACK_LENGTH = 7;

export const toFullHash = (hash: string): string =>
  'x' + hash.slice(1).padStart(FULL_HASH_LENGTH - 1, '0');

const isFullHash = (name: string): boolean =>
  name.length === FULL_HASH_LENGTH && /^x[0-9a-z]+$/.test(name);

export function shortName(
  name: string,
  table: Record<string, string> | undefined,
): string {
  if (!table) return name;
  const short = table[name];
  if (short !== undefined) return short;
  return isFullHash(name)
    ? 'x' + name.slice(FULL_HASH_LENGTH - FALLBACK_LENGTH)
    : name;
}
