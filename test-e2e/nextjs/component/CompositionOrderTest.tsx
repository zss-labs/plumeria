import '@plumeria/core';
import { branch } from 'component/composition-branch.styles';
import { buckets } from 'component/composition-buckets.styles';
import { cycle } from 'component/composition-cycle.styles';
import { disjoint } from 'component/composition-disjoint.styles';
import { triple } from 'component/composition-triple.styles';

// Each pair below is composed in both orders. A stylesheet has one declaration
// order to give them, so these are what the export has to reproduce.
export function CompositionOrderTest() {
  return (
    <div
      style={{ marginTop: '20px', border: '1px solid #ccc', padding: '10px' }}
    >
      <h3>Composition Order Test</h3>
      <div data-testid="cycle-surface-first" sx={[cycle.surface, cycle.raised]}>
        raised wins
      </div>
      <div data-testid="cycle-raised-first" sx={[cycle.raised, cycle.surface]}>
        surface wins
      </div>
      <span
        data-testid="disjoint-alpha-first"
        sx={[disjoint.alpha, disjoint.beta]}
      >
        nothing to disagree about
      </span>
      <span
        data-testid="disjoint-beta-first"
        sx={[disjoint.beta, disjoint.alpha]}
      >
        nothing to disagree about
      </span>
      <div data-testid="buckets-wide-first" sx={[buckets.wide, buckets.narrow]}>
        an at-rule outranks a base declaration either way
      </div>
      <div
        data-testid="buckets-narrow-first"
        sx={[buckets.narrow, buckets.wide]}
      >
        an at-rule outranks a base declaration either way
      </div>
      <div
        data-testid="triple-ascending"
        sx={[triple.one, triple.two, triple.three]}
      >
        three wins
      </div>
      <div
        data-testid="triple-descending"
        sx={[triple.three, triple.two, triple.one]}
      >
        one wins
      </div>
      <div data-testid="branch-ternary" sx={[branch.neutral, branch.danger]}>
        danger wins
      </div>
      <div data-testid="branch-inverted" sx={[branch.danger, branch.neutral]}>
        neutral wins
      </div>
    </div>
  );
}
