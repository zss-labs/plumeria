const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const source = path.join(root, 'docs/content/docs/ai.md');
const skillDir = path.join(root, 'plugins/plumeria/skills/plumeria');

const FRONTMATTER = /^---\n[\s\S]*?\n---\n+/;

// Sections moved out of SKILL.md. Claude reads each file only when the task needs it.
const REFERENCES = {
  'Advanced APIs': {
    file: 'advanced-apis.md',
    when: '`css.marker()` / `css.extended()`, `css.createStatic()`, `css.createTheme()`, `css.keyframes()`, `css.viewTransitionClass()`, `css.varType()`, `css.positionTry()`',
  },
  'Styling Custom Components': {
    file: 'custom-components.md',
    when: 'a component that accepts or forwards a `Style` prop',
  },
  'Migrating from Tailwind CSS': {
    file: 'tailwind-migration.md',
    when: 'converting Tailwind classes, `tv()` or `twMerge()`',
  },
  Testing: {
    file: 'testing.md',
    when: 'writing or fixing tests for styled components',
  },
  'Toolchain Notes': {
    file: 'toolchain.md',
    when: 'setup, bundler or ESLint configuration, property order and formatting',
  },
};

const splitSections = (body) => {
  const sections = [{ heading: null, lines: [] }];
  let inFence = false;
  for (const line of body.split('\n')) {
    if (line.startsWith('```')) inFence = !inFence;
    if (!inFence && line.startsWith('## ')) {
      sections.push({ heading: line.slice(3).trim(), lines: [] });
    }
    sections[sections.length - 1].lines.push(line);
  }
  return sections;
};

const linkCrossReferences = (text) =>
  text.replace(/\((→|see) ([^)]+)\)/g, (_, lead, names) => {
    const linked = names
      .split(', ')
      .map((name) =>
        REFERENCES[name] ? `references/${REFERENCES[name].file}` : name,
      );
    return `(${lead} ${linked.join(', ')})`;
  });

const trimEnd = (text) => `${text.replace(/\n+$/, '')}\n`;

const buildSkill = (markdown) => {
  const body = markdown.replace(FRONTMATTER, '');
  const files = {};
  const core = [];
  const index = [];

  for (const section of splitSections(body)) {
    const text = linkCrossReferences(section.lines.join('\n'));
    const reference = REFERENCES[section.heading];
    if (reference) {
      files[`references/${reference.file}`] = trimEnd(text);
      index.push(`- \`references/${reference.file}\` — ${reference.when}.`);
    } else {
      core.push(text);
    }
  }

  const skill = [
    '---',
    'name: plumeria',
    'description: Write, review, and fix styles with Plumeria (@plumeria/core) — css.create, the sx prop, css.use, selector rules, and compiler setup for Next.js, Vite, and other bundlers. Use whenever a project depends on @plumeria/core or the task touches Plumeria styles.',
    '---',
    '',
    '<!-- Generated from docs/content/docs/ai.md by scripts/build-skill.js. Do not edit. -->',
    '',
    'Before changing bundler or framework configuration, read https://plumeria.dev/docs/installation.md and the matching integration guide.',
    '',
    trimEnd(core.join('\n')),
  ];
  if (index.length > 0) {
    skill.push(
      '## References',
      '',
      'Read the matching file before working on:',
      '',
      ...index,
      '',
    );
  }
  files['SKILL.md'] = skill.join('\n');
  return files;
};

if (require.main === module) {
  fs.rmSync(path.join(skillDir, 'references'), {
    recursive: true,
    force: true,
  });
  const files = buildSkill(fs.readFileSync(source, 'utf8'));
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(skillDir, name);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
  }
}

module.exports = { buildSkill };
