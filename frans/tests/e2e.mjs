// End-to-end in Chromium tegen `php -S` met MOCK_SERVICES=1 (geen echte externe diensten).
import { createRequire } from 'node:module';
const { chromium, webkit } = createRequire(import.meta.url)('playwright');
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://127.0.0.1:8765/';
const engine = process.env.ENGINE === 'webkit' ? webkit : chromium;
fs.mkdirSync('tests/screenshots', { recursive: true });
const log = (...a) => console.log(...a);

const browser = await engine.launch(engine === chromium ? {
  args: ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream', '--autoplay-policy=no-user-gesture-required'],
} : {});
const ctx = await browser.newContext({ viewport: { width: 1024, height: 1366 }, permissions: engine === chromium ? ['microphone'] : [] });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const ttsCalls = [];
page.on('request', (r) => { if (r.url().includes('tts.php')) ttsCalls.push(JSON.parse(r.postData())); });

await page.goto(BASE + '?testhook');
await page.screenshot({ path: 'tests/screenshots/1-start.png' });
await page.click('#sample');
await page.waitForSelector('#begin');
await page.screenshot({ path: 'tests/screenshots/2-ready.png' });
await page.click('#begin');

const seen = {};
let accentTested = false;
let speakShot = false;
const checks = [];
async function runBlock(maxCards = 25) {
  for (let i = 0; i < maxCards; i++) {
    await page.waitForSelector('.card, h1:has-text("Dit blok is klaar")');
    if (await page.$('h1:has-text("Dit blok is klaar")')) return;
    const tag = (await page.textContent('.skill-tag')).trim();
    const kicker = (await page.textContent('.kicker')).trim();
    const key = tag + ' | ' + kicker.replace(tag, '');
    seen[key] = (seen[key] || 0) + 1;
    if (seen[key] === 1) await page.screenshot({ path: `tests/screenshots/card-${Object.keys(seen).length}.png` });

    const card = await page.evaluate(() => window.__card);
    const right = Math.random() < 0.75;
    if (await page.$('#show')) { // omdraaikaart
      await page.click('#show');
      await page.click(right ? '#knew' : '#practice');
      continue;
    }
    if (await page.$('.option')) { // meerkeuze
      if (await page.$('.prompt-hidden')) checks.push(['luisteren: Franse tekst vooraf verborgen', !(await page.$('.prompt[lang="fr"]'))]);
      if (card.type === 'mc_nl2fr') checks.push(['mc nl→fr: opties zijn Frans', !!(await page.$('.option[lang="fr"]'))]);
      const ids = await page.$$eval('.option', (bs) => bs.map((b) => b.dataset.id));
      const target = right ? ids.indexOf(card.id) : ids.findIndex((x) => x !== card.id);
      await page.keyboard.press(String(target + 1));
      await page.waitForSelector('#next');
      await page.click('#next');
      continue;
    }
    if (await page.$('#answer')) { // typen
      checks.push(['typen: geen antwoord vooraf zichtbaar', !(await page.$('.fr-strong'))]);
      if (await page.$('.prompt-hidden')) checks.push(['luisteren/dictee: transcriptie vooraf verborgen', !(await page.$('.prompt[lang="fr"]'))]);
      const ans = card.type === 'fill' ? card.fill.answer
        : (card.type === 'type_fr2nl' || card.type === 'listen_type') ? card.acceptNl[0]
        : card.type === 'dictee' ? card.fr : card.acceptFr[0];
      const isFr = !['type_fr2nl', 'listen_type'].includes(card.type);
      const stripped = ans.normalize('NFD').replace(/\p{M}/gu, '');
      if (isFr && stripped !== ans && !accentTested) {
        accentTested = true;
        await page.fill('#answer', stripped);
        await page.keyboard.press('Enter');
        await page.waitForSelector('#feedback .fb-title');
        checks.push(['accentfout geeft "bijna goed" met uitleg', (await page.textContent('#feedback')).includes('Bijna goed') && (await page.textContent('#feedback')).includes('accent')]);
        await page.screenshot({ path: 'tests/screenshots/5-accent-feedback.png' });
      } else if (right) {
        await page.fill('#answer', ans.replace("'", '’'));
        await page.keyboard.press('Enter');
        await page.waitForSelector('#feedback .fb-title');
        checks.push(['goed antwoord (gekrulde apostrof) is goed', (await page.textContent('#feedback .fb-title')).includes('Goed')]);
      } else {
        await page.fill('#answer', 'xyz');
        await page.keyboard.press('Enter');
        await page.waitForSelector('.fb-opnieuw');
        checks.push(['hint na eerste fout', /Hint|lidwoord|klopt|betekent/.test(await page.textContent('#feedback'))]);
        checks.push(['na eerste fout nog geen antwoord', !(await page.$('#feedback .fr-strong'))]);
        await page.fill('#answer', 'xyz');
        await page.keyboard.press('Enter');
      }
      await page.waitForSelector('#next');
      await page.click('#next');
      continue;
    }
    if (await page.$('#rec')) { // spreken
      if (card.type === 'speak') checks.push(['spreken: antwoord pas na poging', !(await page.$('.fr-strong')) && !(await page.$('.prompt[lang="fr"]'))]);
      const said = right ? card.fr : (Math.random() < 0.5 ? '' : 'merci beaucoup');
      await page.evaluate((t) => { window.__mockSpeech = t; }, said);
      await page.click('#rec');
      await page.waitForTimeout(1200);
      await page.click('#rec');
      await page.waitForSelector('#feedback .fb-title');
      const fb = await page.textContent('#feedback');
      if (said === '') checks.push(['onverstaanbaar is geen fout', fb.includes('geen fout') && !fb.includes('Nog niet goed')]);
      else checks.push(['spreken toont verstane tekst', fb.includes('Verstaan')]);
      if (!speakShot && card.type === 'speak' && said) { speakShot = true; await page.screenshot({ path: 'tests/screenshots/6-speak-feedback.png' }); }
      if (!(await page.$('#next'))) await page.click('#reveal');
      if (await page.$('#next')) await page.click('#next');
      continue;
    }
    throw new Error('Onbekende kaart: ' + key);
  }
}

