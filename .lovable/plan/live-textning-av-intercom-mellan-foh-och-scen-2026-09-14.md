# Live-textning av intercom mellan FOH och scen

En webbsida som lyssnar på intercomljudet via datorns ljudingång, skriver om talet till svensk text och visar det i stor stil på båda skärmarna samtidigt.

## Så fungerar det i praktiken

1. Du öppnar samma sida på FOH-datorn och scendatorn.
2. På varje dator väljer du position ("FOH" eller "Scen") och vilken ljudingång som ska avlyssnas, och trycker på "Starta lyssning".
3. Allt som sägs skrivs ut löpande på båda skärmarna, märkt med vem som pratade.
4. Texten finns bara under kvällen. Inget sparas efteråt, och sidan töms när man stänger den.

Eftersom varje dator lyssnar på sin egen mikrofon blir talarmärkningen tillförlitlig: FOH-datorn märker allt den hör som FOH, scendatorn som Scen. Viktigt: ingången på varje dator bör bara innehålla den lokala personens röst, annars dubbleras repliker. Det löser man oftast med en direktutgång per station i intercomsystemet.

## Skärmbilden

- Mörk bakgrund, hög kontrast, läsbar på flera meters håll.
- Senaste repliken störst längst ned, äldre repliker tonar bort uppåt.
- Färgmarkering och etikett per talare (FOH / Scen).
- Diskret statusrad: lyssnar, ljudnivå, uppkoppling.
- Helskärmsläge och ett läge för att justera textstorlek.

## Teknisk lösning

- **Ljudinfångning**: Web Audio API fångar PCM från vald ingång (`getUserMedia` + enhetsval). Ljudet delas i segment vid tystnad (enkel nivåbaserad röstdetektering, max ~10 s per segment) och kodas till 16 kHz mono WAV — hela, kompletta filer, inte MediaRecorder-fragment.
- **Transkribering**: varje WAV-segment postas till en serverrutt som vidarebefordrar till Lovable AI (`google/gemini-3.5-transcribe`, `language=sv`, `stream=true`). Deltan strömmas tillbaka till klienten så texten växer fram medan personen pratar. `LOVABLE_API_KEY` läses bara på servern.
- **Delning mellan skärmarna**: Lovable Cloud aktiveras för realtidskanalen. Repliker skickas som broadcast på en kanal per "rum" (t.ex. föreställningsnamn i URL:en) — inga tabeller, ingen inloggning, ingenting sparas.
- **Rutter**: `/` = skärmvyn med rumsval och start/stopp-kontroller; `src/routes/api/transcribe.ts` = serverrutten mot Lovable AI.
- **Robusthet**: tydliga fel i gränssnittet vid nekad mikrofon, tappad uppkoppling eller fel från AI-tjänsten; automatisk återanslutning till kanalen.

## Att tänka på

- Svensk igenkänning är bra men inte perfekt, särskilt med scenslang och namn. Texten är ett stöd, inte en ersättning för intercom.
- Fördröjningen blir typiskt någon sekund efter att en mening avslutats.
- **Kräver internetuppkoppling på båda datorerna.** Hela kedjan är molnberoende: appen laddas från webben, transkriberingen sker i en AI-tjänst online, och texten synkas mellan skärmarna via molnet. En helt offline-lösning skulle kräva igenkänning direkt i webbläsaren (sämre svensk kvalitet, tungt för datorn) och en lokal server på plats för att koppla ihop skärmarna — det är en större och mer skör lösning som ligger utanför vad som är rimligt att bygga här. Om scenen saknar internet räcker ett vanligt 4G/5G-uppkopplat nätverk; datamängden är liten (bara röstljud).

## Steg

1. Aktivera Lovable Cloud för realtidskanalen.
2. Serverrutt för transkribering mot Lovable AI.
3. Ljudinfångning med nivådetektering och WAV-segment i klienten.
4. Skärmvyn: stor text, talarfärger, statusrad, helskärm.
5. Realtidsdelning mellan de två skärmarna.
6. Test i webbläsaren med riktigt tal på svenska.
