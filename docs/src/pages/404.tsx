import { Link } from 'waku';
import { JSX } from 'react';
import * as css from '@plumeria/core';

const styles = css.create({
  container: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: 'calc(100vh - 56px)',
  },
});

const NotFound = (): JSX.Element => {
  return (
    <div classStyle={styles.container}>
      <h1>ClientSide Error status code 404 Request page is not found:</h1>
      <Link to="/">
        <u>Return to Top page</u>
      </Link>
    </div>
  );
};

export default NotFound;

export const getConfig = async () => {
  return {
    render: 'static',
  } as const;
};
