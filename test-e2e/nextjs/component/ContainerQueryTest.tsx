import '@plumeria/core';
import { containerQuery } from 'component/container-query.styles';

export function ContainerQueryTest() {
  return (
    <div
      style={{ marginTop: '20px', border: '1px solid #ccc', padding: '10px' }}
    >
      <h3>Container Query Test</h3>
      <div sx={containerQuery.narrow}>
        <div data-testid="container-narrow-box" sx={containerQuery.box}>
          narrow container
        </div>
      </div>
      <div sx={containerQuery.wide}>
        <div data-testid="container-wide-box" sx={containerQuery.box}>
          wide container
        </div>
      </div>
    </div>
  );
}
