// Interface: schermen, oefenkaarten en feedback. Alle staat leeft alleen in het geheugen van deze pagina.

import { sampleSet, fromRecognition, sourceLabel } from './content.js';
import { Planner, TYPES, shuffle } from './planner.js';
import { grade, gradeSpeech, hintFor } from './grader.js';
import { AudioPlayer, Recorder, MAX_RECORD_SECONDS } from './audio.js';
import { api, ApiError } from './api.js';

const app = document.getElementById('app');
const announcer = document.getElementById('announcer');
const audio = new AudioPlayer(api);
const recorder = new Recorder();

const S = {
  content: null,   // { items, apprendres, origin }
  planner: null,
  card: null,
  ui: {},          // staat van de huidige kaart
  audioNoticeShown: false,
  ownRecordingUrl: null,
};

const SKILL_NL = { lezen: 'lezen', schrijven: 'schrijven', luisteren: 'luisteren', spreken: 'spreken' };
const ACCENTS = ['é', 'è', 'ê', 'ë', 'ç', 'à', 'â', 'î', 'ô', 'û', '’'];
const TEST_HOOK = new URLSearchParams(location.search).has('testhook');
const SESSION_TEXT = 'Je oefent alleen in deze sessie. Als je de pagina vernieuwt of sluit, begin je opnieuw.';

// ---------- Hulpjes ----------

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pretty = (s) => esc(String(s).replace(/'/g, '’'));
const $ = (sel, root = app) => root.querySelector(sel);
const $$ = (sel, root = app) => [...root.querySelectorAll(sel)];

function show(html, focusSel) {
  audio.stop();
  if (recorder.stream) recorder.stop();
  app.innerHTML = html;
  window.scrollTo(0, 0);
  const f = focusSel ? $(focusSel) : null;
  (f || app).focus({ preventScroll: true });
}

function announce(text) {
  announcer.textContent = '';
  setTimeout(() => { announcer.textContent = text; }, 30);
}

function pickPrompt(list) {
  return list[Math.floor(Math.random() * list.length)];
}

// ---------- Startscherm ----------

function renderStart(message) {
  document.getElementById('session-note').hidden = true;
  show(`
    <section class="panel intro">
      <h1>Oefen je Franse apprendres</h1>
      <p class="lead">Maak een foto van de apprendres in je werkboek. Deze website maakt er oefeningen van: lezen, schrijven, luisteren en spreken.</p>
      ${message ? `<p class="notice notice-warn" role="alert">${esc(message)}</p>` : ''}
      <div class="upload">
        <label class="btn btn-primary btn-large" for="photos">Foto’s kiezen</label>
        <input id="photos" class="visually-hidden-input" type="file" accept="image/*,.heic,.heif" multiple>
        <p class="hint">JPG of PNG. Je kunt meerdere foto’s tegelijk kiezen. Op de iPad kan dat rechtstreeks uit je fotobibliotheek.</p>
      </div>
      <div class="or"><span>of</span></div>
      <button class="btn btn-secondary" id="sample" type="button">Oefen met de voorbeeldset (Apprendre 1, 2 en 3)</button>
      <div class="fineprint">
        <p><strong>${esc(SESSION_TEXT)}</strong></p>
        <p>Er wordt niets bewaard op deze website. Om je foto’s te lezen worden ze naar Anthropic (Claude) gestuurd. Om Frans uit te spreken en jouw spraak te herkennen wordt tekst en je opname naar ElevenLabs gestuurd. Wat die diensten zelf tijdelijk bewaren, valt onder hun eigen voorwaarden.</p>
      </div>
    </section>`, 'h1');
  $('h1').tabIndex = -1;
  $('#photos').addEventListener('change', (e) => handleFiles([...e.target.files]));
  $('#sample').addEventListener('click', () => startContent(sampleSet()));
}

// ---------- Foto's verwerken ----------

async function handleFiles(files) {
  if (!files.length) return;
  if (files.length > 6) return renderStart('Kies maximaal zes foto’s tegelijk.');
  show(`<section class="panel center" aria-busy="true">
      <div class="spinner" aria-hidden="true"></div>
      <h1 tabindex="-1">Je foto’s worden gelezen…</h1>
      <p class="hint" id="progress-text">Foto’s voorbereiden</p>
    </section>`, 'h1');
  const images = [];
  for (const [i, f] of files.entries()) {
    try {
      images.push(await prepareImage(f));
    } catch (e) {
      return renderStart(`Foto ${i + 1} (${f.name}) kan niet worden gebruikt. ${e.message}`);
    }
  }
  $('#progress-text') && ($('#progress-text').textContent = 'De leerstof wordt herkend. Dit kan een halve minuut duren.');
  try {
    const res = await api.recognize(images);
    renderReview(res.result);
  } catch (e) {
    renderError(e instanceof ApiError ? e.message : 'Er ging iets mis bij het lezen van de foto’s.', [
      { label: 'Opnieuw proberen', primary: true, action: () => handleFiles(files) },
      { label: 'Terug naar het begin', action: () => renderStart() },
    ]);
  }
}

/** Verkleint de foto en zet hem om naar JPEG. Safari kan zo ook HEIC-foto’s verwerken. */
async function prepareImage(file) {
  const isHeic = /hei[cf]$/i.test(file.name) || /hei[cf]/i.test(file.type);
  if (file.type && !file.type.startsWith('image/') && !isHeic) throw new Error('Dit is geen foto. Kies een JPG of PNG.');
  if (file.size > 40 * 1024 * 1024) throw new Error('De foto is te groot.');
  let img;
  try {
    img = await loadImage(file);
  } catch {
    throw new Error(isHeic
      ? 'Deze browser kan HEIC-foto’s niet openen. Op een Mac: open de foto in Foto’s en kies Exporteer als JPEG, of upload vanaf de iPad.'
      : 'Het formaat wordt niet ondersteund. Gebruik JPG of PNG.');
  }
  const max = 2000;
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
  if (img.close) img.close();
  const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', 0.86));
  if (!blob) throw new Error('De foto kon niet worden voorbereid.');
  const data = await new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result).split(',')[1]);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });
  return { data, type: 'image/jpeg' };
}

