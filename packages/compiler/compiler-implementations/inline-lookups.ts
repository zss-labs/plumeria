const DECLARATION =
  /^var (__plumeria_lookup\d+); function \1_init\(\) \{ return \(\1 = (\{.*\})\); \}$/;

export const inlineLookups = (code: string): string => {
  const tables = new Map<string, string>();
  const kept = code.split('\n').filter((line) => {
    const match = DECLARATION.exec(line);
    if (match) tables.set(match[1], match[2]);
    return !match;
  });
  if (tables.size === 0) return code;
  return kept
    .join('\n')
    .replace(
      /\((__plumeria_lookup\d+) \?\? \1_init\(\)\)/g,
      (_, name: string) => tables.get(name) as string,
    );
};
