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

- De kat laat vissen los in de arena; ze spartelen daar zelfstandig rond maar
  komen **nooit** vanzelf in een bak terecht.
- **Tik en houd vast** om een vis op te pakken, **sleep of flick** hem naar
  links (ZOET) of rechts (ZOUT). Alleen een actieve sleep- of flickbeweging
  telt als geldige drop.
- Zoetwatervissen (Guppy, Meerval) horen in de **ZOET**-bak, de Clownvis hoort
  in de **ZOUT**-bak.
- Op tijd in de juiste bak levert punten op naar rato van het resterende leven
  van de vis. Verkeerde bak, of een vis die te lang droog ligt, kost een leven.
- Er kunnen meerdere vissen tegelijk actief zijn; de kat laat ze steeds sneller
  los naarmate de ronde vordert (tot een minimum interval).
