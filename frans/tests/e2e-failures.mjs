// Server zonder sleutels (geen mock): audio en spraak falen netjes; microfoon geweigerd.
import { createRequire } from 'node:module';
const { chromium } = createRequire(import.meta.url)('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:8766/';
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } }); // MacBook-formaat, geen microfoontoestemming
const p = await ctx.newPage();
const errs = []; p.on('pageerror', (e) => errs.push(e.message));
const checks = [];
await p.goto(BASE + '?testhook');
await p.click('#sample'); await p.click('#begin');
const types = new Set();
let micTested = false;
for (let i = 0; i < 60; i++) {
  await p.waitForSelector('.card, #more');
  if (await p.$('#more')) { await p.click('#more'); continue; }
  const c = await p.evaluate(() => window.__card);
  types.add(c.type);
  await p.waitForTimeout(150);
  if (await p.$('#show')) { await p.click('#show'); await p.click('#knew'); continue; }
  if (await p.$('.option')) { const ids = await p.$$eval('.option', (bs) => bs.map((x) => x.dataset.id)); await p.keyboard.press(String(ids.indexOf(c.id) + 1)); await p.click('#next'); continue; }
  if (await p.$('#answer')) { const a = c.type === 'fill' ? c.fill.answer : c.type === 'type_fr2nl' ? c.acceptNl[0] : c.acceptFr[0]; await p.fill('#answer', a); await p.keyboard.press('Enter'); await p.click('#next'); continue; }
  if (await p.$('#rec')) {
    await p.click('#rec');
    await p.waitForSelector('#feedback .fb-title');
    const fb = await p.textContent('#feedback');
    checks.push(['geweigerde/ontbrekende microfoon geeft uitleg', /microfoon/i.test(fb)]);
    await p.click('#skip-speaking');
    micTested = true;
    continue;
  }
}
const note = await p.$('.audio-note');
checks.push(['zonder audio geen luister-/dicteeopdrachten na eerste fout', ![...types].some((t) => ['listen_mc', 'listen_type', 'dictee'].includes(t))]);
checks.push(['lezen en schrijven gaan door', types.has('type_nl2fr') || types.has('type_fr2nl') || types.has('mc_nl2fr')]);
// TTS-route geeft 503 met nette melding
const r = await p.evaluate(async () => { const x = await fetch('api/tts.php', { method: 'POST', headers: { 'X-Frans-Oefenen': '1', 'Content-Type': 'application/json' }, body: '{"text":"bonjour"}' }); return [x.status, await x.json()]; });
checks.push(['tts zonder sleutel: 503 not_configured', r[0] === 503 && r[1].error === 'not_configured']);
const r2 = await p.evaluate(async () => (await fetch('api/tts.php', { method: 'POST', body: '{"text":"bonjour"}' })).status);
checks.push(['api zonder eigen header geweigerd', r2 === 403]);
const r3 = await p.evaluate(async () => (await fetch('api/tts.php')).status);
checks.push(['GET geweigerd', r3 === 405]);
const r4 = await p.evaluate(async () => (await fetch('api/tts.php', { method: 'POST', headers: { 'X-Frans-Oefenen': '1' }, body: JSON.stringify({ text: 'x'.repeat(500) }) })).status);
checks.push(['te lange tekst geweigerd', r4 === 400]);
const html = await p.content();
checks.push(['geen sleutels in de pagina', !/sk-|xi-api-key|api_key/i.test(html)]);
console.log('typen gezien:', [...types].join(', '), '| microfoon getest:', micTested);
let f = 0; for (const [n, ok] of checks) { console.log(ok ? 'OK  ' : 'FOUT', n); if (!ok) f++; }
if (errs.length) { console.log('fouten', errs); f++; }
await b.close(); process.exit(f ? 1 : 0);
