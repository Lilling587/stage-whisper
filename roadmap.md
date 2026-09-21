# Live-textning av intercom — roadmap

- [x] Ljudinfångning i klienten: PCM, nivåbaserad segmentering, 16 kHz mono
- [x] Lokal taligenkänning i webbläsaren (Whisper base, svenska) i en web worker
- [x] Skärmvy `/`: stor text, talarfärger FOH/Scen, statusrad, helskärm, textstorlek
- [x] Molnberoendet borttaget (ingen transkriberingsrutt, ingen delning mellan skärmar)
- [x] Test med riktigt svenskt tal + webbläsarverifiering
- [x] Skrivbordspaket med inbyggd talmodell — fungerar helt utan internet (Windows, Mac arm64/x64, Linux)
- [x] Egna paketeringsfiler: Windows-installationsprogram (.exe), Linux AppImage, Mac-zip
