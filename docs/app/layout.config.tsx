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
      text: 'Playground',
      url: '/playground',
      active: 'nested-url',
    },
    ...socialLinks,
  ],
};
