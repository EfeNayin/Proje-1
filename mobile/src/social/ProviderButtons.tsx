/**
 * The Google and Apple buttons for the sign-in screen.
 *
 * Apple's is the system AppleAuthenticationButton (WHITE_OUTLINE, as its rules require).
 * Google's is drawn here to match it: the Google SDK's own button is a fixed
 * raised drawable that cannot be sized or flattened to sit beside Apple's, and Google's
 * branding guidelines allow a custom button when it keeps their light theme: white fill,
 * 1 px #747775 stroke, #1F1F1F label "Sign in with Google" at 14/20 medium, and the
 * unmodified multicolor G (assets/images/google-g.png, Google's own file, scaled with its
 * aspect ratio kept) with the iOS padding of 16 / 12 / 16. No shadow. The label is set in
 * Google Sans Medium (assets/fonts/google-sans, OFL, see SOURCE.txt there) and only the
 * label: until the font registers, or if it never does, it is the system font at weight 500
 * and the button works the same.
 *
 * The two buttons have the same height, corner radius and width (the login column's full
 * width, the same as the email button), one above the other, Apple first as App Review
 * prefers, so neither is hidden or made smaller. Native modules load lazily and a button
 * renders nothing when its provider is not offered or its module is not in this build.
 *
 * A button appears only for a provider in `offered` (iOS, module present, and the server has
 * it configured and enabled), see providerSignIn.resolveOfferedProviders.
 */

import { useFonts } from "expo-font";
import { Image, Platform, Pressable, StyleSheet, Text, View } from "react-native";

import type { SocialProvider } from "../api/social";
import type { OfferedProviders } from "./providerSignIn";

export const BUTTON_HEIGHT = 52;
export const BUTTON_RADIUS = 14;

// Google's G is 200 x 204; it is drawn 20 high (Google's iOS button size) at that ratio.
const G_HEIGHT = 20;
const G_WIDTH = (G_HEIGHT * 200) / 204;

// Registered name of the bundled Google Sans Medium (its PostScript name), loaded the way
// romanTheme.ts loads its fonts: from the bundle, nothing fetched at runtime.
export const GOOGLE_SANS_MEDIUM = "GoogleSans-Medium";
const googleSansFiles = {
  [GOOGLE_SANS_MEDIUM]: require("../../assets/fonts/google-sans/GoogleSans-Medium.ttf"),
};

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

// Only asked whether it is there: signing in needs the module, the button no longer draws with it.
function google(): GoogleModule | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports -- lazy: the module may be absent from this build
    return require("@react-native-google-signin/google-signin") as GoogleModule;
  } catch {
    return null;
  }
}

export function GoogleButton({ disabled, onPress }: { disabled: boolean; onPress: () => void }) {
  // Loaded is false while loading and after a failure, which leaves the system font.
  const [fontLoaded] = useFonts(googleSansFiles);
  return (
    <Pressable
      testID="login-google"
      accessibilityRole="button"
      accessibilityLabel="Sign in with Google"
      accessibilityState={{ disabled }}
      disabled={disabled}
      onPress={onPress}
      style={({ pressed }) => [styles.google, pressed && styles.googlePressed]}
    >
      <Image
        source={require("../../assets/images/google-g.png")}
        style={styles.googleLogo}
        accessible={false}
      />
      <Text style={[styles.googleText, fontLoaded && styles.googleTextFace]} allowFontScaling={false}>
        Sign in with Google
      </Text>
    </Pressable>
  );
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
  const showGoogle = offered.google && google() !== null;
  if (!appleModule && !showGoogle) return null;

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
            cornerRadius={BUTTON_RADIUS}
            onPress={() => onPress("apple")}
            style={styles.apple}
          />
        </View>
      ) : null}
      {showGoogle ? (
        <View style={[styles.slot, disabled && styles.slotDisabled]}>
          <GoogleButton disabled={disabled} onPress={() => onPress("google")} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { gap: 12 },
  slot: { alignSelf: "stretch" },
  slotDisabled: { opacity: 0.5 },
  apple: { width: "100%", height: BUTTON_HEIGHT },
  google: {
    width: "100%",
    height: BUTTON_HEIGHT,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 16,
    backgroundColor: "#FFFFFF",
    borderWidth: 1,
    borderColor: "#747775",
    borderRadius: BUTTON_RADIUS,
  },
  googlePressed: { backgroundColor: "#F2F2F2" },
  googleLogo: { width: G_WIDTH, height: G_HEIGHT, marginRight: 12 },
  googleText: { color: "#1F1F1F", fontSize: 14, lineHeight: 20, fontWeight: "500" },
  // The face carries its own weight; a fontWeight on top would ask iOS to synthesize one.
  googleTextFace: { fontFamily: GOOGLE_SANS_MEDIUM, fontWeight: "normal" },
});
