# Bygga distributionsfiler

1. `npm run build:installers` — bygger skrivbordsversionen med inbyggd talmodell
   och skapar Linux AppImage samt Mac-zip (arm64 + x64) i `/tmp/installers`.
2. Windows-installationsprogrammet byggs från den uppackade Windows-versionen:

```bash
npx electron-builder --win dir
makensis -DOUTFILE=/tmp/installers/Intercomtext-Windows-Setup.exe \
         -DSOURCEDIR=/tmp/installers/win-unpacked \
         electron/build/installer.nsi
```

Wine behövs inte — NSIS körs direkt. En `.dmg` kräver macOS, därför levereras
Mac som zip.