async function loadImage(file) {
  if (window.createImageBitmap) {
    try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* val terug */ }
  }
  const url = URL.createObjectURL(file);
  try {
    return await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = reject;
      im.src = url;
    });
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

// ---------- Controle van onzekere herkenning ----------

function renderReview(result) {
  const sure = [];
  const unsure = [];
  for (const a of result.apprendres || []) {
    for (const it of a.items || []) {
      const raw = { ...it, apprendreNumber: a.number, apprendreTitle: a.title };
      const complete = it.nl && it.fr;
      (it.certain && complete ? sure : unsure).push(raw);
    }
  }
  const problems = result.problems || [];
  if (!sure.length && !unsure.length) {
    return renderError('Op deze foto’s is geen leesbare leerstof gevonden. Maak een scherpe foto van één apprendre, recht van boven en zonder schaduw.', [
      { label: 'Andere foto’s kiezen', primary: true, action: () => renderStart() },
    ]);
  }
  if (!unsure.length && !problems.length) {
    return startContent(fromRecognition(result.apprendres, sure));
  }
  show(`
    <section class="panel">
      <h1 tabindex="-1">Even controleren</h1>
      <p class="lead">${sure.length} woorden en uitdrukkingen zijn goed gelezen. Bij ${unsure.length ? 'de woorden hieronder' : 'deze foto’s'} twijfelt de computer.</p>
      ${problems.map((p) => `<p class="notice notice-warn">Foto ${p.photo + 1}: ${esc(p.message)}</p>`).join('')}
      ${unsure.length ? `<p>Vergelijk met je werkboek. Pas aan wat niet klopt en vink aan wat je wilt oefenen. Niet aangevinkte woorden worden niet geoefend.</p>
      <ul class="review-list">
        ${unsure.map((u, i) => `
          <li class="review-item">
            <p class="review-issue">${esc(u.issue || 'Niet zeker gelezen.')} <span class="muted">(Apprendre ${esc(u.apprendreNumber)})</span></p>
            <div class="review-fields">
              <label>Nederlands <input type="text" data-k="nl" data-i="${i}" value="${esc(u.nl)}" autocomplete="off"></label>
              <label>Frans <input type="text" lang="fr" data-k="fr" data-i="${i}" value="${esc(u.fr)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>
            </div>
            <label class="check"><input type="checkbox" data-i="${i}" data-k="use"> Klopt, meenemen</label>
          </li>`).join('')}
      </ul>` : ''}
      <div class="actions">
        <button class="btn btn-primary" id="continue" type="button">Verder</button>
        <button class="btn btn-secondary" id="retake" type="button">Betere foto maken</button>
      </div>
    </section>`, 'h1');
  $('#retake').addEventListener('click', () => renderStart());
  $('#continue').addEventListener('click', () => {
    const chosen = [...sure];
    unsure.forEach((u, i) => {
      if ($(`input[data-k="use"][data-i="${i}"]`).checked) {
        const nl = $(`input[data-k="nl"][data-i="${i}"]`).value.trim();
        const fr = $(`input[data-k="fr"][data-i="${i}"]`).value.trim();
        if (nl && fr) chosen.push({ ...u, nl, fr, nl_alternatives: nl === u.nl ? u.nl_alternatives : [] });
      }
    });
    if (!chosen.length) return renderStart('Er is nog geen leerstof om te oefenen. Probeer een duidelijkere foto.');
    startContent(fromRecognition(result.apprendres, chosen));
  });
}

// ---------- Klaar om te beginnen ----------

function startContent(content) {
  // Nieuwe leerstof vervangt alles: planner, audio en eerdere resultaten.
  audio.reset();
  S.content = content;
  S.planner = new Planner(content.items);
  S.audioNoticeShown = false;
  if (!Recorder.supported()) S.planner.setAvailable('mic', false);
  renderReady();
}

