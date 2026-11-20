'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import type { KeyboardEvent } from 'react';
import * as css from '@plumeria/core';
import { theme } from 'lib/theme';
import { breakpoints } from 'lib/mediaQuery';
import { SAMPLES } from './migrate-samples';
import type { Source } from './migrate-samples';
import type { MigrateRequest, MigrateResponse } from './migrate-worker';
import type { MigrateEditor } from './migrate-editor';

const SOURCES: Source[] = ['css-modules', 'vanilla-extract', 'emotion', 'styled-components', 'stylex', 'tailwindcss'];

const LABELS: Record<Source, string> = {
  'css-modules': 'CSS Modules',
  'vanilla-extract': 'vanilla-extract',
  emotion: 'Emotion',
  'styled-components': 'styled-components',
  stylex: 'StyleX',
  tailwindcss: 'Tailwind CSS',
};

const SECTIONS: Record<Source, string> = {
  'css-modules': 'css-modules',
  'vanilla-extract': 'vanilla-extract',
  emotion: 'emotion',
  'styled-components': 'styled-components',
  stylex: 'stylex',
  tailwindcss: 'tailwind-css',
};

function sourceFromSearch(search: string) {
  const from = new URLSearchParams(search).get('from');
  return SOURCES.find((source) => source === from);
}

function fileName(path: string) {
  return path.slice(path.lastIndexOf('/') + 1);
}

function isDark() {
  return document.documentElement.classList.contains('dark');
}

type Transpile = (path: string, text: string) => string;
type Result = { files: Record<string, string>; stdout: string; stderr: string; ok: boolean };

type Stage = 'pick' | 'convert' | 'done';

type View = 'source' | 'plumeria';

const blink = css.keyframes({
  from: {
    opacity: 1,
  },
  '50%': {
    opacity: 0,
  },
});

const FADE_OUT = 400;

function fadeText(host: HTMLElement | null, keyframes: Keyframe[], options: KeyframeAnimationOptions) {
  return [...(host?.querySelectorAll<HTMLElement>('.view-lines, .margin-view-overlays') ?? [])].map((element) =>
    element.animate(keyframes, options),
  );
}

