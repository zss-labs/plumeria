import 'fumadocs-ui/style.css';
import '../styles/global.css';
import { Analytics } from '@vercel/analytics/react';
import { SpeedInsights } from '@vercel/speed-insights/react';
import { Provider } from 'component/Provider';
import { SiteHeader } from 'component/SiteHeader';
import type { ReactNode } from 'react';

const heroHeightScript = `(()=>{var w=0,e=document.documentElement;function s(){if(innerWidth!==w){w=innerWidth;e.style.setProperty('--hero-height',innerHeight+'px')}}s();addEventListener('resize',s)})()`;

export default function Root({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <script dangerouslySetInnerHTML={{ __html: heroHeightScript }} />
        <link rel="icon" href="/favicon.ico" sizes="any" />
        <link rel="icon" href="/icon.svg" type="image/svg+xml" />
        <link rel="apple-touch-icon" href="/apple-icon.png" />
        <link rel="preload" href="/fonts/inter-latin.woff2" as="font" type="font/woff2" crossOrigin="" />
      </head>
      <body>
        <Provider>
          <SiteHeader />
          {children}
        </Provider>
        <Analytics mode="production" />
        <SpeedInsights />
      </body>
    </html>
  );
}

export const getConfig = async () => {
  return {
    render: 'static',
  } as const;
};
