# Bygga distributionsfiler

1. `npm run build:installers` — bygger skrivbordsversionen med inbyggd talmodell
   och skapar Linux AppImage samt Mac-paket (arm64 + x64) i `/tmp/installers`.
2. Windows-installationsprogrammet byggs från den uppackade Windows-versionen:

```bash
npx electron-builder --win dir
makensis -DOUTFILE=/tmp/installers/Intercomtext-Windows-Setup.exe \
         -DSOURCEDIR=/tmp/installers/win-unpacked \
         electron/build/installer.nsi
```

Wine behövs inte — NSIS körs direkt.

## Mac .dmg utan macOS

`hdiutil` finns bara på Mac, så .dmg byggs här med `mkfs.hfsplus` (hfsprogs) och
verktygen `hfsplus` + `dmg` från libdmg-hfsplus:

```bash
git clone --depth 1 https://github.com/planetbeing/libdmg-hfsplus /tmp/libdmg
# filevault.c kräver OpenSSL 1.x: byt ut den mot en stubbe och sätt
# HMAC_CTX-fältet i includes/dmg/filevault.h till void*, sedan:
cmake . -DCMAKE_BUILD_TYPE=Release -DCMAKE_POLICY_VERSION_MINIMUM=3.5 && make

# 1. återställ ramverkens symlänkar (Linux-bygget dubblerar dem, ~600 MB extra)
python3 scripts/fix-frameworks.py /tmp/installers/mac-arm64

# 2. skapa HFS+-volym, lägg in appen + genväg till /Applications, komprimera
python3 scripts/make-dmg.py /tmp/installers/mac-arm64 Intercomtext.app \
        /tmp/arm64.img "/tmp/Intercomtext för Mac (Apple Silicon).dmg"
```

`make-dmg.py` bevarar rättigheter och symlänkar och lägger en genväg till
`/Applications` i volymen, så användaren bara drar ikonen dit. Resultatet är en
komprimerad UDIF-avbild (~210 MB per arkitektur). Kontrollera innehållet med
`dmg extract fil.dmg kontroll.img` följt av `hfsplus kontroll.img ls /`.
