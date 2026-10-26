import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';
import Image from 'next/image';
import * as css from '@plumeria/core';

import { socialLinks } from 'lib/socialLinks';

const styles = css.create({
  image: {
    position: 'relative',
    display: 'flex',
    flexDirection: 'row',
    gap: 5,
    alignItems: 'center',
    fontSize: 15,
    fontWeight: 650,
    letterSpacing: '-0.03em',
  },
  mark: {
    display: 'flex',
    marginTop: -2,
  },
  external: {
    display: 'inline-flex',
    gap: 4,
    alignItems: 'center',
  },
});

export const logo = (
  <span classStyle={styles.image}>
    <span classStyle={styles.mark}>
      <Image src="/logo.svg" alt="" width={20} height={20} preload />
    </span>
    Plumeria
  </span>
);

export const baseOptions: BaseLayoutProps = {
  nav: {
    transparentMode: 'top',
    title: logo,
  },

  links: [
    {
      text: 'Docs',
      url: '/docs',
      active: 'nested-url',
    },
    {
      text: 'Blog',
      url: '/blog',
      active: 'nested-url',
    },
    {
      text: 'Playground',
      url: '/playground',
      active: 'nested-url',
    },
    {
      text: (
        <span classStyle={styles.external}>
          Benchmark
          <svg
            width="13"
            height="13"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
          >
            <path d="M11 5H4v15h15v-7" />
            <path d="M14 3h7v7M21 3 11 13" />
          </svg>
        </span>
      ),
      icon: false,
      url: 'https://refirst11.github.io/css-compiler-bench/',
      external: true,
    },
    ...socialLinks,
  ],
};
