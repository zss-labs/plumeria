const { buildSkill } = require('../build-skill');

test('replaces the docs frontmatter with the skill frontmatter', () => {
  const files = buildSkill('---\ntitle: AI.md\n---\n\n## Rules\n');
  const skill = files['SKILL.md'];
  expect(skill.startsWith('---\nname: plumeria\ndescription: ')).toBe(true);
  expect(skill).not.toContain('title: AI.md');
  expect(skill.endsWith('## Rules\n')).toBe(true);
  expect(Object.keys(files)).toEqual(['SKILL.md']);
});

test('moves reference sections into their own files and indexes them', () => {
  const files = buildSkill(
    [
      '## Rules',
      '',
      '- Forward styles. (→ Styling Custom Components)',
      '- Pair them (see Advanced APIs).',
      '',
      '## Advanced APIs',
      '',
      '```md',
      '## Not a heading',
      '```',
      '',
      '## Styling Custom Components',
      '',
      'Body.',
      '',
    ].join('\n'),
  );
  const skill = files['SKILL.md'];

  expect(skill).toContain('(→ references/custom-components.md)');
  expect(skill).toContain('(see references/advanced-apis.md)');
  expect(skill).not.toContain('## Advanced APIs');
  expect(skill).toContain('- `references/advanced-apis.md` — ');
  expect(skill).toContain('- `references/custom-components.md` — ');
  expect(files['references/advanced-apis.md']).toBe(
    '## Advanced APIs\n\n```md\n## Not a heading\n```\n',
  );
  expect(files['references/custom-components.md']).toBe(
    '## Styling Custom Components\n\nBody.\n',
  );
});