function renderReady() {
  const c = S.content;
  const groups = c.apprendres.map((a) => ({
    a, items: c.items.filter((it) => it.sources.some((s) => s.apprendre === a.number)),
  })).filter((g) => g.items.length);
  show(`
    <section class="panel">
      <h1 tabindex="-1">Klaar om te oefenen</h1>
      <p class="lead">${c.items.length} woorden en uitdrukkingen uit ${groups.map((g) => `Apprendre ${esc(g.a.number)}`).join(', ')}.</p>
      ${c.origin === 'voorbeeld' ? '<p class="hint">Voorbeeldset: overgenomen uit de transcriptie van de drie voorbeeldfoto’s.</p>' : ''}
      <details class="overview">
        <summary>Bekijk de leerstof</summary>
        ${groups.map((g) => `
          <h2>Apprendre ${esc(g.a.number)}${g.a.title ? ' · ' + esc(g.a.title) : ''}</h2>
          <table><thead><tr><th scope="col">Nederlands</th><th scope="col">Frans</th></tr></thead><tbody>
          ${g.items.map((it) => `<tr><td>${esc(it.nl)}${it.note ? ` <span class="muted">(${esc(it.note)})</span>` : ''}</td><td lang="fr">${pretty(it.fr)}</td></tr>`).join('')}
          </tbody></table>
          ${g.a.rules && g.a.rules.length ? `<ul class="rules">${g.a.rules.map((r) => `<li>${esc(r)}</li>`).join('')}</ul>` : ''}`).join('')}
      </details>
      <p class="fineprint">${esc(SESSION_TEXT)} Zet het geluid aan: Franse woorden worden uitgesproken.</p>
      <div class="actions">
        <button class="btn btn-primary btn-large" id="begin" type="button">Begin met oefenen</button>
      </div>
      <p class="center"><button class="link" id="new-photos" type="button">Andere foto’s kiezen</button></p>
    </section>`, '#begin');
  $('#begin').addEventListener('click', () => {
    audio.unlock(); // Gebruikersactie: audio mag daarna automatisch afspelen.
    document.getElementById('session-note').hidden = false;
    S.planner.startBlock();
    nextCard();
  });
  $('#new-photos').addEventListener('click', () => renderStart());
}

// ---------- Oefenkaarten ----------

function nextCard() {
  cleanupOwnRecording();
  const card = S.planner.next();
  if (!card) return renderSummary();
  S.card = card;
  const it = card.item;
  // Alleen voor geautomatiseerde tests (?testhook): maakt de huidige kaart uitleesbaar.
  if (TEST_HOOK) window.__card = { type: card.type, fr: it.fr, nl: it.nl, acceptFr: it.accept.fr, acceptNl: it.accept.nl, fill: it.fill, id: it.id };
  S.ui = { attempts: 0, done: false, promptNl: pickPrompt(it.promptNl) };
  const t = card.type;
  if (t === 'flash_fr' || t === 'flash_nl') renderFlash(card);
  else if (t.startsWith('mc') || t === 'listen_mc') renderMC(card);
  else if (t === 'speak' || t === 'repeat') renderSpeak(card);
  else renderTyping(card);
  // Alvast de audio van de volgende kaarten voorbereiden kost hier weinig: alleen de huidige.
  audio.prefetch(it.tts);
}

function frame(inner, { kicker, skillLabel }) {
  const p = S.planner.progress();
  return `
    <div class="practice">
      <div class="topbar">
        <div class="progress" role="progressbar" aria-label="Voortgang in dit blok" aria-valuemin="0" aria-valuemax="${p.total}" aria-valuenow="${p.done}">
          <span class="progress-bar" style="width:${Math.round((p.done / p.total) * 100)}%"></span>
        </div>
        <span class="progress-text">${p.done} van ${p.total}</span>
        <button class="link" id="stop" type="button">Stoppen</button>
      </div>
      <section class="card" aria-labelledby="kicker">
        <p class="kicker" id="kicker" tabindex="-1">${esc(kicker)}<span class="skill-tag">${esc(skillLabel)}</span></p>
        ${inner}
      </section>
    </div>`;
}

function audioControls(label = 'Luister') {
  return `
    <div class="audio-controls" role="group" aria-label="${esc(label)}">
      <button class="btn btn-audio" type="button" data-play="normal" aria-label="Speel af in normaal tempo"><span aria-hidden="true">▶</span> Normaal</button>
      <button class="btn btn-audio" type="button" data-play="slow" aria-label="Speel langzaam af"><span aria-hidden="true">▶</span> Langzaam</button>
      <button class="btn btn-audio" type="button" data-play="again" aria-label="Nog een keer afspelen"><span aria-hidden="true">↻</span> Nog een keer</button>
    </div>
    <p class="audio-note" aria-live="polite"></p>`;
}

function bindAudio(text, root = app) {
  let last = 'normal';
  $$('[data-play]', root).forEach((b) => b.addEventListener('click', () => {
    const style = b.dataset.play === 'again' ? last : b.dataset.play;
    last = style;
    speak(text, style, root);
  }));
}

/** Spreekt Frans uit en laat een duidelijke melding zien als dat niet lukt. */
async function speak(text, style = 'normal', root = app) {
  const result = await audio.play(text, style);
  const note = $('.audio-note', root);
  if (result === 'blocked' && note) note.textContent = 'Tik op “Normaal” om te luisteren.';
  if (result === 'played' && note) note.textContent = '';
  if (result === 'failed') {
    if (note) note.textContent = 'De audio lukt nu niet. Je kunt gewoon verder oefenen.';
    if (!audio.available) {
      S.planner.setAvailable('audio', false);
      if (!S.audioNoticeShown) {
        S.audioNoticeShown = true;
        announce('De audio werkt nu niet. Je oefent verder met lezen en schrijven.');
      }
    }
  }
  return result;
}

function bindCommon() {
  $('#stop').addEventListener('click', () => renderSummary(true));
}

