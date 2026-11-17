import { SHEET_ID, isSheetId, withProjectSheet } from '../src/sheet';

it('identifies the shared stylesheet with or without a query', () => {
  expect(isSheetId(SHEET_ID)).toBe(true);
  expect(isSheetId(`${SHEET_ID}?direct`)).toBe(true);
  expect(isSheetId('/Card.zero.css')).toBe(false);
});

it('serves the whole project as the shared stylesheet', () => {
  const load = jest.fn(() => 'core css');
  const internal = {
    setCssImport: jest.fn(),
    projectCss: jest.fn(() => '.project{}'),
  };
  const plugin = withProjectSheet({
    __plumeriaInternal: internal,
    load,
  }) as any;
  const [cssImport] = internal.setCssImport.mock.calls[0];

  expect(cssImport()).toBe(`\nimport "${SHEET_ID}";`);
  expect(internal.projectCss).not.toHaveBeenCalled();
  expect(plugin.load(`${SHEET_ID}?used`)).toBe('.project{}');
  expect(load).not.toHaveBeenCalled();
  expect(plugin.load('/Card.zero.css')).toBe('core css');
  expect(load).toHaveBeenCalledWith('/Card.zero.css');
});