const styles = css.create({
  root: {
    display: 'flex',
    flexDirection: 'column',
    gridColumn: '2 / -1',
    gap: 16,
    height: 'calc(100dvh - 56px)',
    padding: '16px 24px 24px',
    overflow: 'hidden',
    color: theme.textPrimary,
    [breakpoints.md]: {
      gap: 12,
      height: 'calc(100dvh - 104px)',
      padding: '12px',
    },
  },
  column: {
    display: 'flex',
    flex: 1,
    flexDirection: 'column',
    gap: 16,
    alignSelf: 'center',
    width: '100%',
    maxWidth: 680,
    minHeight: 0,
    [breakpoints.md]: {
      gap: 12,
    },
  },
  panes: {
    display: 'grid',
    flex: 1,
    gridTemplateRows: 'minmax(0, 1fr)',
    gridTemplateColumns: 'minmax(0, 1fr)',
    minHeight: 0,
  },
  frame: {
    flex: 'none',
    width: '100%',
    height: 96,
    background: 'transparent',
    borderColor: theme.cardBorder,
    borderStyle: 'solid',
    borderWidth: '1px',
    borderRadius: 12,
  },
  away: {
    display: 'none',
  },
  pane: {
    display: 'flex',
    flexDirection: 'column',
    gridArea: '1 / 1',
    minWidth: 0,
    minHeight: 0,
    overflow: 'hidden',
    borderColor: theme.cardBorder,
    borderStyle: 'solid',
    borderWidth: '1px',
    borderRadius: 12,
    transition: 'opacity 0.45s ease',
  },
  hidden: {
    pointerEvents: 'none',
    opacity: 0,
  },
  paneHead: {
    display: 'flex',
    gap: 4,
    alignItems: 'center',
    minHeight: 41,
    paddingInline: 8,
    overflowX: 'auto',
    scrollbarWidth: 'none',
    borderBottomColor: theme.cardBorder,
    borderBottomStyle: 'solid',
    borderBottomWidth: '1px',
  },
  tabs: {
    display: 'flex',
    flexShrink: 0,
    gap: 2,
  },
  file: {
    flexShrink: 0,
    padding: '6px 8px',
    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
    fontSize: 12,
    color: theme.textMuted,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    background: 'transparent',
    borderColor: 'currentColor',
    borderStyle: 'none',
    borderWidth: 'medium',
    borderRadius: 6,
    ':hover': {
      color: theme.textPrimary,
    },
    [breakpoints.md]: {
      padding: '6px',
      fontSize: 11,
    },
  },
  fileActive: {
    color: theme.textPrimary,
    background: theme.iconBg,
  },
  views: {
    display: 'flex',
    flexShrink: 0,
    gap: 4,
    marginLeft: 'auto',
  },
  view: {
    padding: '4px 8px',
    fontSize: 11,
    color: theme.textMuted,
    whiteSpace: 'nowrap',
    cursor: 'pointer',
    background: 'transparent',
    borderColor: 'currentColor',
    borderStyle: 'none',
    borderWidth: 'medium',
    ':hover': {
      color: theme.textPrimary,
    },
    ':disabled': {
      cursor: 'default',
    },
    [breakpoints.md]: {
      padding: '4px 6px',
    },
  },
  viewActive: {
    color: theme.textPrimary,
  },
  sourceActive: {
    color: theme.plumeAccent,
  },
  editor: {
    flex: 1,
    minHeight: 0,
  },
  terminal: {
    flex: 'none',
    height: '28%',
    padding: '12px 16px',
    overflow: 'auto',
    fontFamily: 'var(--font-mono, ui-monospace, monospace)',
    fontSize: 13,
    lineHeight: 1.7,
    color: theme.textSecondary,
    outline: 'none',
    background: theme.dropdownBg,
    borderColor: theme.cardBorder,
    borderStyle: 'solid',
    borderWidth: '1px',
    borderRadius: 12,
  },
  command: {
    color: theme.textPrimary,
    whiteSpace: 'pre-wrap',
  },
  prompt: {
    color: theme.textMuted,
  },
  token: {
    padding: 0,
    font: 'inherit',
    color: theme.plumeAccent,
    cursor: 'pointer',
    background: 'transparent',
    borderColor: 'currentColor',
    borderStyle: 'none',
    borderWidth: 'medium',
    ':hover': {
      textDecoration: 'underline',
    },
  },
  caret: {
    display: 'inline-block',
    width: '0.6em',
    height: '1.15em',
    verticalAlign: 'text-bottom',
    background: theme.textPrimary,
    animationName: blink,
    animationDuration: '1s',
    animationTimingFunction: 'step-end',
    animationIterationCount: 'infinite',
  },
  list: {
    padding: 0,
    margin: '4px 0 0',
    listStyle: 'none',
  },
  choice: {
    whiteSpace: 'pre',
    cursor: 'pointer',
  },
  chosen: {
    color: theme.plumeAccent,
  },
  log: {
    margin: '4px 0 0',
    font: 'inherit',
    whiteSpace: 'pre-wrap',
  },
  error: {
    color: '#b42318',
  },
  hold: {
    color: theme.plumeAccent,
    textDecoration: 'none',
    ':hover': {
      textDecoration: 'underline',
    },
  },
});