// Omdraaikaarten
function renderFlash(card) {
  const it = card.item;
  const frFront = card.type === 'flash_fr';
  const front = frFront
    ? `<p class="prompt" lang="fr">${pretty(it.promptFr)}</p>${audioControls()}`
    : `<p class="prompt">${esc(S.ui.promptNl)}</p>`;
  show(frame(`
      ${front}
      <div class="reveal" id="reveal" hidden></div>
      <div class="actions" id="actions">
        <button class="btn btn-primary" id="show" type="button">Laat het antwoord zien</button>
      </div>
      ${sourceFoot(it)}`, {
    kicker: frFront ? 'Wat betekent dit? Denk eerst zelf na.' : 'Hoe zeg je dit in het Frans? Denk eerst zelf na.',
    skillLabel: 'Omdraaikaart',
  }), '#show');
  bindCommon();
  if (frFront) { bindAudio(it.tts); speak(it.tts); }
  $('#show').addEventListener('click', () => {
    const r = $('#reveal');
    r.hidden = false;
    r.innerHTML = frFront
      ? `<p class="answer">${esc(it.nl)}</p>${noteLine(it)}`
      : `<p class="answer" lang="fr">${pretty(it.fr)}</p>${noteLine(it)}${audioControls()}`;
    if (!frFront) { bindAudio(it.tts, r); speak(it.tts, 'normal', r); }
    $('#actions').innerHTML = `
      <button class="btn btn-primary" id="knew" type="button">Ik wist het</button>
      <button class="btn btn-secondary" id="practice" type="button">Nog oefenen</button>`;
    $('#knew').addEventListener('click', () => finish('goed'));
    $('#practice').addEventListener('click', () => finish('bijna'));
    $('#knew').focus();
  });
}

// Meerkeuze (ook luisteren met meerkeuze)
function renderMC(card) {
  const it = card.item;
  const t = card.type;
  const answerLang = t === 'mc_nl2fr' ? 'fr' : 'nl';
  const distract = S.planner.distractors(it, answerLang, 3);
  const options = shuffle([it, ...distract]);
  const label = (o) => (answerLang === 'fr' ? o.fr : o.nl);
  let prompt;
  let kicker;
  if (t === 'mc_fr2nl') { prompt = `<p class="prompt" lang="fr">${pretty(it.promptFr)}</p>${audioControls()}`; kicker = 'Wat betekent dit?'; }
  else if (t === 'mc_nl2fr') { prompt = `<p class="prompt">${esc(S.ui.promptNl)}</p>`; kicker = 'Kies het goede Franse woord.'; }
  else { prompt = `<p class="prompt prompt-hidden">Luister goed</p>${audioControls()}`; kicker = 'Luister. Wat betekent dit?'; }
  show(frame(`
      ${prompt}
      <div class="options" role="group" aria-label="Antwoordmogelijkheden">
        ${options.map((o, i) => `<button class="btn option" type="button" data-id="${o.id}" ${answerLang === 'fr' ? 'lang="fr"' : ''}><span class="key" aria-hidden="true">${i + 1}</span>${answerLang === 'fr' ? pretty(label(o)) : esc(label(o))}</button>`).join('')}
      </div>
      <div class="feedback" id="feedback" role="status"></div>
      <div class="actions" id="actions"></div>
      ${sourceFoot(it)}`, { kicker, skillLabel: t === 'listen_mc' ? 'Luisteren' : 'Meerkeuze' }), '.option');
  bindCommon();
  if (t !== 'mc_nl2fr') { bindAudio(it.tts); speak(it.tts); }
  const choose = (btn) => {
    if (S.ui.done) return;
    S.ui.done = true;
    const correct = btn.dataset.id === it.id;
    $$('.option').forEach((b) => {
      b.disabled = true;
      if (b.dataset.id === it.id) { b.classList.add('is-correct'); b.insertAdjacentHTML('beforeend', '<span class="mark"> ✓ goed antwoord</span>'); }
    });
    if (!correct) { btn.classList.add('is-wrong'); btn.insertAdjacentHTML('beforeend', '<span class="mark"> ✗ jouw keuze</span>'); }
    const chosen = options.find((o) => o.id === btn.dataset.id);
    const extra = !correct
      ? `<p>“${answerLang === 'fr' ? pretty(chosen.fr) : esc(chosen.nl)}” betekent ${answerLang === 'fr' ? `“${esc(chosen.nl)}”` : `in het Frans “${pretty(chosen.fr)}”`}.</p>${it.explain ? `<p>${esc(it.explain)}</p>` : ''}`
      : '';
    feedbackBox(correct ? 'goed' : 'fout', `
      ${t === 'listen_mc' || t === 'mc_nl2fr' ? `<p><span lang="fr" class="fr-strong">${pretty(it.fr)}</span> = ${esc(it.nl)}</p>${audioControls()}` : `<p><span lang="fr" class="fr-strong">${pretty(it.fr)}</span> = ${esc(it.nl)}</p>`}
      ${extra}`);
    if (t === 'listen_mc' || t === 'mc_nl2fr') { bindAudio(it.tts, $('#feedback')); speak(it.tts, 'normal', $('#feedback')); }
    nextButton(correct ? 'goed' : 'fout');
  };
  $$('.option').forEach((b) => b.addEventListener('click', () => choose(b)));
  S.ui.keys = (e) => {
    const n = parseInt(e.key, 10);
    if (n >= 1 && n <= options.length && !S.ui.done) { e.preventDefault(); choose($$('.option')[n - 1]); }
  };
}

