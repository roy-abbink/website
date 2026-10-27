import assert from 'node:assert/strict';
import { grade, gradeSpeech, norm } from '../assets/grader.js';
import { sampleSet, fromRecognition } from '../assets/content.js';
import { Planner, TYPES } from '../assets/planner.js';

const { items } = sampleSet();
const by = (fr) => items.find((i) => i.fr === fr);
const g = (input, fr, lang = 'fr') => {
  const it = by(fr);
  return grade(input, { accepted: lang === 'fr' ? it.accept.fr : it.accept.nl, lang, item: it, others: items });
};
let n = 0;
const t = (name, fn) => { fn(); n++; };

t('normalisatie apostrof/spaties/hoofdletters', () => {
  assert.equal(g("J’habite", "j'habite").result, 'goed');
  assert.equal(g("j' habite", "j'habite").result, 'goed');
  assert.equal(g('  Bonjour  ', 'bonjour').result, 'goed');
  assert.equal(g('ça va?', 'ça va ?').result, 'goed');
  assert.equal(g('et toi ?', 'et toi ?').result, 'goed');
});
t('accentfout is bijna met gerichte melding', () => {
  const r = g('francais', 'français');
  assert.equal(r.result, 'bijna'); assert.match(r.message, /ç in plaats van c/);
  assert.equal(g('vous etes', 'vous êtes').result, 'bijna');
  assert.equal(g('etre', 'être').result, 'bijna');
  assert.equal(g('le college', 'le collège').result, 'bijna');
  assert.equal(g('voila', 'voilà').result, 'bijna');
});
t('ontbrekende apostrof is bijna', () => {
  assert.equal(g('jhabite', "j'habite").result, 'bijna');
  assert.equal(g('c est', "c'est").result, 'bijna');
  assert.equal(g('je mappelle', "je m'appelle").result, 'bijna');
});
t('lidwoordfouten zijn fout', () => {
  const r = g('la garçon', 'le garçon');
  assert.equal(r.result, 'fout'); assert.equal(r.kind, 'lidwoord');
  assert.equal(g('garçon', 'le garçon').kind, 'lidwoord');
  assert.equal(g('le ville', 'la ville').result, 'fout');
});
t('vervoeging en voornaamwoord zijn fout, geen typefout', () => {
  assert.equal(g('tu est', 'tu es').result, 'fout');
  assert.equal(g('nous somme', 'nous sommes').result, 'fout');
  assert.equal(g('il sont', 'ils sont').result, 'fout');
  assert.equal(g('elles sont', 'ils sont').result, 'fout');
  assert.equal(g('nous sommes', 'on est').result, 'fout');
});
t('korte andere woorden worden niet goedgekeurd', () => {
  assert.equal(g('non', 'oui').result, 'fout');
  assert.equal(g('oui', 'non').result, 'fout');
  assert.equal(g('il est', 'elle est').result, 'fout');
});
t('kleine typefout bij lang woord is bijna', () => {
  assert.equal(g('bonjuor', 'bonjour').result, 'bijna');
  assert.equal(g('le quartir', 'le quartier').result, 'bijna');
});
t('Nederlandse alternatieven', () => {
  assert.equal(g('leuk', 'joli', 'nl').result, 'goed');
  assert.equal(g('mooi, leuk', 'joli', 'nl').result, 'goed');
  assert.equal(g('er zijn', 'il y a', 'nl').result, 'goed');
  assert.equal(g('u bent', 'vous êtes', 'nl').result, 'goed');
  assert.equal(g('men is', 'on est', 'nl').result, 'goed');
  assert.equal(g('wij zijn', 'nous sommes', 'nl').result, 'goed');
  assert.equal(g('jongen', 'le garçon', 'nl').result, 'goed');
  assert.equal(g('hoe gaat het', 'ça va ?', 'nl').result, 'goed');
  assert.equal(g('het gaat', 'ça va ?', 'nl').result, 'fout');
  assert.equal(g('wonen', "j'habite", 'nl').result, 'fout');
  assert.equal(g('ik woon', 'habiter', 'nl').result, 'fout');
});
t('context bij dubbelzinnige opdrachten', () => {
  assert.match(by('ils sont').promptNl[0], /gemengde/);
  assert.match(by('elles sont').promptNl[0], /meisjes/);
  assert.match(by('on est').promptNl[0], /on/);
  assert.match(by('nous sommes').promptNl[0], /nous/);
  assert.equal(by('je suis').sources.length, 2);
  assert.ok(by("j'habite").fill && by("j'habite").fill.answer === 'habite');
  assert.equal(by('nous sommes').fill.answer, 'sommes');
});
t('spraak', () => {
  assert.equal(gradeSpeech('Je suis.', ['je suis'], true).result, 'goed');
  assert.equal(gradeSpeech('Euh, bonjour !', ['bonjour'], true).result, 'goed');
  assert.equal(gradeSpeech("J'habite", ["j'habite"], true).result, 'goed');
  assert.equal(gradeSpeech('suis', ['je suis'], true).result, 'gedeeltelijk');
  assert.equal(gradeSpeech('merci', ['bonjour'], true).result, 'anders');
  assert.equal(gradeSpeech('', ['bonjour'], true).result, 'onzeker');
  assert.equal(gradeSpeech('bonjour', ['bonjour'], false).result, 'onzeker');
});
t('afleiders geven nooit een tweede goed antwoord', () => {
  const p = new Planner(items);
  for (const it of items) for (const lang of ['fr', 'nl']) for (let k = 0; k < 20; k++) {
    for (const d of p.distractors(it, lang)) {
      const own = (lang === 'fr' ? it.accept.fr : it.accept.nl).map(norm);
      const theirs = (lang === 'fr' ? d.accept.fr : d.accept.nl).map(norm);
      assert.ok(!theirs.some((x) => own.includes(x)), `${it.fr} vs ${d.fr}`);
    }
  }
});
t('planner: beide richtingen, alle vaardigheden en herhaling', () => {
  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const p = new Planner(items, rnd);
  const dirs = new Map(items.map((i) => [i.id, new Set()]));
  const skills = new Set();
  let maxPerItemPerBlock = 0;
  for (let b = 0; b < 40; b++) {
    p.startBlock();
    let c; let k = 0; const per = new Map();
    while ((c = p.next())) {
      k++; skills.add(TYPES[c.type].skill); dirs.get(c.item.id).add(TYPES[c.type].dir);
      per.set(c.item.id, (per.get(c.item.id) || 0) + 1);
      p.record(c, rnd() < 0.25 ? 'fout' : 'goed');
    }
    assert.ok(k >= 12 && k <= 18, 'bloklengte ' + k);
    maxPerItemPerBlock = Math.max(maxPerItemPerBlock, ...per.values());
  }
  assert.deepEqual([...skills].sort(), ['lezen', 'luisteren', 'schrijven', 'spreken']);
  const both = items.filter((i) => dirs.get(i.id).has('nl2fr') && dirs.get(i.id).has('fr2nl')).length;
  assert.equal(both, items.length, 'elk item in beide richtingen');
  assert.ok(maxPerItemPerBlock <= 5, 'geen item overheerst: ' + maxPerItemPerBlock);
});
t('planner zonder audio/microfoon kiest geen luister- of spreekopdracht', () => {
  const p = new Planner(items); p.setAvailable('audio', false); p.setAvailable('mic', false);
  for (let b = 0; b < 10; b++) { p.startBlock(); let c; while ((c = p.next())) { assert.ok(!['luisteren', 'spreken'].includes(TYPES[c.type].skill)); p.record(c, 'goed'); } }
});
t('herkenning: alleen bevestigde items, samenvoegen, context bij gelijke vertaling', () => {
  const ap = [{ number: '3', title: 'G', rules: [] }];
  const raw = (nl, fr, extra = {}) => ({ nl, fr, nl_alternatives: [], note: '', gender: '', kind: 'vervoeging', infinitive: '', certain: true, issue: '', apprendreNumber: '3', apprendreTitle: 'G', ...extra });
  const c = fromRecognition(ap, [raw('zij zijn', 'ils sont'), raw('zij zijn', 'elles sont', { note: 'uitsluitend vrouwelijk' }), raw('ik ben', 'je suis'), raw('ik ben', 'je suis', { apprendreNumber: '1' }), raw('de jongen', 'le garçon (m)', { kind: 'woord' })]);
  assert.equal(c.items.length, 4);
  assert.equal(c.items.find((i) => i.fr === 'je suis').sources.length, 2);
  assert.equal(c.items.find((i) => i.fr.startsWith('le')).fr, 'le garçon');
  // Niet alle dubbelen hebben toelichting → beide vormen goedrekenen.
  assert.deepEqual(c.items.find((i) => i.fr === 'ils sont').accept.fr.sort(), ['elles sont', 'ils sont']);
});
console.log(`${n} testgroepen geslaagd`);
