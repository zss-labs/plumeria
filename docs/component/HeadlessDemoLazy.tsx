'use client';

import { lazy } from 'react';

// Loading it lazily keeps it out of the initial bundle of the routes that share
// the MDX module graph but never render it.
export const HeadlessDemoLazy = lazy(() => import('./HeadlessDemo').then((m) => ({ default: m.HeadlessDemo })));
