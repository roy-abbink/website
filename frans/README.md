# Frans oefenen

Persoonlijke oefenwebsite voor Frans in de brugklas. Een leerling uploadt foto's van de apprendres uit het werkboek; de website herkent de leerstof en stelt automatisch gemengde oefenblokken samen (lezen, schrijven, luisteren en spreken, in beide vertaalrichtingen).

Er is geen database en geen account. Alle leerstof, voortgang en audio leven alleen in het geheugen van de geopende pagina. Vernieuwen of sluiten wist alles.

## Bediening (voor de leerling)

1. Kies **Foto's kiezen** (meerdere foto's mag) of **Oefen met de voorbeeldset**.
2. Twijfelt de computer bij een woord, dan verschijnt **Even controleren**: vergelijk met het werkboek, pas aan en vink aan wat mee mag. Niet aangevinkt = niet geoefend.
3. Kies **Begin met oefenen**. Daarmee mag de browser ook geluid afspelen.
4. Elke kaart heeft één duidelijke actie. Franse tekst wordt automatisch uitgesproken zodra die zichtbaar is; met **Normaal**, **Langzaam** en **Nog een keer** luister je opnieuw.
5. Na ongeveer 12 kaarten (5 tot 10 minuten) volgt een kort overzicht met **Verder oefenen** en **Stoppen**.

Toetsenbord (MacBook): Enter controleert of gaat verder, 1 tot 4 kiest bij meerkeuze, Tab loopt door alle knoppen. De tekenbalk (é è ê ë ç à â î ô û ’) werkt op iPad zonder dat het toetsenbord verdwijnt.

## Opbouw

| Bestand | Rol |
|---|---|
| `index.html`, `assets/style.css` | Rustige, responsieve interface |
| `assets/app.js` | Schermen, oefenkaarten, feedback |
| `assets/content.js` | Voorbeeldset en omzetting van herkende foto-inhoud naar leeritems |
| `assets/grader.js` | Deterministisch nakijken (goed / bijna goed / opnieuw) en spraakvergelijking |
| `assets/planner.js` | Kiest item, oefenvorm en richting; herhaling binnen de sessie |
| `assets/audio.js` | Afspelen (met tijdelijke cache) en microfoonopname |
| `api/recognize.php` | Foto's lezen met Claude (vision, gestructureerde JSON-uitvoer) |
| `api/tts.php` | ElevenLabs text-to-speech, normaal en langzaam als aparte generaties |
| `api/stt.php` | ElevenLabs speech-to-text (Scribe), Frans |
| `api/_lib.php` | Configuratie, herkomstcontrole, limieten per IP, geen inhoudslogging |

De serverlaag is PHP 8 zonder extra pakketten, zodat het op gewone webhosting (zoals TransIP) draait.

## Benodigde configuratie (alleen aan de serverzijde)

Zet de sleutels **niet** in git. Kopieer `config.example.php` naar een plek buiten de webroot, `~/frans-oefenen-config.php` in je thuismap (daar wordt het bij een deploy niet verwijderd en is het niet via het web bereikbaar), of zet omgevingsvariabelen.

| Sleutel | Nodig voor |
|---|---|
| `ELEVENLABS_API_KEY` | Franse audio en spraakherkenning. Rechten: Text to Speech, Speech to Text, Voices (lezen). |
| `ELEVENLABS_VOICE_ID` | Optioneel. Standaard Rayane (`2i5dPPF5PJ5RQSrDsmUd`), mannelijk, Frans uit Frankrijk. Leeg = automatisch kiezen uit de stemmen in het account. |
| `ELEVENLABS_KEY_VIA_PROXY` | Alleen voor de Claude-ontwikkelomgeving: `1` als de sleutel via een netwerkgeheim wordt toegevoegd. |
| `ANTHROPIC_API_KEY` | Foto's van apprendres lezen. Zonder deze sleutel werkt alleen de voorbeeldset. |
| `ELEVENLABS_TTS_MODEL`, `ELEVENLABS_STT_MODEL`, `ANTHROPIC_MODEL` | Optioneel, standaard `eleven_multilingual_v2`, `scribe_v2` (valt terug op `scribe_v1`), `claude-opus-5-5`. |

Advies voor de stem: kies in de ElevenLabs Voice Library een mannelijke stem met taal Frans en accent "Parisian/standard", luister naar `bonjour`, `je m'appelle` en `vous êtes`, en zet het ID in `ELEVENLABS_VOICE_ID`.

## Lokaal draaien en testen

```bash
MOCK_SERVICES=1 php -S 127.0.0.1:8765 -t .   # testmodus: toon in plaats van spraak, vaste testherkenning
php -S 127.0.0.1:8766 -t .                    # echte modus (met sleutels in config of omgeving)
node tests/grader.test.mjs                    # nakijk-, planner- en leerstoftests
node tests/e2e.mjs                            # end-to-end tegen de testmodus (Chromium)
BASE=http://127.0.0.1:8766/ node tests/e2e-failures.mjs   # zonder sleutels: nette foutafhandeling
```

## Privacy en bewaren

- De website bewaart niets: geen database, geen localStorage/IndexedDB, geen serviceworker. Foto's en opnames gaan alleen door het geheugen van de server en worden niet weggeschreven (PHP verwijdert het tijdelijke uploadbestand na het verzoek; `stt.php` doet dat ook expliciet).
- Logs bevatten alleen statuscodes van externe diensten, nooit inhoud.
- Limieten per IP-adres per uur (TTS 600, STT 200, herkenning 30). De teller is een gehashte sleutel in de tijdelijke map en verloopt na twee uur.
- **ElevenLabs**: volgens de documentatie is "zero retention" (`enable_logging=false`) alleen beschikbaar voor enterprise-klanten. Met een gewoon account kan ElevenLabs gegenereerde audio en verzoeken dus in de eigen geschiedenis bewaren. Controleer dit in de accountinstellingen.
- **Anthropic**: API-invoer wordt volgens hun voorwaarden een beperkte periode bewaard; zero data retention bestaat alleen via een aparte afspraak. Controleer de actuele voorwaarden.

## Bekende beperkingen

- **Uitspraak**: ElevenLabs biedt geen uitspraakbeoordeling. De website controleert alleen welke woorden zijn verstaan en zegt dat ook. Er is geen uitspraakscore. Betrouwbare klankfeedback vraagt een aparte dienst met pronunciation assessment op foneemniveau (bijvoorbeeld Azure Speech Pronunciation Assessment). Dat is een extra betaalde dienst en is bewust niet toegevoegd.
- **Langzame audio** wordt apart gegenereerd met `speed: 0.75` en hogere stabiliteit. Of dit natuurlijk genoeg klinkt, moet met de gekozen stem worden beluisterd; pas zo nodig `speed` in `api/tts.php` aan (ElevenLabs staat ongeveer 0.7 tot 1.2 toe).
- **Korte losse woorden** (zoals "oui") worden door spraakherkenning soms niet herkend. Dan krijgt de leerling "niet goed verstaan, dat is geen fout" en een nieuwe kans.
- **HEIC** werkt in Safari (de browser zet de foto om naar JPEG). Chrome op de Mac kan HEIC meestal niet openen; dan volgt een melding met uitleg.
- **Safari/iPadOS** is in de ontwikkelomgeving niet echt getest; zie het testverslag.
