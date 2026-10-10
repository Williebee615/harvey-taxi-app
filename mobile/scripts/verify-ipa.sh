#!/bin/sh
# Checks a built rider IPA before any upload to App Store Connect.
# Run on a Mac (uses PlistBuddy, codesign and security):
#   sh scripts/verify-ipa.sh path/to/app.ipa 11
# The second argument is the build number you expect (from the EAS build log).
# Prints each check and exits non-zero if any fails. Reads the IPA only.
set -eu

IPA="${1:?usage: verify-ipa.sh <ipa> <expected build number>}"
EXPECT_BUILD="${2:?usage: verify-ipa.sh <ipa> <expected build number>}"
EXPECT_BUNDLE="com.harveytaxi.HarveyTaxi"
EXPECT_VERSION="1.0.2"
EXPECT_TEAM="AYF633JM4W"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
unzip -q "$IPA" -d "$WORK"
APP="$(find "$WORK/Payload" -maxdepth 1 -name '*.app' | head -1)"
[ -n "$APP" ] || { echo "FAIL: no .app inside Payload/"; exit 1; }

PB="${PLISTBUDDY:-/usr/libexec/PlistBuddy}"
plist() { "$PB" -c "Print :$1" "$APP/Info.plist" 2>/dev/null || echo "(missing)"; }
FAILED=0
check() { # name actual expected
  if [ "$2" = "$3" ]; then echo "PASS  $1: $2"; else echo "FAIL  $1: $2 (expected $3)"; FAILED=1; fi
}

check "Bundle ID" "$(plist CFBundleIdentifier)" "$EXPECT_BUNDLE"
check "Version" "$(plist CFBundleShortVersionString)" "$EXPECT_VERSION"
check "Build number" "$(plist CFBundleVersion)" "$EXPECT_BUILD"

SDK="$(plist DTSDKName)"; XCODE="$(plist DTXcode)"
case "$SDK" in iphoneos26*|iphoneos2[7-9]*) echo "PASS  SDK: $SDK (Xcode $XCODE)";; *) echo "FAIL  SDK: $SDK (Xcode $XCODE), needs iOS 26 or later"; FAILED=1;; esac

if codesign --verify --deep --strict "$APP" 2>/dev/null; then echo "PASS  Code signature valid"; else echo "FAIL  Code signature invalid"; FAILED=1; fi
SIGN="$(codesign -dvv "$APP" 2>&1)"
AUTH="$(printf '%s\n' "$SIGN" | sed -n 's/^Authority=//p' | head -1)"
case "$AUTH" in "Apple Distribution:"*|"iPhone Distribution:"*) echo "PASS  Signed by: $AUTH";; *) echo "FAIL  Signed by: $AUTH (needs a distribution certificate)"; FAILED=1;; esac
check "Signing team" "$(printf '%s\n' "$SIGN" | sed -n 's/^TeamIdentifier=//p')" "$EXPECT_TEAM"

security cms -D -i "$APP/embedded.mobileprovision" > "$WORK/profile.plist" 2>/dev/null
prof() { "$PB" -c "Print :$1" "$WORK/profile.plist" 2>/dev/null || echo "(missing)"; }
check "Profile app ID" "$(prof Entitlements:application-identifier)" "$EXPECT_TEAM.$EXPECT_BUNDLE"
check "Profile debuggable (get-task-allow)" "$(prof Entitlements:get-task-allow)" "false"
if "$PB" -c "Print :ProvisionedDevices" "$WORK/profile.plist" >/dev/null 2>&1; then
  echo "FAIL  Profile lists devices (ad hoc or development, not App Store)"; FAILED=1
else
  echo "PASS  Profile type: App Store (no device list)"
fi
echo "INFO  Profile name: $(prof Name); expires $(prof ExpirationDate)"

[ "$FAILED" = 0 ] && echo "ALL CHECKS PASSED" || { echo "DO NOT UPLOAD"; exit 1; }
