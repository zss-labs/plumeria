import { Seo } from 'component/Seo';
import { Playground } from '../../playground/playground';

export default function Page() {
  return (
    <>
      <Seo
        title="Playground"
        subtitle="Write Plumeria styles in the browser with full type information and every @plumeria/eslint-plugin rule."
        path="/playground"
      />
      <Playground />
    </>
  );
}

export const getConfig = async () => {
  return {
    render: 'static',
  } as const;
};
