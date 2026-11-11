# @plumeria/inspector

A development inspector for visualizing and debugging styled components in the browser.

## Documentation

Read the [documentation](https://plumeria.dev/docs/api/packages/inspector) for more details and a live demo.

## Installation

```bash
pnpm add -D @plumeria/inspector
```

## Usage

Render `Inspector` once at the root of the application.

```tsx
import { Inspector } from '@plumeria/inspector';

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {children}
        <Inspector />
      </body>
    </html>
  );
}
```

A production build strips it: the main entry resolves through the `production` export condition to a no-op module. To keep the inspector in a production build, for staging or a demo, import from the `@plumeria/inspector/production` subpath instead:

```tsx
import { Inspector } from '@plumeria/inspector/production';
```

## Props

| Prop | Type | Default | Description |
| --- | --- | --- | --- |
| `initial` | `boolean` | `false` | If `true`, the inspector starts toggled ON. If `false`, it starts toggled OFF. |

## Keyboard Shortcuts

| Shortcut | Action |
| --- | --- |
| `Cmd + I` / `Alt + I` | Toggle inspector |
| `Shift` | Lock / unlock target element |

