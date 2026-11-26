import * as fs from 'fs';
import * as path from 'path';
import { RuleTester } from 'eslint';
import { noMixedStylingProps } from '../../src/rules/no-mixed-styling-props';

const DIR = fs.mkdtempSync(path.join(__dirname, 'fixture-'));
afterAll(() => fs.rmSync(DIR, { recursive: true, force: true }));

const write = (name: string, source: string) => {
  const filePath = path.join(DIR, name);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, source);
  return filePath;
};

write(
  'ui/Box.tsx',
  `import { styled } from '@plumeria/react';\nexport const Box = styled.div({ color: 'red' });\nconst Ghost = styled(Box)({ color: 'blue' });\nexport default Ghost;\n`,
);
write(
  'ui/Plain.tsx',
  `export const Plain = ({ sx, className }) => <div sx={sx} />;\n`,
);
write('ui/index.ts', `export * from './Box';\nexport * from './Plain';\n`);
const APP = write('app.tsx', '');

const ruleTester = new RuleTester({
  languageOptions: {
    parserOptions: {
      ecmaFeatures: {
        jsx: true,
      },
    },
  },
});

const STYLED = `import { styled } from '@plumeria/react';\nconst Box = styled.div({ color: 'red' });\nconst Ghost = styled(Box)({ color: 'blue' });\n`;

ruleTester.run('no-mixed-styling-props', noMixedStylingProps, {
  valid: [
    {
      code: '<div sx={styles.text} />',
    },
    {
      // once the prop is renamed, the old name is just an ordinary attribute
      code: '<div sx={styles.text} className="text" />',
      settings: { plumeria: { styleProp: 'classStyle' } },
    },
    {
      // renaming the prop to `style` must not make the rule flag it against itself
      code: '<div style={styles.text} />',
      settings: { plumeria: { styleProp: 'style' } },
    },
    {
      code: '<div className="text" />',
    },
    {
      code: '<div style={{ color: "red" }} />',
    },
    {
      code: '<div className="text" style={{ color: "red" }} />',
    },
    {
      code: '<div />',
    },
    {
      code: STYLED + 'export const A = () => <Box sx={styles.text} />;',
    },
    {
      code:
        "const styled = (tag) => (rule) => tag;\nconst Box = styled('div')({});\n" +
        'export const A = () => <Box className="text" />;',
    },
    {
      code:
        STYLED +
        'export const A = (Box) => <Box className="text" style={{ top: 1 }} />;',
    },
    {
      code: 'let Box; const { Card } = components;',
    },
  ],
  invalid: [
    {
      code: '<div sx={styles.text} className="text" />',
      errors: [{ messageId: 'noMixedStylingProps' }],
    },
    {
      code: '<div sx={styles.text} style={{ color: "red" }} />',
      errors: [{ messageId: 'noMixedStylingProps' }],
    },
    {
      code: '<div sx={styles.text} className="text" style={{ color: "red" }} />',
      errors: [
        { messageId: 'noMixedStylingProps' },
        { messageId: 'noMixedStylingProps' },
      ],
    },
    {
      // settings retarget every rule at once, without per-rule options
      code: '<div classStyle={styles.text} className="text" />',
      settings: { plumeria: { styleProp: 'classStyle' } },
      errors: [{ messageId: 'noMixedStylingProps' }],
    },
    {
      // a per-rule option wins over the shared setting
      code: '<div classStyle={styles.text} style={{ color: "red" }} />',
      settings: { plumeria: { styleProp: 'sx' } },
      options: [{ styleProp: 'classStyle' }],
      errors: [{ messageId: 'noMixedStylingProps' }],
    },
    {
      code:
        STYLED +
        'export const A = () => <Ghost className="text" style={{ top: 1 }} />;',
      errors: [
        {
          messageId: 'noStyledStylingProps',
          data: { name: 'Ghost', prop: 'sx', attr: 'className' },
        },
        {
          messageId: 'noStyledStylingProps',
          data: { name: 'Ghost', prop: 'sx', attr: 'style' },
        },
      ],
    },
    {
      code:
        "import { styled } from '@plumeria/react';\n" +
        'export const A = () => <Box className="text" />;\n' +
        "const Box = styled.div({ color: 'red' });",
      errors: [{ messageId: 'noStyledStylingProps' }],
    },
  ],
});

const moduleTester = new RuleTester({
  languageOptions: {
    sourceType: 'module',
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
});

moduleTester.run('no-mixed-styling-props across modules', noMixedStylingProps, {
  valid: [
    {
      code: `import { Plain } from './ui';\nexport const A = () => <Plain className="text" />;`,
      filename: APP,
    },
    {
      code: `import { Box } from './ui';\nexport const A = () => <Box sx={styles.text} />;`,
      filename: APP,
    },
    {
      code: `import { Missing } from './ui';\nexport const A = () => <Missing className="text" />;`,
      filename: APP,
    },
    {
      code: `import * as UI from './ui';\nexport const A = () => <UI className="text" />;`,
      filename: APP,
    },
    {
      code: `import { Missing } from './missing';\nexport const A = () => <Missing className="text" />;`,
      filename: APP,
    },
  ],
  invalid: [
    {
      code: `import { Box } from './ui/Box';\nexport const A = () => <Box className="text" />;`,
      filename: APP,
      errors: [
        {
          messageId: 'noStyledStylingProps',
          data: { name: 'Box', prop: 'sx', attr: 'className' },
        },
      ],
    },
    {
      code: `import { Box as Card } from './ui';\nexport const A = () => <Card style={{ top: 1 }} />;`,
      filename: APP,
      errors: [
        {
          messageId: 'noStyledStylingProps',
          data: { name: 'Card', prop: 'sx', attr: 'style' },
        },
      ],
    },
    {
      code: `import Ghost from './ui/Box';\nexport const A = () => <Ghost className="text" />;`,
      filename: APP,
      errors: [{ messageId: 'noStyledStylingProps' }],
    },
    {
      code: `import { Box, 'Box' as Card } from './ui/Box';\nexport const A = () => <><Box className="box" /><Card className="card" /></>;`,
      filename: APP,
      errors: [
        { messageId: 'noStyledStylingProps' },
        { messageId: 'noStyledStylingProps' },
      ],
    },
  ],
});
