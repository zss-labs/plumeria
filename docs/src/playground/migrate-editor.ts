import * as monaco from 'monaco-editor/editor';
import { DARK_THEME, LIGHT_THEME, setupEnvironment, setupHighlighting } from './editor';

const OPTIONS: monaco.editor.IStandaloneEditorConstructionOptions = {
  automaticLayout: true,
  minimap: { enabled: false },
  stickyScroll: { enabled: false },
  lineNumbers: 'on',
  scrollBeyondLastLine: false,
  padding: { top: 16, bottom: 16 },
  renderValidationDecorations: 'off',
};

function language(path: string) {
  return path.endsWith('.css') ? 'css' : 'typescript';
}

function themeOf(dark: boolean) {
  return dark ? DARK_THEME : LIGHT_THEME;
}

export type MigrateEditor = {
  load: (files: Record<string, string>) => void;
  open: (path: string) => void;
  show: (path: string | undefined, text: string) => void;
  setTheme: (dark: boolean) => void;
  dispose: () => void;
};

export async function mount(
  input: HTMLElement,
  output: HTMLElement,
  dark: boolean,
  onChange: (path: string, text: string) => void,
): Promise<MigrateEditor> {
  setupEnvironment();
  await setupHighlighting();

  const narrow = window.matchMedia('(max-width: 768px)');
  const fontSize = () => (narrow.matches ? 10 : 12);
  const source = monaco.editor.create(input, { ...OPTIONS, fontSize: fontSize(), theme: themeOf(dark), model: null });
  const outputModel = monaco.editor.createModel('', 'typescript', monaco.Uri.parse('inmemory://migrate/output'));
  const result = monaco.editor.create(output, {
    ...OPTIONS,
    fontSize: fontSize(),
    theme: themeOf(dark),
    model: outputModel,
    readOnly: true,
    domReadOnly: true,
  });
  const resize = () => {
    source.updateOptions({ fontSize: fontSize() });
    result.updateOptions({ fontSize: fontSize() });
  };
  narrow.addEventListener('change', resize);
  let models = new Map<string, monaco.editor.ITextModel>();
  let subscriptions: monaco.IDisposable[] = [];

  function release() {
    source.setModel(null);
    for (const subscription of subscriptions) subscription.dispose();
    for (const model of models.values()) model.dispose();
    subscriptions = [];
    models = new Map();
  }

  return {
    load(files) {
      release();
      for (const [path, text] of Object.entries(files)) {
        const uri = monaco.Uri.parse(`inmemory://migrate/source/${path}`);
        const model = monaco.editor.createModel(text, language(path), uri);
        subscriptions.push(model.onDidChangeContent(() => onChange(path, model.getValue())));
        models.set(path, model);
      }
    },
    open(path) {
      const model = models.get(path);
      if (model && source.getModel() !== model) source.setModel(model);
    },
    show(path, text) {
      if (path) monaco.editor.setModelLanguage(outputModel, language(path));
      if (outputModel.getValue() !== text) outputModel.setValue(text);
    },
    setTheme(next) {
      monaco.editor.setTheme(themeOf(next));
    },
    dispose() {
      narrow.removeEventListener('change', resize);
      release();
      source.dispose();
      result.dispose();
      outputModel.dispose();
    },
  };
}
