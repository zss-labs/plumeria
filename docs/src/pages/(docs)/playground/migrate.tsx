import { Seo } from 'component/Seo';
import { Migrate } from '../../../playground/migrate';

export default function Page() {
  return (
    <>
      <Seo
        title="Migrate"
        subtitle="Rewrite styled-components, Emotion, CSS Modules, Tailwind CSS, vanilla-extract or StyleX code as Plumeria in the browser."
        path="/playground/migrate"
      />
      <Migrate />
    </>
  );
}

export const getConfig = async () => {
  return {
    render: 'static',
  } as const;
};