// Typen: vertalen, luisteren-typen, dictee en grammatica invullen
function renderTyping(card) {
  const it = card.item;
  const t = card.type;
  let prompt;
  let kicker;
  let answerLang;
  let accepted;
  let skillLabel = 'Schrijven';
  if (t === 'type_fr2nl') {
    prompt = `<p class="prompt" lang="fr">${pretty(it.promptFr)}</p>${audioControls()}`;
    kicker = 'Typ de Nederlandse betekenis.'; answerLang = 'nl'; accepted = it.accept.nl;
  } else if (t === 'type_nl2fr') {
    prompt = `<p class="prompt">${esc(S.ui.promptNl)}</p>`;
    kicker = 'Typ het in het Frans.'; answerLang = 'fr'; accepted = it.accept.fr;
  } else if (t === 'listen_type') {
    prompt = `<p class="prompt prompt-hidden">Luister goed</p>${audioControls()}`;
    kicker = 'Luister. Typ de Nederlandse betekenis.'; answerLang = 'nl'; accepted = it.accept.nl; skillLabel = 'Luisteren';
  } else if (t === 'dictee') {
    prompt = `<p class="prompt prompt-hidden">Luister goed</p>${audioControls()}`;
    kicker = 'Dictee: typ precies wat je hoort, in het Frans.'; answerLang = 'fr'; accepted = [it.fr]; skillLabel = 'Dictee';
  } else {
    const verb = it.infinitive ? ` van ${it.infinitive}` : '';
    prompt = `<p class="prompt-sub">${esc(S.ui.promptNl)}</p>
      <p class="prompt" lang="fr">${pretty(it.fill.before)}${it.fill.before.endsWith("'") ? '' : ' '}<span class="blank" aria-label="open plek">___</span></p>`;
    kicker = `Vul de goede vorm${verb} in.`; answerLang = 'fr'; accepted = [it.fill.answer]; skillLabel = 'Grammatica';
  }
  S.ui.accepted = accepted;
  S.ui.answerLang = answerLang;
  show(frame(`
      ${prompt}
      <form class="answer-form" id="form" autocomplete="off" novalidate>
        <label class="visually-hidden" for="answer">Jouw antwoord</label>
        <input id="answer" class="answer-input" type="text" ${answerLang === 'fr' ? 'lang="fr"' : 'lang="nl"'}
          autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="done"
          placeholder="${answerLang === 'fr' ? 'In het Frans…' : 'In het Nederlands…'}">
        ${answerLang === 'fr' ? accentBar() : ''}
        <div class="actions" id="actions">
          <button class="btn btn-primary" type="submit" id="check">Controleer</button>
          <button class="btn btn-secondary" type="button" id="giveup">Ik weet het niet</button>
        </div>
      </form>
      <div class="feedback" id="feedback" role="status"></div>
      ${sourceFoot(it)}`, { kicker, skillLabel }), '#answer');
  bindCommon();
  if (t === 'type_fr2nl' || t === 'listen_type' || t === 'dictee') { bindAudio(it.tts); speak(it.tts); }
  bindAccentBar();
  $('#form').addEventListener('submit', (e) => { e.preventDefault(); checkTyped(); });
  $('#giveup').addEventListener('click', () => revealTyped('fout', null));
}

