#!/usr/bin/env bash
# 文件用途：Mac 应用打包脚本。
# 先构建网页，再按资源清单复制到应用包，生成图标并编译原生代码；输出发行包，不代表真实同步验收。
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="日程"
APP_DIR="$ROOT_DIR/dist/$APP_NAME.app"
ICON_SOURCE="${1:-$ROOT_DIR/assets/icons/AppIcon.png}"
ICONSET_DIR="/tmp/daily_planner_icon.iconset"
ICNS_TMP="/tmp/daily_planner_app_icon.icns"
PYTHON_BIN="${PYTHON_BIN:-/Users/qhx/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3}"

if [[ ! -f "$ICON_SOURCE" ]]; then
  echo "Icon file not found: $ICON_SOURCE" >&2
  echo "Usage: macos/build-mac-app.sh /path/to/icon.png" >&2
  exit 1
fi

mkdir -p "$APP_DIR/Contents/MacOS" "$APP_DIR/Contents/Resources" "$ICONSET_DIR"
rm -f "$ICONSET_DIR"/*.png "$ICNS_TMP"

npm --prefix "$ROOT_DIR" run build

# Copy only distributable resources, preserving their project-relative paths.
# Replace the generated web directory so obsolete flat-layout assets cannot survive.
WEB_STAGE="$(mktemp -d "$APP_DIR/Contents/Resources/web-stage.XXXXXX")"
trap 'rm -rf "$WEB_STAGE"' EXIT
while IFS= read -r resource; do
  [[ -z "$resource" || "$resource" == \#* ]] && continue
  mkdir -p "$WEB_STAGE/$(dirname "$resource")"
  cp "$ROOT_DIR/$resource" "$WEB_STAGE/$resource"
done < "$ROOT_DIR/config/web-assets.txt"
rm -rf "$APP_DIR/Contents/Resources/web"
mv "$WEB_STAGE" "$APP_DIR/Contents/Resources/web"

cat > "$APP_DIR/Contents/Info.plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>CFBundleDevelopmentRegion</key>
  <string>zh_CN</string>
  <key>CFBundleDisplayName</key>
  <string>日程</string>
  <key>CFBundleExecutable</key>
  <string>日程</string>
  <key>CFBundleIconFile</key>
  <string>AppIcon</string>
  <key>CFBundleIdentifier</key>
  <string>com.qhxxxq.daily-planner</string>
  <key>CFBundleInfoDictionaryVersion</key>
  <string>6.0</string>
  <key>CFBundleName</key>
  <string>日程</string>
  <key>CFBundlePackageType</key>
  <string>APPL</string>
  <key>CFBundleShortVersionString</key>
  <string>1.6.1</string>
  <key>CFBundleVersion</key>
  <string>13</string>
  <key>LSMinimumSystemVersion</key>
  <string>12.0</string>
  <key>NSCalendarsUsageDescription</key>
  <string>将日程 App 中的内容同步到 Apple 日历，方便在 iPhone 和其他 Apple 设备上查看。</string>
  <key>NSCalendarsFullAccessUsageDescription</key>
  <string>将日程 App 中的内容同步到 Apple 日历，方便在 iPhone 和其他 Apple 设备上查看。</string>
  <key>NSAppTransportSecurity</key>
  <dict>
    <key>NSAllowsArbitraryLoads</key>
    <true/>
  </dict>
  <key>NSHighResolutionCapable</key>
  <true/>
</dict>
</plist>
PLIST

"$PYTHON_BIN" - "$ICON_SOURCE" "$ICONSET_DIR" "$APP_DIR/Contents/Resources/AppIcon.icns" <<'PY'
import sys
import struct
from pathlib import Path
from PIL import Image

source = Image.open(sys.argv[1]).convert("RGBA")
out = Path(sys.argv[2])
icns_path = Path(sys.argv[3])
sizes = [
    (16, "icon_16x16.png", "icp4"),
    (32, "icon_16x16@2x.png", "icp5"),
    (32, "icon_32x32.png", "icp5"),
    (64, "icon_32x32@2x.png", "icp6"),
    (128, "icon_128x128.png", "ic07"),
    (256, "icon_128x128@2x.png", "ic08"),
    (256, "icon_256x256.png", "ic08"),
    (512, "icon_256x256@2x.png", "ic09"),
    (512, "icon_512x512.png", "ic09"),
    (1024, "icon_512x512@2x.png", "ic10"),
]

entries = []
for size, name, code in sizes:
    path = out / name
    source.resize((size, size), Image.Resampling.LANCZOS).save(path, "PNG")

for size, name, code in [
    (16, "icon_16x16.png", "icp4"),
    (32, "icon_32x32.png", "icp5"),
    (64, "icon_32x32@2x.png", "icp6"),
    (128, "icon_128x128.png", "ic07"),
    (256, "icon_256x256.png", "ic08"),
    (512, "icon_512x512.png", "ic09"),
    (1024, "icon_512x512@2x.png", "ic10"),
]:
    payload = (out / name).read_bytes()
    entries.append(code.encode("ascii") + struct.pack(">I", len(payload) + 8) + payload)

icns_path.write_bytes(b"icns" + struct.pack(">I", sum(len(entry) for entry in entries) + 8) + b"".join(entries))
PY

swiftc -O -framework Cocoa -framework EventKit -framework UniformTypeIdentifiers -framework WebKit "$ROOT_DIR/macos/PlannerApp/AppleCalendarSync.swift" "$ROOT_DIR/macos/PlannerApp/main.swift" -o "$APP_DIR/Contents/MacOS/$APP_NAME"
codesign --force --deep --sign - "$APP_DIR"
ditto -c -k --sequesterRsrc --keepParent "$APP_DIR" "$ROOT_DIR/dist/$APP_NAME-mac.zip"

echo "Built:"
echo "  $APP_DIR"
echo "  $ROOT_DIR/dist/$APP_NAME-mac.zip"
