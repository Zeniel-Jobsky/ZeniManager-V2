# App Icons

Place your app icons in this directory before building.

## Required Files

| File | Size | Platform |
|------|------|----------|
| `icon.icns` | 512×512 (multi-resolution) | macOS |
| `zeniel-logo.ico` | 256×256 (multi-resolution) | Windows |
| `zeniel-logo.png` | 512×512 | Linux / fallback |
| `dmg-background.png` | 540×380 | macOS DMG background (optional) |

## How to Generate Icons from the Zeniel Logo

1. Start with a high-resolution PNG (at least 1024×1024) of the Zeniel logo
2. Use one of these tools to generate all required formats:

### Option A: electron-icon-builder (recommended)
```bash
npx electron-icon-builder --input=zeniel-logo.png --output=electron/icons
```

### Option B: Online tools
- [iConvert Icons](https://iconverticons.com/online/) — PNG → ICO/ICNS
- [CloudConvert](https://cloudconvert.com/png-to-icns) — PNG → ICNS

### Option C: macOS (if building on Mac)
```bash
# Create iconset directory
mkdir zeniel.iconset
sips -z 16 16     zeniel-logo.png --out zeniel.iconset/icon_16x16.png
sips -z 32 32     zeniel-logo.png --out zeniel.iconset/icon_16x16@2x.png
sips -z 32 32     zeniel-logo.png --out zeniel.iconset/icon_32x32.png
sips -z 64 64     zeniel-logo.png --out zeniel.iconset/icon_32x32@2x.png
sips -z 128 128   zeniel-logo.png --out zeniel.iconset/icon_128x128.png
sips -z 256 256   zeniel-logo.png --out zeniel.iconset/icon_128x128@2x.png
sips -z 256 256   zeniel-logo.png --out zeniel.iconset/icon_256x256.png
sips -z 512 512   zeniel-logo.png --out zeniel.iconset/icon_256x256@2x.png
sips -z 512 512   zeniel-logo.png --out zeniel.iconset/icon_512x512.png
sips -z 1024 1024 zeniel-logo.png --out zeniel.iconset/icon_512x512@2x.png
iconutil -c icns zeniel.iconset -o electron/icons/icon.icns
```

## Notes
- The `electron-builder.yml` references these files automatically
- If icons are missing, electron-builder will use a default Electron icon
- For production builds, proper icons are strongly recommended
