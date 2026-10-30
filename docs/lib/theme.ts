import * as css from '@plumeria/core';

export const theme = css.createTheme('.dark', {
  plumeAccent: {
    default: '#63a6bb',
    theme: '#5dcac8',
  },
  cardBg: {
    default: 'rgba(255, 255, 255, 0.5)',
    theme: 'rgba(24, 24, 27, 0.5)',
  },
  dropdownBg: {
    default: '#ffffff',
    theme: '#18181b',
  },
  cardBorder: {
    default: 'rgba(100, 100, 100, 0.4)',
    theme: 'rgba(255, 255, 255, 0.12)',
  },
  cardShadow: {
    default: '0 8px 32px 0 rgba(0, 0, 0, 1), 0 2px 8px 0 rgba(0, 0, 0, 1)',
    theme: '0 8px 32px 0 rgba(0, 0, 0, 0.3), 0 2px 8px 0 rgba(0, 0, 0, 0.2)',
  },
  iconBg: {
    default: 'rgba(242, 242, 242, 1)',
    theme: 'rgba(255, 255, 255, 0.09)',
  },
  textPrimary: {
    default: '#0b0b0b',
    theme: '#f4f4f5',
  },
  textSecondary: {
    default: '#69676cff',
    theme: '#a09ea4ff',
  },
  textMuted: {
    default: '#71717a',
    theme: '#71717a',
  },
});

export const homeTheme = css.createTheme('.dark', {
  background: { default: '#fff', theme: '#000' },
  foreground: { default: '#0a0a0a', theme: '#ebebeb' },
  muted: { default: '#737373', theme: '#b3b3b3cc' },
  border: { default: '#cccccc80', theme: '#6663' },
  accent: { default: '#d1d1d180', theme: '#6868684d' },
  themeLightColor: { default: '#0a0a0a', theme: '#b3b3b3cc' },
  themeLightBg: { default: '#d1d1d180', theme: 'transparent' },
  themeDarkColor: { default: '#737373', theme: '#ebebeb' },
  themeDarkBg: { default: 'transparent', theme: '#6868684d' },
});
