export type Source = 'css-modules' | 'emotion' | 'styled-components' | 'stylex' | 'tailwindcss' | 'vanilla-extract';

const card = `export function Card() {
  return (
    <article className={styles.card}>
      <h2 className={styles.title}>Card</h2>
    </article>
  );
}
`;

export const SAMPLES: Record<Source, Record<string, string>> = {
  'styled-components': {
    'src/Card.tsx': `import { Article, Title } from './Card.styles';

export function Card() {
  return (
    <Article>
      <Title>Card</Title>
    </Article>
  );
}
`,
    'src/Card.styles.ts': `import styled from 'styled-components';

export const Article = styled.article\`
  padding: 16px;
  border-radius: 12px;
  color: #2f3527;
  background: #e6ead9;
  &:hover {
    background: #dbe1ca;
  }
\`;

export const Title = styled.h2\`
  margin: 0;
  font-size: 18px;
  font-weight: 600;
\`;
`,
  },
  emotion: {
    'src/Card.tsx': `/** @jsxImportSource @emotion/react */
import { card, title } from './Card.styles';

export function Card() {
  return (
    <article css={card}>
      <h2 css={title}>Card</h2>
    </article>
  );
}
`,
    'src/Card.styles.ts': `import { css } from '@emotion/react';

export const card = css\`
  padding: 16px;
  border-radius: 12px;
  color: #2f3527;
  background: #e6ead9;

  &:hover {
    background: #dbe1ca;
  }
\`;

export const title = css\`
  margin: 0;
  font-size: 18px;
  font-weight: 600;
\`;
`,
  },
  'css-modules': {
    'src/Card.tsx': `import styles from './Card.module.css';

${card}`,
    'src/Card.module.css': `.card {
  padding: 16px;
  border-radius: 12px;
  color: #2f3527;
  background: #e6ead9;
}

.card:hover {
  background: #dbe1ca;
}

.title {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
}
`,
  },
  tailwindcss: {
    'src/Card.tsx': `export function Card() {
  return (
    <article className="rounded-xl bg-[#e6ead9] p-4 text-[#2f3527] hover:bg-[#dbe1ca]">
      <h2 className="m-0 text-lg font-semibold">Card</h2>
    </article>
  );
}
`,
  },
  'vanilla-extract': {
    'src/Card.tsx': `import { card, title } from './card.css';

export function Card() {
  return (
    <article className={card}>
      <h2 className={title}>Card</h2>
    </article>
  );
}
`,
    'src/card.css.ts': `import { style } from '@vanilla-extract/css';

export const card = style({
  padding: 16,
  borderRadius: 12,
  color: '#2f3527',
  background: '#e6ead9',
  ':hover': {
    background: '#dbe1ca',
  },
});

export const title = style({
  margin: 0,
  fontSize: 18,
  fontWeight: 600,
});
`,
  },
  stylex: {
    'src/Card.tsx': `import { styles } from './Card.styles';

export function Card() {
  return (
    <article sx={styles.card}>
      <h2 sx={styles.title}>Card</h2>
    </article>
  );
}
`,
    'src/Card.styles.ts': `import * as stylex from '@stylexjs/stylex';

export const styles = stylex.create({
  card: {
    padding: 16,
    borderRadius: 12,
    color: '#2f3527',
    backgroundColor: {
      default: '#e6ead9',
      ':hover': '#dbe1ca',
    },
  },
  title: {
    margin: 0,
    fontSize: 18,
    fontWeight: 600,
  },
});
`,
  },
};
