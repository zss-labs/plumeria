import DocPage from './[...slug]';

export default function Page() {
  return <DocPage />;
}

export const getConfig = async () => {
  return {
    render: 'static',
  } as const;
};
