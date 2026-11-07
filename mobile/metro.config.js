// https://docs.expo.dev/guides/customizing-metro/
const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');

const config = getDefaultConfig(__dirname);

// Browser preview only: `expo-secure-store` has no web implementation, so on the web
// platform it is replaced by an in-memory, development-only stand-in
// (src/dev/webSecureStore.ts). iOS and Android resolve the real module, untouched.
const webSecureStore = path.resolve(__dirname, 'src/dev/webSecureStore.ts');
const resolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (platform === 'web' && moduleName === 'expo-secure-store') {
    return { type: 'sourceFile', filePath: webSecureStore };
  }
  return (resolveRequest ?? context.resolveRequest)(context, moduleName, platform);
};

module.exports = config;