export function Migrate() {
  const [source, setSource] = useState<Source>();
  const [stage, setStage] = useState<Stage>('pick');
  const [view, setView] = useState<View>('source');
  const [picking, setPicking] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [files, setFiles] = useState<Record<string, string>>(SAMPLES[SOURCES[0]]);
  const [input, setInput] = useState(Object.keys(SAMPLES[SOURCES[0]])[0]);
  const [result, setResult] = useState<Result>();
  const [good, setGood] = useState<Result>();
  const [editor, setEditor] = useState<MigrateEditor>();
  const [transpiler, setTranspiler] = useState<Transpile>();
  const [framed, setFramed] = useState(false);
  const faded = useRef(0);
  const fading = useRef<Animation[]>([]);
  const frame = useRef<HTMLIFrameElement>(null);
  const worker = useRef<Worker | null>(null);
  const terminal = useRef<HTMLDivElement>(null);
  const inputHost = useRef<HTMLDivElement>(null);
  const outputHost = useRef<HTMLDivElement>(null);
  const latest = useRef(0);
  const running = stage === 'pick' ? undefined : source;
  const sample = running ?? SOURCES[cursor];

  useEffect(() => {
    const next = sourceFromSearch(location.search);
    if (next) {
      setSource(next);
      setStage('done');
      setView('plumeria');
      setFiles(SAMPLES[next]);
      setInput(Object.keys(SAMPLES[next])[0]);
    } else {
      setPicking(true);
    }

    const created = new Worker('/playground/migrate-worker.mjs', { type: 'module' });
    created.onmessage = (event: MessageEvent<MigrateResponse>) => {
      const response = event.data;
      if (response.id !== latest.current) return;
      if ('error' in response) {
        setResult({ files: {}, stdout: '', stderr: response.error, ok: false });
        return;
      }
      const next = {
        files: response.files,
        stdout: response.stdout.trimEnd(),
        stderr: response.stderr.trimEnd(),
        ok: response.code === 0 && !response.stderr.trim(),
      };
      setResult(next);
      if (next.ok) setGood(next);
    };
    worker.current = created;
    return () => {
      created.terminate();
      worker.current = null;
    };
  }, []);

  useEffect(() => {
    if (!running) return;
    const request: MigrateRequest = { id: ++latest.current, source: running, files };
    worker.current?.postMessage(request);
  }, [running, files]);

  useEffect(() => {
    if (picking) terminal.current?.focus();
  }, [picking]);

  useEffect(() => {
    if (stage !== 'convert' || !editor || !result) return;
    const timer = setTimeout(
      () => {
        setStage('done');
        setView('plumeria');
        const incoming = fadeText(
          outputHost.current,
          [
            { opacity: 0, transform: 'translateY(-6px)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 500, easing: 'ease-out' },
        );
        void Promise.all(incoming.map((animation) => animation.finished)).then(clearFade, clearFade);
      },
      Math.max(0, FADE_OUT - (performance.now() - faded.current)),
    );
    return () => clearTimeout(timer);
  }, [stage, editor, result]);

  useEffect(() => {
    if (!inputHost.current || !outputHost.current) return;
    const input = inputHost.current;
    const output = outputHost.current;
    let disposed = false;
    let mounted: MigrateEditor | undefined;
    const onChange = (path: string, text: string) => setFiles((current) => ({ ...current, [path]: text }));
    void import('./migrate-editor')
      .then(({ mount }) => mount(input, output, isDark(), onChange))
      .then((handle) => {
        if (disposed) return handle.dispose();
        mounted = handle;
        setEditor(handle);
      });
    const observer = new MutationObserver(() => mounted?.setTheme(isDark()));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      disposed = true;
      observer.disconnect();
      mounted?.dispose();
      setEditor(undefined);
    };
  }, []);

  useEffect(() => {
    editor?.load(SAMPLES[sample]);
  }, [editor, sample]);

  useEffect(() => {
    editor?.open(input);
  }, [editor, sample, input]);

  function preview(index: number) {
    setCursor(index);
    const paths = Object.keys(SAMPLES[SOURCES[index]]);
    setFiles(SAMPLES[SOURCES[index]]);
    setInput(paths[Object.keys(files).indexOf(input)] ?? paths[0]);
  }

  function point(index: number) {
    if (stage === 'pick') preview(index);
  }

  function clearFade() {
    for (const animation of fading.current) animation.cancel();
    fading.current = [];
  }

  function open() {
    clearFade();
    latest.current += 1;
    preview(Math.max(0, SOURCES.indexOf(source ?? SOURCES[0])));
    setStage('pick');
    setView('source');
    setPicking(true);
    setResult(undefined);
    setGood(undefined);
  }

  function choose(next: Source) {
    if (next !== SOURCES[cursor]) preview(SOURCES.indexOf(next));
    setPicking(false);
    clearFade();
    faded.current = performance.now();
    requestAnimationFrame(() => {
      fading.current = fadeText(
        inputHost.current,
        [
          { opacity: 1, transform: 'none' },
          { opacity: 0, transform: 'translateY(-6px)' },
        ],
        { duration: FADE_OUT, easing: 'ease-in', fill: 'forwards' },
      );
    });
    setStage('convert');
    setSource(next);
    setResult(undefined);
    setGood(undefined);
    history.replaceState(null, '', `?from=${next}`);
  }

  function show(next: View) {
    setView(next);
  }

  function onKeyDown(event: KeyboardEvent) {
    if (!picking) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      point((cursor + step + SOURCES.length) % SOURCES.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      choose(SOURCES[cursor]);
    }
  }

  const outputs = Object.keys(good?.files ?? {}).sort(
    (a, b) => Number(b.endsWith('.tsx')) - Number(a.endsWith('.tsx')) || a.localeCompare(b),
  );
  const paths = Object.keys(files);
  const shown = outputs.includes(input) ? input : (outputs[paths.indexOf(input)] ?? outputs[0]);
  const shownText = shown && good ? good.files[shown] : '';
  const ready = stage === 'done';

  useEffect(() => {
    editor?.show(shown, shownText);
  }, [editor, shown, shownText]);

  useEffect(() => {
    if (ready && !transpiler) {
      void import('sucrase').then(({ transform }) =>
        setTranspiler(
          () => (path: string, text: string) =>
            transform(text, {
              transforms: ['typescript', 'jsx'],
              jsxRuntime: 'automatic',
              production: true,
              filePath: path,
            }).code,
        ),
      );
    }
  }, [ready, transpiler]);

  useEffect(() => {
    const target = frame.current?.contentWindow;
    if (!target || !framed || !transpiler || !good) return;
    const files: Record<string, string> = {};
    for (const [path, text] of Object.entries(good.files)) {
      if (!/\.[jt]sx?$/.test(path)) continue;
      const key = `/${path.replace(/^src\//, '')}`;
      files[key] = transpiler(key, text);
    }
    const entry = Object.keys(files).find((key) => key.endsWith('.tsx'));
    if (entry) target.postMessage({ type: 'playground:render', files, sources: {}, entry }, '*');
  }, [framed, transpiler, good]);

  useEffect(() => {
    const send = () => frame.current?.contentWindow?.postMessage({ type: 'playground:theme', dark: isDark() }, '*');
    const onMessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.source !== frame.current?.contentWindow || event.data?.type !== 'playground:ready') return;
      send();
      setFramed(true);
    };
    window.addEventListener('message', onMessage);
    if (frame.current?.contentDocument?.readyState === 'complete') {
      send();
      setFramed(true);
    }
    const observer = new MutationObserver(send);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
    return () => {
      window.removeEventListener('message', onMessage);
      observer.disconnect();
    };
  }, []);

  const views = (
    <div sx={styles.views}>
      {(['source', 'plumeria'] as const).map((item) => (
        <button
          key={item}
          type="button"
          disabled={item === 'plumeria' && !ready}
          aria-pressed={view === item}
          onClick={() => show(item)}
          sx={[
            styles.view,
            view === item && styles.viewActive,
            view === item && item === 'source' && styles.sourceActive,
          ]}
        >
          {item === 'source' ? LABELS[sample] : 'Plumeria'}
        </button>
      ))}
    </div>
  );

  return (
    <div sx={styles.root}>
      <div sx={styles.column}>
        <div sx={styles.panes}>
          <section sx={[styles.pane, view !== 'source' && styles.hidden]} aria-label={LABELS[sample]}>
            <div sx={styles.paneHead}>
              <div role="tablist" sx={styles.tabs}>
                {Object.keys(files).map((path) => (
                  <button
                    key={path}
                    type="button"
                    role="tab"
                    aria-selected={input === path}
                    onClick={() => setInput(path)}
                    sx={[styles.file, input === path && styles.fileActive]}
                  >
                    {fileName(path)}
                  </button>
                ))}
              </div>
              {views}
            </div>
            <div ref={inputHost} sx={styles.editor} />
          </section>
          <section sx={[styles.pane, view !== 'plumeria' && styles.hidden]} aria-label="Plumeria">
            <div sx={styles.paneHead}>
              <div role="tablist" sx={styles.tabs}>
                {outputs.map((path, index) => (
                  <button
                    key={path}
                    type="button"
                    role="tab"
                    aria-selected={shown === path}
                    onClick={() => setInput(paths.includes(path) ? path : (paths[index] ?? paths[0]))}
                    sx={[styles.file, shown === path && styles.fileActive]}
                  >
                    {fileName(path)}
                  </button>
                ))}
              </div>
              {views}
            </div>
            <div ref={outputHost} sx={styles.editor} />
          </section>
        </div>
        <iframe
          ref={frame}
          sx={[styles.frame, !(ready && good) && styles.away]}
          src="/playground/preview"
          title="Preview"
          onLoad={() => {
            frame.current?.contentWindow?.postMessage({ type: 'playground:theme', dark: isDark() }, '*');
            setFramed(true);
          }}
        />
        <div
          ref={terminal}
          sx={styles.terminal}
          tabIndex={-1}
          onKeyDown={onKeyDown}
          role={picking ? 'listbox' : 'log'}
          aria-label="Terminal"
          aria-activedescendant={picking ? `migrate-source-${SOURCES[cursor]}` : undefined}
        >
          <div sx={styles.command}>
            <span sx={styles.prompt}>$ </span>
            npx @plumeria/migrate from{' '}
            {picking || !source ? (
              <span sx={styles.caret} />
            ) : (
              <button type="button" sx={styles.token} onClick={open}>
                {source}
              </button>
            )}
          </div>
          {picking ? (
            <ul sx={styles.list}>
              {SOURCES.map((item, index) => (
                <li
                  key={item}
                  id={`migrate-source-${item}`}
                  role="option"
                  aria-selected={index === cursor}
                  sx={[styles.choice, index === cursor && styles.chosen]}
                  onMouseEnter={() => point(index)}
                  onClick={() => choose(item)}
                >
                  {index === cursor ? '❯ ' : '  '}
                  {item}
                </li>
              ))}
            </ul>
          ) : (
            result && (
              <>
                {result.stdout && (
                  <pre sx={styles.log}>
                    {result.stdout.split('\n').map((line, index) => {
                      const hold = /^(\s+\d+:\d+\s+)([a-z-]+)(.*)$/.exec(line);
                      return (
                        <Fragment key={index}>
                          {index > 0 && '\n'}
                          {hold && source ? (
                            <>
                              {hold[1]}
                              <a
                                href={`/docs/api/migrate/other-libraries#${SECTIONS[source]}`}
                                target="_blank"
                                rel="noreferrer"
                                sx={styles.hold}
                              >
                                {hold[2]}
                              </a>
                              {hold[3]}
                            </>
                          ) : (
                            line
                          )}
                        </Fragment>
                      );
                    })}
                  </pre>
                )}
                {result.stderr && <pre sx={[styles.log, styles.error]}>{result.stderr}</pre>}
              </>
            )
          )}
        </div>
      </div>
    </div>
  );
}
