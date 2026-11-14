/**
 * Expo config. app.json stays the base (the tests and tooling read it); this adds the
 * native pieces for Google / Apple sign-in ONLY when the build is told to, so a build made
 * without them is the same app as before and signs in with email.
 *
 * Build-time switches (set in the EAS build profile's "env", or in the shell for a local
 * prebuild). None is a secret: an iOS OAuth client id and the URL scheme derived from it
 * ship inside every app that uses them, and the server's secrets are never in the app.
 *
 *   AURES_APPLE_SIGN_IN=1
 *     Adds the expo-apple-authentication plugin and the "Sign in with Apple" entitlement.
 *     The App ID in the Apple Developer account must have that capability, or signing the
 *     build fails; that is why it is opt-in.
 *
 *   AURES_GOOGLE_IOS_URL_SCHEME=com.googleusercontent.apps.<iOS client id digits-and-hash>
 *     The iOS OAuth client's REVERSED client id. Adds the Google Sign-In plugin, which
 *     registers it as a URL scheme so Google can return to the app. Google sign-in needs a
 *     development or TestFlight build; it does not run in Expo Go.
 */
module.exports = ({ config }) => {
  const plugins = [...(config.plugins ?? [])];
  const ios = { ...(config.ios ?? {}) };

  if (process.env.AURES_APPLE_SIGN_IN === "1") {
    plugins.push("expo-apple-authentication");
    ios.usesAppleSignIn = true;
  }

  const googleScheme = (process.env.AURES_GOOGLE_IOS_URL_SCHEME ?? "").trim();
  if (googleScheme) {
    // The plugin itself refuses a value that does not start with com.googleusercontent.apps.
    plugins.push(["@react-native-google-signin/google-signin", { iosUrlScheme: googleScheme }]);
  }

  return { ...config, ios, plugins };
};
