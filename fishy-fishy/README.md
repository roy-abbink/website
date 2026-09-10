# Fishy Fishy — Mobile Web Prototype

Standalone HTML5 Canvas prototype om game feel en touch interaction te testen:
oppakken, slepen en flicken van vissen naar de juiste bak (zoet/zout water).

Geen build-stap, geen dependencies — alleen `index.html`, `style.css` en `game.js`.

## Lokaal starten

Vanuit deze map, start een simpele lokale server (nodig omdat sommige browsers
Canvas/Audio niet vanaf `file://` willen draaien):

```bash
npx serve .
# of
python3 -m http.server 8000
```

Open daarna `http://localhost:3000` (npx serve) of `http://localhost:8000`
(python) in de browser. Voor het echte mobile gevoel: open de devtools
device-toolbar (responsive mode, 9:16 verhouding) of laad de URL op een
telefoon in hetzelfde netwerk.

## Besturing

- **Tik** een vis aan om hem op te pakken.
- **Sleep** naar een bak en laat los, of **flick** (snel wegslingeren) richting
  een bak.
- Zoetwatervissen (Guppy, Meerval) horen in de **ZOET**-bak, de Clownvis hoort
  in de **ZOUT**-bak.
- Verkeerde bak of een vis die te lang droog ligt kost een leven.
