import { StyleSheet } from "react-native";

import { light } from "../lightTheme";

const MIN_TOUCH = 44;

/**
 * Styles shared by the sign-in and registration screens, so the two forms read
 * as one: sentence-case labels above white inputs, one black primary action
 * and an underlined text link to the other screen. System font throughout.
 */
export const authStyles = StyleSheet.create({
  root: { flex: 1, backgroundColor: light.background },
  flex: { flex: 1 },
  content: { flexGrow: 1, paddingHorizontal: 24 },
  title: {
    color: light.text,
    fontSize: 32,
    fontWeight: "700",
    lineHeight: 38,
    marginBottom: 28,
  },
  field: { marginBottom: 16 },
  label: {
    color: light.textSecondary,
    fontSize: 13,
    fontWeight: "600",
    lineHeight: 18,
    marginBottom: 6,
    marginLeft: 4,
  },
  optional: { fontWeight: "400" },
  input: {
    minHeight: 52,
    backgroundColor: light.surface,
    borderColor: light.separator,
    borderWidth: 1,
    borderRadius: 12,
    color: light.text,
    fontSize: 16,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  passwordInput: { paddingRight: 56 },
  eyeButton: {
    position: "absolute",
    top: 0,
    right: 0,
    bottom: 0,
    width: 52,
    minHeight: MIN_TOUCH,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 12,
  },
  errorRow: { flexDirection: "row", alignItems: "flex-start", gap: 8, marginBottom: 12 },
  errorText: { flex: 1, color: light.danger, fontSize: 14, lineHeight: 20 },
  button: {
    minHeight: 52,
    backgroundColor: light.primary,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    alignItems: "center",
    justifyContent: "center",
    marginTop: 8,
  },
  buttonPressed: { backgroundColor: light.primaryPressed },
  buttonBusy: { opacity: 0.6 },
  buttonText: { color: light.onPrimary, fontSize: 16, fontWeight: "600" },
  footer: {
    flexDirection: "row",
    flexWrap: "wrap",
    alignItems: "center",
    justifyContent: "center",
    columnGap: 4,
    marginTop: 16,
  },
  footerText: { color: light.textSecondary, fontSize: 15, lineHeight: 20 },
  linkButton: { minHeight: MIN_TOUCH, justifyContent: "center", paddingHorizontal: 4 },
  link: {
    color: light.text,
    fontSize: 15,
    fontWeight: "600",
    textDecorationLine: "underline",
  },
});
