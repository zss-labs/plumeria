'use client';

import { ThemeProvider } from 'next-themes';
import { lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { OPEN_SEARCH, openSearch } from 'lib/openSearch';

const SearchDialog = lazy(() => import('component/SearchDialog').then((m) => ({ default: m.SearchDialog })));

export const Provider = ({ children }: { children: ReactNode }) => {
  const [requested, setRequested] = useState(false);

  useEffect(() => {
    const request = () => setRequested(true);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        openSearch();
      }
    };
    window.addEventListener(OPEN_SEARCH, request);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener(OPEN_SEARCH, request);
      window.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      {children}
      {requested && (
        <Suspense>
          <SearchDialog />
        </Suspense>
      )}
    </ThemeProvider>
  );
};