function accentBar() {
  return `<div class="accent-bar" role="group" aria-label="Franse tekens">
    ${ACCENTS.map((c) => `<button type="button" class="accent" data-char="${c === '’' ? "'" : c}" aria-label="Voeg ${c === '’' ? 'apostrof' : c} in">${c}</button>`).join('')}
  </div>`;
}

function bindAccentBar() {
  const input = $('#answer');
  $$('.accent').forEach((b) => {
    // pointerdown voorkomt dat het toetsenbord op de iPad verdwijnt.
    b.addEventListener('pointerdown', (e) => e.preventDefault());
    b.addEventListener('click', () => {
      const ch = b.dataset.char;
      const s = input.selectionStart ?? input.value.length;
      const en = input.selectionEnd ?? input.value.length;
      input.value = input.value.slice(0, s) + ch + input.value.slice(en);
      input.setSelectionRange(s + ch.length, s + ch.length);
      input.focus();
    });
  });
}

function checkTyped() {
  if (S.ui.done) return;
  const it = S.card.item;
  const input = $('#answer');
  const val = input.value;
  const g = grade(val, {
    accepted: S.ui.accepted, lang: S.ui.answerLang,
    item: S.card.type === 'fill' ? { ...it, kind: 'vervoeging' } : it,
    others: S.card.type === 'fill' ? [] : S.content.items,
  });
  if (g.result === 'leeg') {
    $('#feedback').innerHTML = '<p class="fb fb-neutral">Typ eerst een antwoord, of kies “Ik weet het niet”.</p>';
    input.focus();
    return;
  }
  S.ui.attempts++;
  if (g.result === 'goed') return revealTyped(S.ui.attempts > 1 ? 'bijna' : 'goed', g, val);
  if (g.result === 'bijna') return revealTyped('bijna', g, val);
  // Fout: eerst een hint en nog een kans, daarna het juiste antwoord.
  if (S.ui.attempts === 1) {
    const hint = g.message || hintFor(S.ui.accepted[0]);
    feedbackBox('opnieuw', `<p>${esc(hint)}</p><p class="muted">Probeer het nog een keer.</p>`);
    input.select();
    input.focus();
    return;
  }
  revealTyped('fout', g, val);
}

function revealTyped(outcome, g, given) {
  const it = S.card.item;
  const t = S.card.type;
  S.ui.done = true;
  $('#answer').readOnly = true;
  $('#actions').innerHTML = '';
  const accent = $('.accent-bar');
  if (accent) accent.remove();
  const fullFr = t === 'fill' ? `${it.fill.before}${it.fill.before.endsWith("'") ? '' : ' '}${it.fill.answer}` : it.fr;
  const modelShown = g && g.model ? g.model : S.ui.accepted[0];
  let body = '';
  if (outcome === 'goed') {
    body = S.ui.answerLang === 'nl'
      ? `<p><span lang="fr" class="fr-strong">${pretty(it.fr)}</span> = ${esc(modelShown)}</p>${g && g.message ? `<p class="muted">${esc(g.message)}</p>` : ''}`
      : `<p class="fr-strong" lang="fr">${pretty(fullFr)}</p>`;
  } else if (outcome === 'bijna') {
    body = `${g && g.message ? `<p>${esc(g.message)}</p>` : '<p>Bijna, je had hulp nodig. Dit woord komt straks terug.</p>'}
      ${given !== undefined && S.ui.answerLang === 'fr' && g && g.result === 'bijna' ? diffLine(given, modelShown) : ''}
      <p><span lang="fr" class="fr-strong">${pretty(fullFr)}</span> = ${esc(it.nl)}</p>`;
  } else {
    body = `${g && g.message ? `<p>${esc(g.message)}</p>` : ''}
      <p>Het goede antwoord: ${S.ui.answerLang === 'fr' ? `<span lang="fr" class="fr-strong">${pretty(t === 'fill' ? fullFr : modelShown)}</span>` : `<strong>${esc(modelShown)}</strong>`}</p>
      ${S.ui.answerLang === 'nl' ? `<p><span lang="fr">${pretty(it.fr)}</span> = ${esc(it.nl)}</p>` : ''}
      ${it.explain ? `<p class="muted">${esc(it.explain)}</p>` : ''}
      <p class="muted">Dit komt straks nog een keer terug.</p>`;
  }
  feedbackBox(outcome, body + audioControls());
  bindAudio(it.tts, $('#feedback'));
  speak(t === 'fill' ? fullFr : it.tts, 'normal', $('#feedback'));
  nextButton(outcome);
}

/** Laat zien wat er anders moet, letter voor letter. */
function diffLine(given, model) {
  const g = [...String(given).trim().replace(/[’‘]/g, "'")];
  const m = [...String(model).replace(/[’‘]/g, "'")];
  if (Math.abs(g.length - m.length) > 3) return '';
  const out = m.map((ch, i) => (g[i] && g[i].toLowerCase() === ch.toLowerCase() ? esc(ch) : `<mark>${esc(ch)}</mark>`)).join('');
  return `<p class="diff">Jij: <span lang="fr">${esc(given.trim())}</span><br>Goed: <span lang="fr">${out.replace(/'/g, '’')}</span></p>`;
}

// Spreken: zelfstandig vertalen en nazeggen
function renderSpeak(card) {
  const it = card.item;
  const repeat = card.type === 'repeat';
  const prompt = repeat
    ? `<p class="prompt" lang="fr">${pretty(it.fr)}</p>${audioControls()}`
    : `<p class="prompt">${esc(S.ui.promptNl)}</p>`;
  show(frame(`
      ${prompt}
      <p class="mode-tag">${repeat ? 'Nazeggen: je hoort eerst het voorbeeld.' : 'Zelf vertalen: je hoort het antwoord pas na jouw poging.'}</p>
      <div class="record">
        <button class="btn btn-record" id="rec" type="button" aria-pressed="false"><span class="dot" aria-hidden="true"></span><span class="rec-label">Start opname</span></button>
        <p class="rec-status" id="rec-status" aria-live="polite"></p>
      </div>
      <div class="feedback" id="feedback" role="status"></div>
      <div class="actions" id="actions">
        <button class="btn btn-secondary" id="reveal" type="button">${repeat ? 'Overslaan' : 'Laat het antwoord horen'}</button>
      </div>
      <p class="fineprint">De computer controleert welke woorden hij verstaat. Dit is geen uitspraakcijfer.</p>
      ${sourceFoot(it)}`, { kicker: repeat ? 'Luister en zeg het na.' : 'Zeg het in het Frans.', skillLabel: 'Spreken' }), '#rec');
  bindCommon();
  if (repeat) { bindAudio(it.tts); speak(it.tts); }
  $('#rec').addEventListener('click', () => toggleRecording());
  $('#reveal').addEventListener('click', () => {
    if (repeat) return finish('overgeslagen');
    showSpeakAnswer('fout', null);
  });
}

async function toggleRecording() {
  const btn = $('#rec');
  const status = $('#rec-status');
  if (recorder.rec && recorder.rec.state === 'recording') {
    recorder.stop();
    return;
  }
  audio.stop(); // Geen geluid tijdens de opname.
  cleanupOwnRecording();
  let blob;
  try {
    const recording = recorder.start((s) => {
      status.textContent = `Opname loopt… ${Math.floor(s)} s (maximaal ${MAX_RECORD_SECONDS} s)`;
    });
    btn.classList.add('is-recording');
    btn.setAttribute('aria-pressed', 'true');
    $('.rec-label', btn).textContent = 'Stop opname';
    status.textContent = 'Opname loopt… spreek nu.';
    blob = await recording;
  } catch (e) {
    recorder.release();
    return micProblem(e);
  }
  btn.classList.remove('is-recording');
  btn.setAttribute('aria-pressed', 'false');
  $('.rec-label', btn).textContent = 'Opnieuw opnemen';
  if (!blob || blob.size < 800) {
    status.textContent = '';
    return feedbackBox('opnieuw', '<p>Er was niets te horen. Dat is geen fout: probeer het nog een keer, iets dichter bij de microfoon.</p>');
  }
  S.ownRecordingUrl = URL.createObjectURL(blob);
  status.textContent = 'Even luisteren wat je zei…';
  btn.disabled = true;
  let res;
  try {
    res = await api.stt(blob, window.__mockSpeech);
  } catch (e) {
    btn.disabled = false;
    status.textContent = '';
    if (e.code === 'not_configured') {
      S.planner.setAvailable('mic', false);
      return feedbackBox('opnieuw', '<p>Spraakherkenning is nog niet ingesteld. Spreekopdrachten worden overgeslagen; je oefent verder met de andere vaardigheden.</p>', true);
    }
    return feedbackBox('opnieuw', `<p>${esc(e.message || 'De spraakherkenning werkte niet.')} Probeer het nog een keer.</p>`);
  }
  btn.disabled = false;
  status.textContent = '';
  const it = S.card.item;
  const accepted = S.card.type === 'repeat' ? [it.fr] : it.accept.fr;
  const g = gradeSpeech(res.text, accepted, res.reliable);
  S.ui.attempts++;
  const heard = res.text ? `<p>Verstaan: <span lang="fr" class="heard">“${esc(res.text)}”</span></p>` : '';
  if (g.result === 'onzeker') {
    return feedbackBox('opnieuw', `${heard}<p>Ik kon je niet goed verstaan. Dat is geen fout: probeer het nog een keer, rustig en duidelijk.</p>${ownPlayback()}`, false, true);
  }
  const outcome = g.result === 'goed' ? (S.ui.attempts > 1 ? 'bijna' : 'goed') : g.result === 'gedeeltelijk' ? 'bijna' : 'fout';
  const verdict = g.result === 'goed'
    ? '<p>De woorden zijn goed verstaan.</p>'
    : g.result === 'gedeeltelijk'
      ? '<p>Een deel is goed verstaan, maar niet alles.</p>'
      : '<p>Dat lijkt een ander antwoord.</p>';
  showSpeakAnswer(outcome, heard + verdict);
}

function showSpeakAnswer(outcome, html) {
  const it = S.card.item;
  S.ui.done = true;
  feedbackBox(outcome, `${html || ''}
    <p>Het voorbeeld: <span lang="fr" class="fr-strong">${pretty(it.fr)}</span> = ${esc(it.nl)}</p>
    ${audioControls()}
    ${ownPlayback()}`);
  bindAudio(it.tts, $('#feedback'));
  speak(it.tts, 'normal', $('#feedback'));
  const recBtn = $('#rec');
  if (recBtn) $('.rec-label', recBtn).textContent = 'Nog een keer proberen';
  $('#actions').innerHTML = '';
  nextButton(outcome);
}

function ownPlayback() {
  if (!S.ownRecordingUrl) return '';
  return `<p><button class="btn btn-audio" type="button" id="own">Luister naar jezelf</button></p>`;
}

function cleanupOwnRecording() {
  if (S.ownRecordingUrl) URL.revokeObjectURL(S.ownRecordingUrl);
  S.ownRecordingUrl = null;
}

function micProblem(e) {
  const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
  const none = e && (e.name === 'NotFoundError' || e.name === 'OverconstrainedError');
  const msg = denied
    ? 'De microfoon mag niet worden gebruikt. Geef toestemming in de browser (op de iPad: Instellingen › Safari › Microfoon) en probeer het opnieuw.'
    : none ? 'Er is geen microfoon gevonden.' : 'De microfoon kon niet worden gestart.';
  feedbackBox('opnieuw', `<p>${esc(msg)}</p>`, true);
}

/** Feedbackblok. Tekst én symbool, zodat het ook zonder kleur duidelijk is. */
function feedbackBox(outcome, html, offerSkipSpeaking = false, keepTrying = false) {
  const titles = { goed: '✓ Goed', bijna: '≈ Bijna goed', fout: '✗ Nog niet goed', opnieuw: '↻ Probeer het nog een keer' };
  const fb = $('#feedback');
  fb.className = `feedback fb-${outcome}`;
  fb.innerHTML = `<p class="fb-title">${titles[outcome]}</p>${html}
    ${offerSkipSpeaking ? '<div class="actions"><button class="btn btn-secondary" id="skip-speaking" type="button">Verder zonder spreken</button></div>' : ''}`;
  announce(titles[outcome].replace(/^[^ ]+ /, ''));
  const own = $('#own');
  if (own) own.addEventListener('click', () => { audio.stop(); const a = new Audio(S.ownRecordingUrl); a.play().catch(() => {}); });
  const skip = $('#skip-speaking');
  if (skip) skip.addEventListener('click', () => { S.planner.setAvailable('mic', false); finish('overgeslagen'); });
  if (keepTrying) $('#rec')?.focus();
}

function nextButton(outcome) {
  const actions = $('#actions');
  actions.innerHTML = '<button class="btn btn-primary" id="next" type="button">Volgende</button>';
  $('#next').addEventListener('click', () => finish(outcome));
  setTimeout(() => $('#next') && $('#next').focus({ preventScroll: false }), 0);
}

function finish(outcome) {
  S.planner.record(S.card, outcome);
  S.ui.keys = null;
  nextCard();
}

function noteLine(it) {
  const bits = [];
  if (it.note) bits.push(esc(it.note));
  return bits.length ? `<p class="muted">${bits.join(' · ')}</p>` : '';
}

function sourceFoot(it) {
  return `<p class="source">${esc(sourceLabel(it))}</p>`;
}

// ---------- Blokafronding ----------

function renderSummary(stoppedEarly = false) {
  const s = S.planner.summary();
  const skills = Object.entries(s.skills).filter(([, n]) => n > 0).map(([k, n]) => `${SKILL_NL[k]} (${n})`);
  const notDone = [];
  if (!S.planner.available.mic || s.skipped.includes('spreken')) notDone.push('Spreken is niet geoefend, omdat de microfoon of spraakherkenning niet beschikbaar was.');
  if (!S.planner.available.audio) notDone.push('Luisteren is niet geoefend, omdat de audio niet werkte.');
  show(`
    <section class="panel">
      <h1 tabindex="-1">${stoppedEarly ? 'Gestopt' : 'Dit blok is klaar'}</h1>
      ${s.practised.length ? `
      <h2>Geoefend</h2>
      <p>${s.practised.length} woorden en uitdrukkingen${skills.length ? `, met ${skills.join(', ')}` : ''}.</p>
      <p class="muted">Richting: Nederlands → Frans ${s.dirs.nl2fr}×, Frans → Nederlands ${s.dirs.fr2nl}×.</p>` : '<p>Je hebt in dit blok nog niets geoefend.</p>'}
      ${s.difficult.length ? `<h2>Nog lastig</h2>
      <ul class="word-list">${s.difficult.map((it) => `<li><span lang="fr">${pretty(it.fr)}</span> = ${esc(it.nl)}</li>`).join('')}</ul>` : ''}
      ${s.repeated.length ? `<p>Extra aandacht ging naar: ${s.repeated.map((k) => SKILL_NL[k]).join(', ')}.</p>` : ''}
      ${notDone.map((n) => `<p class="notice">${esc(n)}</p>`).join('')}
      <div class="actions">
        <button class="btn btn-primary" id="more" type="button">Verder oefenen</button>
        <button class="btn btn-secondary" id="quit" type="button">Stoppen</button>
      </div>
      <p class="fineprint">Dit overzicht wordt niet bewaard.</p>
    </section>`, 'h1');
  $('#more').addEventListener('click', () => {
    if (!S.planner.available.mic && Recorder.supported()) S.planner.setAvailable('mic', true); // nieuwe kans
    if (!S.planner.available.audio && audio.available) S.planner.setAvailable('audio', true);
    S.planner.startBlock();
    nextCard();
  });
  $('#quit').addEventListener('click', renderEnd);
}

function renderEnd() {
  show(`
    <section class="panel center">
      <h1 tabindex="-1">Tot de volgende keer</h1>
      <p class="lead">Goed dat je hebt geoefend. Er is niets bewaard: als je deze pagina sluit, is alles weg.</p>
      <div class="actions actions-center">
        <button class="btn btn-primary" id="again" type="button">Toch verder oefenen</button>
        <button class="btn btn-secondary" id="new" type="button">Nieuwe foto’s</button>
      </div>
    </section>`, 'h1');
  $('#again').addEventListener('click', () => { S.planner.startBlock(); nextCard(); });
  $('#new').addEventListener('click', () => renderStart());
}

function renderError(message, actions) {
  show(`
    <section class="panel">
      <h1 tabindex="-1">Dat lukte niet</h1>
      <p class="notice notice-warn" role="alert">${esc(message)}</p>
      <div class="actions">${actions.map((a, i) => `<button class="btn ${a.primary ? 'btn-primary' : 'btn-secondary'}" data-a="${i}" type="button">${esc(a.label)}</button>`).join('')}</div>
    </section>`, 'h1');
  $$('[data-a]').forEach((b) => b.addEventListener('click', () => actions[+b.dataset.a].action()));
}

// ---------- Toetsenbord ----------

document.addEventListener('keydown', (e) => {
  if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA')) return;
  if (S.ui && S.ui.keys) S.ui.keys(e);
});

// Waarschuwen dat vernieuwen de sessie wist, alleen tijdens het oefenen.
window.addEventListener('beforeunload', (e) => {
  if (S.planner && S.planner.block && S.planner.block.shown > 0) { e.preventDefault(); e.returnValue = ''; }
});

renderStart();
