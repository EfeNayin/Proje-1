#!/usr/bin/env bash
# Creates (once) and boots the dedicated test simulator and installs the Expo Go
# build that matches this project's SDK. It never touches any other simulator.
set -euo pipefail
source "$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/lib.sh"
mkdir -p "$E2E_HOME"

SDK="$(node -p "require('$MOBILE_DIR/package.json').dependencies.expo.replace(/[^0-9.]/g,'').split('.')[0]")"
UDID="$(sim_udid)"

if [ -n "$UDID" ] && ! xcrun simctl list devices | grep -q "$UDID"; then UDID=""; fi
if [ -z "$UDID" ]; then
  RUNTIME="$(xcrun simctl list runtimes -j | python3 -c "
import json,sys
rt=[r for r in json.load(sys.stdin)['runtimes'] if r.get('isAvailable') and r['identifier'].startswith('com.apple.CoreSimulator.SimRuntime.iOS')]
print(rt[-1]['identifier'] if rt else '')")"
  [ -n "$RUNTIME" ] || die "no installed iOS simulator runtime (Xcode > Settings > Components)"
  DEVICE_TYPE="${E2E_DEVICE_TYPE:-$(xcrun simctl list devicetypes -j | python3 -c "
import json,sys
t=[d['identifier'] for d in json.load(sys.stdin)['devicetypes'] if 'iPhone' in d['identifier'] and 'Pro' in d['identifier'] and 'Max' not in d['identifier']]
print(t[-1] if t else '')")}"
  [ -n "$DEVICE_TYPE" ] || die "no iPhone device type found; set E2E_DEVICE_TYPE"
  UDID="$(xcrun simctl create "$SIM_NAME" "$DEVICE_TYPE" "$RUNTIME")"
  echo "$UDID" > "$E2E_HOME/sim-udid"
  echo "e2e: created simulator $SIM_NAME ($UDID) on $RUNTIME"
fi

xcrun simctl list devices | grep "$UDID" | grep -q Booted || xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1 || true

# The flows match English labels (including iOS's own "Open in Expo Go?" dialog),
# so pin the dedicated simulator to English, once; it only takes effect after a reboot.
if [ "$(xcrun simctl spawn "$UDID" defaults read -g AppleLocale 2>/dev/null || true)" != "en_US" ]; then
  xcrun simctl spawn "$UDID" defaults write -g AppleLanguages -array en
  xcrun simctl spawn "$UDID" defaults write -g AppleLocale -string en_US
  xcrun simctl shutdown "$UDID"
  xcrun simctl boot "$UDID"
  xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1 || true
fi

# After a sign-in iOS asks "Save Password?" in a system sheet that Maestro cannot see or
# tap and that blocks the app behind it. Switching AutoFill passwords off on this
# dedicated simulator keeps the sheet from appearing; the app itself is not touched.
# (Observed to work with all three keys; which one is decisive was not isolated.)
if [ "$(xcrun simctl spawn "$UDID" defaults read com.apple.mobilesafarishared AutoFillPasswords 2>/dev/null || true)" != "0" ]; then
  for domain in com.apple.mobilesafari com.apple.mobilesafarishared com.apple.WebUI; do
    xcrun simctl spawn "$UDID" defaults write "$domain" AutoFillPasswords -bool false
  done
  xcrun simctl shutdown "$UDID"
  xcrun simctl boot "$UDID"
  xcrun simctl bootstatus "$UDID" -b >/dev/null 2>&1 || true
fi

if ! xcrun simctl get_app_container "$UDID" host.exp.Exponent >/dev/null 2>&1; then
  APP_DIR="$E2E_HOME/expo-go-sdk$SDK"
  if [ ! -d "$APP_DIR/Expo Go.app" ] && [ -z "$(ls -d "$APP_DIR"/*.app 2>/dev/null || true)" ]; then
    # The official archive holds the contents of the app bundle itself, not a .app folder.
    mkdir -p "$APP_DIR/Expo Go.app"
    URL="$(cd "$MOBILE_DIR" && npx --yes expo-go url ios "$SDK" 2>/dev/null)"
    echo "e2e: downloading Expo Go for SDK $SDK from $URL"
    curl -fsSL "$URL" | tar -xz -C "$APP_DIR/Expo Go.app"
  fi
  APP="$(ls -d "$APP_DIR"/*.app | head -1)"
  xcrun simctl install "$UDID" "$APP"
fi
echo "e2e: simulator $SIM_NAME ($UDID) ready with Expo Go for SDK $SDK"
