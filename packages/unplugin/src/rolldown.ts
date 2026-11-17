import { createRolldownPlugin } from 'unplugin';
import { unpluginFactory, type PluginOptions } from './core';
import { withProjectSheet } from './sheet';

export default createRolldownPlugin<PluginOptions | undefined>(
  (options, meta) => withProjectSheet(unpluginFactory(options, meta)),
);
