/**
 * The Google and Apple buttons for the sign-in screen.
 *
 * Both are the providers' own native buttons (Apple's AppleAuthenticationButton, Google's
 * GoogleSigninButton, which draws Google's approved button), as their brand rules require,
 * at the same size, one above the other (Apple first, as App Review prefers), so neither is
 * hidden or made smaller. They are
 * loaded lazily and render nothing when a module is not in this build.
 *
 * A button appears only for a provider in `offered` (iOS, module present, and the server has
 * it configured and enabled), see providerSignIn.resolveOfferedProviders.
 */

import { Platform, StyleSheet, View } from "react-native";

import type { SocialProvider } from "../api/social";
import type { OfferedProviders } from "./providerSignIn";

const HEIGHT = 52;
const RADIUS = 14;

type AppleModule = typeof import("expo-apple-authentication");
type GoogleModule = typeof import("@react-native-google-signin/google-signin");

function apple(): AppleModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy: the module may be absent from this build
    return require("expo-apple-authentication") as AppleModule;
  } catch {
    return null;
  }
}

function google(): GoogleModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy: the module may be absent from this build
    return require("@react-native-google-signin/google-signin") as GoogleModule;
  } catch {
    return null;
  }
}

export function ProviderButtons({
  offered,
  disabled,
  onPress,
}: {
  offered: OfferedProviders;
  /** True while any sign-in attempt runs: taps do nothing and the buttons look inactive. */
  disabled: boolean;
  onPress: (provider: SocialProvider) => void;
}) {
  if (Platform.OS !== "ios") return null;
  const appleModule = offered.apple ? apple() : null;
  const googleModule = offered.google ? google() : null;
  if (!appleModule && !googleModule) return null;

  return (
    <View style={styles.stack}>
      {appleModule ? (
        // The Apple button has no disabled prop; a covering view swallows taps instead.
        <View style={[styles.slot, disabled && styles.slotDisabled]} pointerEvents={disabled ? "none" : "auto"}>
          <appleModule.AppleAuthenticationButton
            testID="login-apple"
            accessibilityLabel="Sign in with Apple"
            buttonType={appleModule.AppleAuthenticationButtonType.SIGN_IN}
            buttonStyle={appleModule.AppleAuthenticationButtonStyle.WHITE_OUTLINE}
            cornerRadius={RADIUS}
            onPress={() => onPress("apple")}
            style={styles.apple}
          />
        </View>
      ) : null}
      {googleModule ? (
        <View style={[styles.slot, disabled && styles.slotDisabled]}>
          <googleModule.GoogleSigninButton
            accessibilityLabel="Sign in with Google"
            testID="login-google"
            size={googleModule.GoogleSigninButton.Size.Wide}
            color={googleModule.GoogleSigninButton.Color.Light}
            disabled={disabled}
            onPress={() => onPress("google")}
            style={styles.google}
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  slot: { alignSelf: "stretch" },
  slotDisabled: { opacity: 0.5 },
  google: { width: "100%", height: HEIGHT },
  apple: { width: "100%", height: HEIGHT },
});
