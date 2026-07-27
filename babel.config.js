/**
 * Babel configuration.
 *
 * `babel-preset-expo` (SDK 54+) automatically appends `react-native-worklets/plugin`
 * — the Reanimated 4 worklets transform — whenever `react-native-worklets` is installed.
 * It MUST stay last in the plugin list, which the preset guarantees. Do NOT add
 * `react-native-worklets/plugin` (or the legacy `react-native-reanimated/plugin`) manually:
 * that double-applies the transform and breaks the build.
 *
 * `react-native-gesture-handler` needs no Babel plugin. Its only requirements are met at
 * runtime: the `import 'react-native-gesture-handler'` side-effect in the entry (see
 * app/_layout.tsx) and wrapping the tree in <GestureHandlerRootView />.
 */
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
