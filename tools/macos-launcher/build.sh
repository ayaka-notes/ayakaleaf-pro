#!/bin/bash
set -eu
[[ $(uname -s) == Darwin && $(/usr/sbin/sysctl -n hw.optional.arm64 2>/dev/null) == 1 ]] || { echo 'Requires macOS on Apple Silicon.' >&2; exit 1; }
source_dir=$(cd "$(dirname "$0")" && pwd)
destination=${1:-"$HOME/Applications/Ayakaleaf Pro.app"}
[[ $destination == *.app && ! -e $destination && ! -L $destination ]] || { echo 'Choose a new .app path; the destination must not already exist.' >&2; exit 1; }
mkdir -p "$(dirname "$destination")"
stage=$(mktemp -d "$(dirname "$destination")/.ayakaleaf-build.XXXXXX")
trap 'rm -rf "$stage"' EXIT
app="$stage/Ayakaleaf Pro.app"
osacompile -o "$app" "$source_dir/launcher.applescript"
resources="$app/Contents/Resources"
install -m 755 "$source_dir/start.sh" "$resources/start.sh"
mkdir "$stage/Leaf.iconset"
sips --cropOffset 137 27 -c 416 416 "$source_dir/../../doc/logo.png" --out "$stage/leaf.png" >/dev/null
for size in 16 32 128 256 512; do
  sips -z "$size" "$size" "$stage/leaf.png" --out "$stage/Leaf.iconset/icon_${size}x${size}.png" >/dev/null
  double=$((size * 2))
  sips -z "$double" "$double" "$stage/leaf.png" --out "$stage/Leaf.iconset/icon_${size}x${size}@2x.png" >/dev/null
done
iconutil -c icns "$stage/Leaf.iconset" -o "$resources/Leaf.icns"
plist="$app/Contents/Info.plist"
plutil -replace CFBundleIdentifier -string space.ayaka.ayakaleaf.local-launcher "$plist"
plutil -replace CFBundleIconFile -string Leaf.icns "$plist"
if plutil -extract CFBundleIconName raw "$plist" >/dev/null 2>&1; then plutil -remove CFBundleIconName "$plist"; fi
codesign --force --sign - "$app"
codesign --verify --strict "$app"
mv "$app" "$destination"
printf 'Built %s\n' "$destination"
