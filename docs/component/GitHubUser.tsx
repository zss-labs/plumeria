import * as css from '@plumeria/core';
import { theme } from 'lib/theme';

const styles = css.create({
  container: {
    position: 'relative',
    display: 'inline-flex',
    gap: 16,
    alignItems: 'center',
    padding: '8px 24px 8px 10px',
    overflow: 'hidden',
    textDecoration: 'none',
    cursor: 'pointer',
    borderRadius: 48,
  },
  avatarContainer: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 48,
    height: 48,
  },
  avatar: {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    borderRadius: '50%',
  },
  info: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    justifyContent: 'center',
  },
  name: {
    fontSize: 16,
    fontWeight: 600,
    lineHeight: 1.1,
    color: theme.textPrimary,
    letterSpacing: '-0.02em',
  },
  company: {
    fontSize: 14,
    fontWeight: 400,
    lineHeight: 1.2,
    color: theme.textSecondary,
    opacity: 0.8,
  },
});

interface GitHubUserProps {
  username: string;
  subtext: string;
}

export const GitHubUser = ({ username, subtext }: GitHubUserProps) => (
  <a
    href={`https://github.com/${username}`}
    target="_blank"
    rel="noopener noreferrer"
    classStyle={styles.container}
    id={`github-user-${username}`}
  >
    <div classStyle={styles.avatarContainer}>
      <img src={`https://github.com/${username}.png`} alt={username} classStyle={styles.avatar} />
    </div>
    <div classStyle={styles.info}>
      <span classStyle={styles.name}>{username}</span>
      <span classStyle={styles.company}>{subtext}</span>
    </div>
  </a>
);
