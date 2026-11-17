import { createRollupPlugin } from 'unplugin';
import { unpluginFactory, type PluginOptions } from './core';
import { withProjectSheet } from './sheet';

export default createRollupPlugin<PluginOptions | undefined>((options, meta) =>
  withProjectSheet(unpluginFactory(options, meta)),
);