for (let b = 0; b < 8; b++) {
  await runBlock();
  await page.waitForSelector('#more');
  if (b === 0) await page.screenshot({ path: 'tests/screenshots/3-summary.png', fullPage: true });
  await page.click('#more');
}

// TTS: normaal en langzaam apart aangevraagd, en hergebruik binnen de sessie.
await page.waitForSelector('.card');
const slowBtn = await page.$('[data-play="slow"]');
if (slowBtn) { await slowBtn.click(); await page.waitForTimeout(300); }
const styles = new Set(ttsCalls.map((c) => c.style));
checks.push(['langzame audio apart aangevraagd (als knop aanwezig)', !slowBtn || styles.has('slow')]);
const uniq = new Set(ttsCalls.map((c) => c.style + c.text));
checks.push(['audiocache: geen dubbele aanvragen', uniq.size === ttsCalls.length]);
checks.push(['geen metadata uitgesproken', ttsCalls.every((c) => !/\((m|v)\)|mannelijk|vrouwelijk|als vraag/.test(c.text))]);

// Nieuwe upload vervangt de leerstof (mock-herkenning geeft een andere set met één onzeker item).
await page.click('#stop');
await page.click('#quit');
await page.click('#new');
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
await page.setInputFiles('#photos', { name: 'apprendre.png', mimeType: 'image/png', buffer: png });
await page.waitForSelector('h1:has-text("Even controleren")');
await page.screenshot({ path: 'tests/screenshots/4-review.png', fullPage: true });
await page.click('#continue'); // onzeker item niet aangevinkt → niet meenemen
await page.waitForSelector('#begin');
const lead = await page.textContent('.lead');
checks.push(['nieuwe upload vervangt leerstof (4 zekere items)', lead.includes('4 woorden')]);
const table = await page.textContent('.overview');
checks.push(['onzeker item niet stilzwijgend opgenomen', !table.includes('la rue')]);
checks.push(['oude leerstof weg', !table.includes('bonjour')]);

// Niet-ondersteund bestand.
await page.click('#new-photos');
await page.setInputFiles('#photos', { name: 'tekst.txt', mimeType: 'text/plain', buffer: Buffer.from('hallo') });
await page.waitForSelector('.notice-warn');
checks.push(['melding bij verkeerd bestandstype', (await page.textContent('.notice-warn')).includes('geen foto')]);

// Herladen wist de sessie.
await page.click('#sample'); await page.click('#begin');
page.once('dialog', (d) => d.accept());
await page.reload();
await page.waitForSelector('#sample');
checks.push(['herladen wist sessie', true]);
const storage = await page.evaluate(() => [localStorage.length, sessionStorage.length]);
checks.push(['geen localStorage/sessionStorage', storage[0] === 0 && storage[1] === 0]);

log('Geziene kaarttypen:'); for (const [k, v] of Object.entries(seen)) log('  ', v, k);
let failed = 0;
const grouped = {};
for (const [name, ok] of checks) { grouped[name] = grouped[name] ?? true; grouped[name] = grouped[name] && ok; }
for (const [name, ok] of Object.entries(grouped)) { log(ok ? 'OK  ' : 'FOUT', name); if (!ok) failed++; }
if (errors.length) { log('Browserfouten:', errors); failed++; }
await browser.close();
process.exit(failed ? 1 : 0);
