# Live-textning av intercom — roadmap

- [x] Aktivera Lovable Cloud (realtidskanal mellan skärmarna)
- [x] Serverrutt `src/routes/api/public/transcribe.ts` mot Lovable AI (gemini-3.5-transcribe, sv, stream)
- [x] Ljudinfångning i klienten: PCM, nivåbaserad segmentering, WAV 16 kHz mono
- [x] Skärmvy `/`: stor text, talarfärger FOH/Scen, statusrad, helskärm, textstorlek
- [x] Realtidsdelning mellan skärmarna (broadcast per rum)
- [x] Test med riktigt svenskt tal + webbläsarverifiering
