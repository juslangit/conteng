#!/usr/bin/env bash
# Sign the built app with this Mac's local signing certificate (a stable identity, so
# macOS remembers the app across rebuilds), then install it in /Applications.
set -euo pipefail
cd "$(dirname "$0")/.."
BUILT="dist/mac-arm64/Conteng.app"
SIGNER="$HOME/Desktop/projects/3d/bengkel/common/sign.sh"
ID="$(security find-identity -v -p codesigning | sed -n 's/.*"\(.*Local Signing\)"$/\1/p' | head -1)"
if [ -z "$ID" ]; then
  echo "No local signing certificate: run $SIGNER --make-cert once." >&2
  exit 1
fi
# ~/Desktop is synced to iCloud, which keeps re-adding extended attributes that
# codesign rejects ("detritus not allowed"), so sign a copy outside it.
STAGE="$(mktemp -d "${TMPDIR:-/tmp}/conteng-sign.XXXXXX")"
APP="$STAGE/Conteng.app"
ditto --norsrc --noextattr "$BUILT" "$APP"
xattr -cr "$APP"
codesign --force --deep --sign "$ID" "$APP"
"$SIGNER" "$APP"
if [ "${1:-}" != "--no-install" ]; then
  osascript -e 'tell application "Conteng" to quit' >/dev/null 2>&1 || true
  ditto "$APP" /Applications/Conteng.app.new
  [ -d /Applications/Conteng.app ] && mv /Applications/Conteng.app "$STAGE/Conteng.app.old"
  mv /Applications/Conteng.app.new /Applications/Conteng.app
  echo "Installed /Applications/Conteng.app"
fi
