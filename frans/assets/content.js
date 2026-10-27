// Leerstof: de voorbeeldset en het omzetten van herkende foto-inhoud naar leeritems.
// Een leeritem bevat bronantwoorden, expliciet geaccepteerde alternatieven en metadata.

import { norm } from './grader.js';

const PRONOUNS = ["je", "j'", "tu", "il", "elle", "on", "nous", "vous", "ils", "elles"];

/** Bouwt het invulgedeelte voor een vervoeging: "je ___" → "suis". */
function makeFill(fr) {
  const m = fr.match(/^(j')(.+)$/i) || fr.match(/^(\S+)\s+(.+)$/);
  if (!m) return null;
  const pron = m[1].toLowerCase();
  if (!PRONOUNS.includes(pron)) return null;
  return { before: m[1], answer: m[2] };
}

function item(spec) {
  const fr = spec.fr;
  return {
    id: '',
    sources: spec.sources,
    kind: spec.kind || (fr.includes(' ') || fr.includes("'") ? 'uitdrukking' : 'woord'),
    gender: spec.gender || '',
    note: spec.note || '',
    infinitive: spec.infinitive || '',
    nl: spec.nl,
    fr,
    // Wat de stem uitspreekt: alleen de Franse tekst, nooit metadata.
    tts: spec.tts || fr,
    accept: {
      fr: spec.acceptFr || [fr],
      nl: spec.acceptNl || [spec.nl],
    },
    // Opdracht bij Nederlands → Frans (met context waar het antwoord anders dubbelzinnig is).
    promptNl: spec.promptNl || [spec.nl],
    // Opdracht bij Frans → Nederlands.
    promptFr: spec.promptFr || fr,
    explain: spec.explain || '',
    fill: spec.kind === 'vervoeging' ? makeFill(fr) : null,
  };
}

const A1 = { apprendre: '1', title: 'Basisvocabulaire' };
const A2 = { apprendre: '2', title: 'Lire' };
const A3 = { apprendre: '3', title: 'Grammaire I' };

const RULES_A3 = [
  '“Het is” vertaal je met “c’est”.',
  '“Wij zijn” kan zowel “on est” als “nous sommes” zijn.',
  'Gebruik “elles sont” voor een groep met alleen meisjes of vrouwen.',
  'Gebruik “ils sont” voor een groep jongens of een gemengde groep.',
];

/** Voorbeeldset volgens de transcriptie van Apprendre 1, 2 en 3. */
export function sampleSet() {
  const items = [
    // Apprendre 1: Basisvocabulaire
    item({ sources: [A1], nl: 'dag', fr: 'bonjour', acceptNl: ['dag', 'goedendag', 'hallo'] }),
    item({ sources: [A1], nl: 'hoi', fr: 'salut' }),
    item({ sources: [A1], nl: 'tot ziens', fr: 'au revoir', acceptNl: ['tot ziens', 'dag'] }),
    item({
      sources: [A1], nl: 'hoe gaat het?', fr: 'ça va ?', kind: 'uitdrukking',
      promptNl: ['hoe gaat het? (een vraag)'], promptFr: 'ça va ? (als vraag)',
      acceptNl: ['hoe gaat het', 'hoe gaat het met je', 'hoe is het'],
    }),
    item({
      sources: [A1], nl: 'het gaat', fr: 'ça va', kind: 'uitdrukking',
      promptNl: ['het gaat (een mededeling)'], promptFr: 'ça va (als mededeling)',
      acceptNl: ['het gaat', 'het gaat goed'],
    }),
    item({ sources: [A1], nl: 'bedankt', fr: 'merci', acceptNl: ['bedankt', 'dank je', 'dankjewel', 'dank u', 'dankuwel'] }),
    item({ sources: [A1], nl: 'ja', fr: 'oui' }),
    item({ sources: [A1], nl: 'nee', fr: 'non' }),
    item({ sources: [A1], nl: 'ik heet', fr: "je m'appelle", tts: "je m'appelle", kind: 'uitdrukking' }),
    item({ sources: [A1, A3], nl: 'ik ben', fr: 'je suis', kind: 'vervoeging', infinitive: 'être' }),
    item({ sources: [A1], nl: 'de jongen', fr: 'le garçon', gender: 'm', note: 'mannelijk' }),
    item({ sources: [A1], nl: 'Frans', fr: 'français', note: 'de taal, of: Frans als bijvoeglijk naamwoord' }),
    item({ sources: [A1], nl: 'het is', fr: "c'est", kind: 'uitdrukking', explain: RULES_A3[0] }),
    item({ sources: [A1], nl: 'de stad', fr: 'la ville', gender: 'v', note: 'vrouwelijk' }),

    // Apprendre 2: Lire
    item({
      sources: [A2], nl: 'ik woon', fr: "j'habite", kind: 'vervoeging', infinitive: 'habiter',
      note: 'wonen = habiter', promptNl: ['ik woon'],
      explain: '“ik woon” is j’habite; het hele werkwoord “wonen” is habiter.',
    }),
    item({
      sources: [A2], nl: 'wonen', fr: 'habiter', kind: 'infinitief', note: 'het hele werkwoord',
      promptNl: ['wonen (het hele werkwoord)'],
      explain: '“wonen” (het hele werkwoord) is habiter; “ik woon” is j’habite.',
    }),
    item({ sources: [A2], nl: 'en jij?', fr: 'et toi ?', kind: 'uitdrukking', acceptNl: ['en jij', 'en jou', 'en met jou'] }),
    item({ sources: [A2], nl: 'de vriend', fr: "l'ami", gender: 'm', note: 'mannelijk' }),
    item({ sources: [A2], nl: 'de middelbare school', fr: 'le collège', gender: 'm', note: 'mannelijk; klas 1, 2, 3' }),
    item({ sources: [A2], nl: 'de klas', fr: 'la classe', gender: 'v' }),
    item({ sources: [A2], nl: 'dit is', fr: 'voici', acceptNl: ['dit is', 'hier is'] }),
    item({ sources: [A2], nl: 'dat is', fr: 'voilà', acceptNl: ['dat is', 'daar is'] }),
    item({ sources: [A2], nl: 'Frankrijk', fr: 'la France', gender: 'v' }),
    item({ sources: [A2], nl: 'het land', fr: 'le pays', gender: 'm' }),
    item({ sources: [A2], nl: 'de wijk', fr: 'le quartier', gender: 'm' }),
    item({ sources: [A2], nl: 'de straat', fr: 'la rue', gender: 'v' }),
    item({ sources: [A2], nl: 'groot', fr: 'grand' }),
    item({ sources: [A2], nl: 'mooi, leuk', fr: 'joli', promptNl: ['mooi', 'leuk'], acceptNl: ['mooi', 'leuk'] }),
    item({ sources: [A2], nl: 'er is, er zijn', fr: 'il y a', kind: 'uitdrukking', promptNl: ['er is', 'er zijn'], acceptNl: ['er is', 'er zijn'] }),
    item({ sources: [A2], nl: 'ook', fr: 'aussi' }),

    // Apprendre 3: Grammaire I
    item({ sources: [A3], nl: 'zijn', fr: 'être', kind: 'infinitief', promptNl: ['zijn (het hele werkwoord)'] }),
    item({ sources: [A3], nl: 'jij bent', fr: 'tu es', kind: 'vervoeging', infinitive: 'être', acceptNl: ['jij bent', 'je bent'] }),
    item({ sources: [A3], nl: 'hij is', fr: 'il est', kind: 'vervoeging', infinitive: 'être' }),
    item({ sources: [A3], nl: 'zij is', fr: 'elle est', kind: 'vervoeging', infinitive: 'être', acceptNl: ['zij is', 'ze is'] }),
    item({
      sources: [A3], nl: 'wij zijn, men is', fr: 'on est', kind: 'vervoeging', infinitive: 'être',
      promptNl: ['wij zijn (gebruik on)'], acceptNl: ['wij zijn', 'we zijn', 'men is'], explain: RULES_A3[1],
    }),
    item({
      sources: [A3], nl: 'wij zijn', fr: 'nous sommes', kind: 'vervoeging', infinitive: 'être',
      promptNl: ['wij zijn (gebruik nous)'], acceptNl: ['wij zijn', 'we zijn'], explain: RULES_A3[1],
    }),
    item({
      sources: [A3], nl: 'jullie zijn, u bent', fr: 'vous êtes', kind: 'vervoeging', infinitive: 'être',
      promptNl: ['jullie zijn', 'u bent'], acceptNl: ['jullie zijn', 'u bent'],
    }),
    item({
      sources: [A3], nl: 'zij zijn', fr: 'ils sont', kind: 'vervoeging', infinitive: 'être', note: 'jongens of een gemengde groep',
      promptNl: ['zij zijn (een groep jongens of een gemengde groep)'], acceptNl: ['zij zijn', 'ze zijn'], explain: RULES_A3[3],
    }),
    item({
      sources: [A3], nl: 'zij zijn', fr: 'elles sont', kind: 'vervoeging', infinitive: 'être', note: 'uitsluitend vrouwelijk',
      promptNl: ['zij zijn (alleen meisjes of vrouwen)'], acceptNl: ['zij zijn', 'ze zijn'], explain: RULES_A3[2],
    }),
  ];
  return finalize(items, [
    { number: '1', title: 'Basisvocabulaire', rules: [] },
    { number: '2', title: 'Lire', rules: [] },
    { number: '3', title: 'Grammaire I', rules: RULES_A3 },
  ], 'voorbeeld');
}

function finalize(items, apprendres, origin) {
  items.forEach((it, i) => { it.id = 'i' + (i + 1); });
  return { items, apprendres, origin };
}

/**
 * Zet het herkenningsresultaat om naar leeritems.
 * Alleen items die zeker zijn of door de gebruiker zijn bevestigd komen mee.
 * Dubbele Franse vormen (zoals “je suis” in twee apprendres) worden samengevoegd met behoud van beide bronnen.
 */
export function fromRecognition(apprendres, confirmedRaw) {
  const byFr = new Map();
  for (const raw of confirmedRaw) {
    const fr = cleanFr(raw.fr);
    const nl = (raw.nl || '').trim();
    if (!fr || !nl) continue;
    const src = { apprendre: raw.apprendreNumber || '?', title: raw.apprendreTitle || '' };
    // Een vraagteken telt mee: “ça va ?” en “ça va” zijn verschillende leeritems.
    const key = norm(fr) + (fr.endsWith('?') ? '?' : '');
    const nlAll = [nl, ...(raw.nl_alternatives || [])].map((s) => s.trim()).filter(Boolean);
    if (byFr.has(key)) {
      const ex = byFr.get(key);
      if (!ex.sources.some((s) => s.apprendre === src.apprendre)) ex.sources.push(src);
      for (const n of nlAll) if (!ex.accept.nl.includes(n)) ex.accept.nl.push(n);
      continue;
    }
    const spec = {
      sources: [src], nl, fr, kind: raw.kind === 'woord' && /[\s']/.test(fr) ? 'uitdrukking' : raw.kind,
      gender: raw.gender, note: raw.note, infinitive: raw.infinitive,
      acceptNl: nlAll, promptNl: nlAll.length > 1 ? nlAll : [nl],
    };
    const it = item(spec);
    byFr.set(key, it);
  }
  const items = [...byFr.values()];
  disambiguate(items);
  return finalize(items, apprendres.map((a) => ({ number: a.number, title: a.title, rules: a.rules || [] })), 'upload');
}

function cleanFr(fr) {
  return (fr || '')
    .replace(/\((?:m|v|f|mv|pl|m\.|v\.|f\.)\)/gi, '')
    .replace(/\s+(?:m|v|f)\.?$/i, '')
    .replace(/[’‘]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Als meerdere Franse vormen dezelfde Nederlandse opdracht hebben, krijgt de opdracht context uit de bron
 * (de toelichting). Zonder bruikbare context worden alle vormen goedgerekend, zodat de opdracht eerlijk blijft.
 */
function disambiguate(items) {
  const groups = new Map();
  for (const it of items) {
    for (const p of it.promptNl) {
      const k = norm(p);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(it);
    }
  }
  for (const [, group] of groups) {
    if (group.length < 2) continue;
    const allHaveNotes = group.every((g) => g.note);
    for (const it of group) {
      if (allHaveNotes) {
        it.promptNl = it.promptNl.map((p) => `${p} (${it.note})`);
      } else {
        for (const other of group) {
          for (const f of other.accept.fr) if (!it.accept.fr.includes(f)) it.accept.fr.push(f);
        }
      }
    }
  }
  // Zelfde Franse tekst met andere betekenis: Nederlandse antwoorden samenvoegen.
  const frGroups = new Map();
  for (const it of items) {
    const k = norm(it.fr) + (it.fr.endsWith('?') ? '?' : '');
    if (!frGroups.has(k)) frGroups.set(k, []);
    frGroups.get(k).push(it);
  }
  for (const [, group] of frGroups) {
    if (group.length < 2) continue;
    for (const it of group) {
      for (const other of group) for (const n of other.accept.nl) if (!it.accept.nl.includes(n)) it.accept.nl.push(n);
    }
  }
}

export function sourceLabel(it) {
  return it.sources.map((s) => `Apprendre ${s.apprendre}`).join(' en ');
}
