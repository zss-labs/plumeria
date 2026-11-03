'use client';

import { lazy, Suspense } from 'react';

// Loading it lazily keeps it out of the initial bundle of the routes that share
// the MDX module graph but never render it.
const HeadlessDemo = lazy(() => import('./HeadlessDemo').then((m) => ({ default: m.HeadlessDemo })));

export const HeadlessDemoLazy = () => (
  <Suspense>
    <HeadlessDemo />
  </Suspense>
);
