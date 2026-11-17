export const SHEET_ID = '/__plumeria_sheet__.zero.css';

export const isSheetId = (id: string): boolean =>
  id.split('?', 1)[0] === SHEET_ID;

export function withProjectSheet<T>(plugin: T): T {
  const target = plugin as any;
  target.__plumeriaInternal.setCssImport(
    () => `\nimport ${JSON.stringify(SHEET_ID)};`,
  );

  const load = target.load;
  target.load = function (this: unknown, id: string) {
    if (isSheetId(id)) return target.__plumeriaInternal.projectCss();
    return load.call(this, id);
  };
  return plugin;
}
