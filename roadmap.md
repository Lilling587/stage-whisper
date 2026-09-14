# Live-textning av intercom — roadmap

- [ ] Aktivera Lovable Cloud (realtidskanal mellan skärmarna)
- [ ] Serverrutt `src/routes/api/transcribe.ts` mot Lovable AI (gemini-3.5-transcribe, sv, stream)
- [ ] Ljudinfångning i klienten: PCM, nivåbaserad segmentering, WAV 16 kHz mono
- [ ] Skärmvy `/`: stor text, talarfärger FOH/Scen, statusrad, helskärm, textstorlek
- [ ] Realtidsdelning mellan skärmarna (broadcast per rum)
- [ ] Test med riktigt svenskt tal + webbläsarverifiering
