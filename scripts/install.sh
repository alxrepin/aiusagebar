#!/usr/bin/env bash
# AIUsageBar installer for macOS (Apple Silicon).
#   curl -fsSL https://raw.githubusercontent.com/alxrepin/aiusagebar/main/scripts/install.sh | bash
#
# Files downloaded with curl don't get the "quarantine" attribute that browsers
# add, so macOS doesn't show the "unidentified developer" / "damaged" prompt.
# The app's own updates are downloaded the same way.
set -euo pipefail

REPO="alxrepin/aiusagebar"
APP="AIUsageBar.app"
DEST="${AIUSAGEBAR_DEST:-/Applications}"

if [ "$(uname -s)" != "Darwin" ]; then echo "This installer is for macOS." >&2; exit 1; fi
if [ "$(uname -m)" != "arm64" ]; then echo "Only Apple Silicon builds are published for now." >&2; exit 1; fi

echo "→ Looking up the latest release…"
URL=$(curl -fsSL "https://api.github.com/repos/$REPO/releases/latest" \
  | grep -o '"browser_download_url": *"[^"]*-macos-arm64\.dmg"' | head -n1 | sed 's/.*"\(https[^"]*\)"/\1/')
if [ -z "$URL" ]; then echo "Could not find a macOS build in the latest release." >&2; exit 1; fi

TMP=$(mktemp -d)
MNT="$TMP/mnt"
cleanup() { hdiutil detach "$MNT" -quiet >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

echo "→ Downloading $(basename "$URL")…"
curl -fL --progress-bar -o "$TMP/AIUsageBar.dmg" "$URL"

echo "→ Installing to $DEST…"
mkdir -p "$MNT"
hdiutil attach "$TMP/AIUsageBar.dmg" -nobrowse -readonly -mountpoint "$MNT" -quiet
SRC=$(find "$MNT" -maxdepth 1 -name "*.app" -print -quit)
if [ -z "$SRC" ]; then echo "No app found in the disk image." >&2; exit 1; fi

osascript -e 'tell application "AIUsageBar" to quit' >/dev/null 2>&1 || true
rm -rf "${DEST:?}/$APP"
ditto "$SRC" "$DEST/$APP"
xattr -dr com.apple.quarantine "$DEST/$APP" 2>/dev/null || true

echo "→ Launching AIUsageBar"
open "$DEST/$APP"
echo "✓ Done. Look for the rings in your menu bar."
